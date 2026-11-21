import { describe, expect, it } from "vitest";
import type { PlaceEvent } from "../data/places";
import type { Path } from "../terrain/trace";
import { distance } from "./format";
import {
  citizenBands,
  mouthName,
  sourceEvents,
  timelineEvents,
} from "./timeline";

// 4点の流路。片品川を下りはじめ、2点目で利根川に合流して海へ
const path: Path = {
  pts: [
    [139.2, 36.7],
    [139.3, 36.6],
    [139.4, 36.5],
    [139.5, 36.4],
  ],
  dist: [0, 1000, 2000, 3000],
  rivers: [
    { name: "片品川", km: 60, step: 0 },
    { name: "利根川", km: 322, step: 2 },
  ],
  toSea: true,
};
const place = (key: string, muni: string, step: number): PlaceEvent => ({
  key,
  pref: "群馬県",
  muni,
  step,
});
const origin = place("10206", "沼田市", 0);
const places = [origin, place("10443", "昭和村", 1)];
const mouth = { sea: "太平洋", name: "利根川河口（千葉県銚子市）" };

describe("mouthName", () => {
  const choshi = { pref: "千葉県", muni: "銚子市" };
  it("市区町村が分かる前は川の名前だけで出し、分かったら書き足す", () => {
    expect(mouthName("利根川", null)).toBe("利根川河口");
    expect(mouthName("利根川", choshi)).toBe("利根川河口（千葉県銚子市）");
  });
  it("川の名前がなければ海岸の市区町村", () => {
    expect(mouthName(undefined, choshi)).toBe("千葉県銚子市の海岸");
    expect(mouthName(undefined, null)).toBeNull();
  });
  it("町丁・字が分かれば、市区町村のあとに添える", () => {
    expect(mouthName("利根川", { ...choshi, aza: "川口町一丁目" })).toBe(
      "利根川河口（千葉県銚子市 川口町一丁目）",
    );
    expect(mouthName(undefined, { ...choshi, aza: "川口町一丁目" })).toBe(
      "千葉県銚子市 川口町一丁目の海岸",
    );
  });
});

describe("timelineEvents", () => {
  it("川の移り変わりと、出発点以外の市区町村を出す", () => {
    const events = timelineEvents(path, places, origin, mouth, 0);
    expect(events.map((e) => [e.kind, e.title, e.sub])).toEqual([
      ["river", "片品川をくだりはじめる", "すぐに"],
      ["river", "利根川に合流", `片品川 → 利根川・${distance(2000)}`],
      ["place", "群馬県昭和村", `片品川沿い・${distance(1000)}`],
    ]);
  });

  it("出発点が川の上でなければ、最初の川は「に出る」", () => {
    const later = { ...path, rivers: [{ name: "片品川", km: 60, step: 1 }] };
    expect(timelineEvents(later, [], null, null, 0)[0].title).toBe(
      "片品川に出る",
    );
  });

  it("最後の項目は、雨粒が着いて河口を調べ終えてから出す", () => {
    const end = (k: number, m: typeof mouth | null | undefined) =>
      timelineEvents(path, [], null, m, k).find((e) => e.kind === "end");
    expect(end(2, mouth)).toBeUndefined();
    expect(end(3, undefined)).toBeUndefined();
    expect(end(3, mouth)).toMatchObject({
      step: 3,
      title: "太平洋へ",
      sub: `利根川河口（千葉県銚子市）・${distance(3000)}`,
    });
    expect(end(3, null)?.title).toBe("海へ");
  });

  it("海まで追えなければ「この先は追いきれませんでした」", () => {
    const cut = { ...path, toSea: false };
    expect(
      timelineEvents(cut, [], null, null, 3).find((e) => e.kind === "end"),
    ).toMatchObject({
      title: "この先は追いきれませんでした",
      sub: `利根川をくだって海へ・${distance(3000)}`,
    });
  });

  it("流路沿いのダムを、その位置の川と距離を添えて出す（名前がなければ「ダム」）", () => {
    const events = timelineEvents(path, [], null, null, 0, [
      { step: 1, kind: 0, name: "薗原ダム" },
      { step: 3, kind: 0, name: "" },
    ]);
    const dams = events.filter((e) => e.kind === "dam");
    expect(dams.map((e) => [e.title, e.sub])).toEqual([
      ["薗原ダムを通る", `片品川・${distance(1000)}`],
      ["ダムを通る", `利根川・${distance(3000)}`],
    ]);
  });

  it("流路沿いの水のきれいさを、測った場所・BOD・年度・距離を添えて出す", () => {
    const events = timelineEvents(
      path,
      [],
      null,
      null,
      0,
      [],
      [
        {
          step: 2,
          name: "大正橋",
          bod: 1.6,
          year: 2024,
          level: 1,
          label: "ヤマメ・イワナが棲めるくらい",
          history: [{ year: 2024, bod: 1.6 }],
        },
      ],
    );
    expect(events.find((e) => e.kind === "water")).toMatchObject({
      step: 2,
      title: "水のきれいさ：ヤマメ・イワナが棲めるくらい",
      score: 7, // BOD 1.6
      note: undefined, // 比べる年度がない
      sub: `大正橋で測定・BOD 1.6（2024年度の平均）・${distance(2000)}`,
    });
  });
});

// さかのぼる道のり（先頭がクリック地点、最後が水源）。利根川をさかのぼり、1点目で薄根川が流れ込み、2点目から片品川へ
const source = {
  pts: path.pts,
  dist: [0, 1000, 2000, 3000],
  rivers: [
    { name: "利根川", km: 322, step: 0 },
    { name: "片品川", km: 60, step: 2 },
  ],
  tributaries: [{ name: "薄根川", step: 1 }],
  elev: 1800,
  cut: false,
};

describe("sourceEvents", () => {
  it("さかのぼる川・流れ込む支流・市区町村・水源を、上流への距離と何時間前の雨かを添えて出す", () => {
    const events = sourceEvents(
      source,
      [origin, place("10443", "昭和村", 2)],
      origin,
    );
    expect(events.map((e) => [e.kind, e.title, e.sub])).toEqual([
      ["river", "利根川をさかのぼる", "ここから"],
      ["river", "片品川をさかのぼる", "利根川 → 片品川・2.0 km上流・約33分前"],
      ["branch", "薄根川が流れ込む", "利根川・1.0 km上流・約17分前"],
      ["place", "群馬県昭和村", "片品川沿い・2.0 km上流・約33分前"],
      ["end", "水源", "標高 1,800 m・3.0 km上流・約50分前"],
    ]);
  });

  it("水源の市区町村が分かったら、地名を見出しにする", () => {
    const end = sourceEvents(source, [], null, place("10444", "片品村", 3)).at(
      -1,
    );
    expect(end).toMatchObject({
      kind: "end",
      title: "水源（群馬県片品村）",
      sub: "標高 1,800 m・3.0 km上流・約50分前",
    });
    const aza = { ...place("10444", "片品村", 3), aza: "東小川" };
    expect(sourceEvents(source, [], null, aza).at(-1)?.title).toBe(
      "水源（群馬県片品村 東小川）",
    );
  });

  it("計算範囲の端で切れていたら、水源とは言わない", () => {
    const end = sourceEvents({ ...source, cut: true }, [], null).at(-1);
    expect(end).toMatchObject({
      kind: "end",
      title: "この先は追いきれませんでした",
      sub: "3.0 km上流・約50分前",
    });
  });

  it("さかのぼる道のり沿いのダムも、その位置の川と上流への距離を添えて出す", () => {
    const events = sourceEvents(source, [], null, null, [
      { step: 1, kind: 0, name: "薗原ダム" },
    ]);
    const dam = events.find((e) => e.kind === "dam");
    expect(dam).toMatchObject({
      title: "薗原ダムを通る",
      sub: "利根川・1.0 km上流・約17分前",
    });
  });

  it("さかのぼる道のり沿いの水のきれいさは、上流への距離と何時間前の雨かを添えて出す", () => {
    const events = sourceEvents(
      source,
      [],
      null,
      null,
      [],
      [
        {
          step: 2,
          name: "大正橋",
          bod: 4.2,
          year: 2024,
          level: 3,
          label: "コイ・フナが棲めるくらい",
          history: [
            { year: 1994, bod: 9.3 },
            { year: 2024, bod: 4.2 },
          ],
        },
      ],
    );
    expect(events.find((e) => e.kind === "water")).toMatchObject({
      title: "水のきれいさ：コイ・フナが棲めるくらい",
      score: 4, // BOD 4.2
      note: { text: "1994年度より よくなった", values: "BOD 9.3 → 4.2" },
      sub: "大正橋で測定・BOD 4.2（2024年度の平均）・2.0 km上流・約33分前",
    });
  });
});
describe("citizenBands", () => {
  const dot = (step: number, tone = 0) => ({
    step,
    kind: "citizen" as const,
    tone,
    text: `地点${step}`,
  });

  it("市民の調査地点を、その手前の環境省の測定点の位置にまとめる（最初の測定点より上流の地点は、最初の地点の位置にまとめる）", () => {
    const bands = citizenBands([dot(1), dot(3), dot(5), dot(9)], [4, 8], 10);
    expect(bands.map((b) => [b.step, b.dots?.map((d) => d.step)])).toEqual([
      [1, [1, 3]],
      [4, [5]],
      [8, [9]],
    ]);
  });

  it("雨粒がまだ着いていない地点（k より先）は入れない", () => {
    const bands = citizenBands([dot(1), dot(3), dot(5)], [], 3);
    expect(bands.map((b) => b.dots?.map((d) => d.step))).toEqual([[1, 3]]);
  });

  it("まとめた地点の数を見出しにする", () => {
    const [band] = citizenBands([dot(1), dot(2)], [], 5);
    expect(band).toMatchObject({ kind: "band", title: "市民の調査 2地点" });
  });
});

describe("citizenBands の出し方", () => {
  const dot = (step: number) => ({
    step,
    kind: "citizen" as const,
    tone: 0,
    text: `地点${step}`,
  });

  it("3地点までは、押さなくても読めるよう中身を並べる（listed）。4地点からは点にして、押すと中身", () => {
    const [few] = citizenBands([dot(1), dot(2), dot(3)], [], 5);
    const [many] = citizenBands([dot(1), dot(2), dot(3), dot(4)], [], 5);
    expect(few).toMatchObject({ listed: true, sub: "" });
    expect(many).toMatchObject({
      listed: false,
      sub: "点を押すと場所と結果",
    });
  });
});
