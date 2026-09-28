import { afterEach, describe, expect, it, vi } from "vitest";
import { type Place, placeEvents, placesAlong, probeSteps } from "./places";

describe("placesAlong", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("下流の応答が先に届いても、同じ地区は上流の区間が採る", async () => {
    // 21点の流路。step 10 で川が変わる。区間ごとに中央（5 / 15）から試す
    const pts = Array.from(
      { length: 21 },
      (_, i) => [140 + i * 0.01, 36] as [number, number],
    );
    const aza: Record<number, [name: string, ms: number]> = {
      0: ["出発", 0],
      5: ["玄倉", 30], // 上流の区間。遅れて届く
      15: ["玄倉", 0], // 下流の区間。先に届くが、上流と同じ地区なので次の地点を試す
      14: ["神尾田", 0], // 下流の区間の 1/3
    };
    vi.stubGlobal("fetch", async (url: string) => {
      const lon = Number(new URL(url).searchParams.get("lon"));
      const [name, ms] = aza[Math.round((lon - 140) / 0.01)] ?? ["", 0];
      await new Promise((r) => setTimeout(r, ms));
      return new Response(
        JSON.stringify({ results: { muniCd: "1", lv01Nm: name || "−" } }),
      );
    });
    const events = await placesAlong({
      pts,
      dist: pts.map((_, i) => i * 100),
      rivers: [
        { name: "中ノ沢", km: 0, step: 0 },
        { name: "玄倉川", km: 0, step: 10 },
      ],
    });
    expect(events.map((e) => [e.step, e.aza])).toEqual([
      [5, "玄倉"],
      [14, "神尾田"],
    ]);
  });
});

describe("probeSteps", () => {
  // 100m 間隔で 21 点（2km）。step 4 と step 10 で川が変わる
  const dist = Array.from({ length: 21 }, (_, i) => i * 100);
  const river = (name: string, step: number) => ({ name, km: 0, step });

  it("川の区間ごとに、中央・1/3・2/3 の地点を試す", () => {
    const rivers = [river("沢", 0), river("支流", 4), river("本流", 10)];
    expect(probeSteps({ dist, rivers })).toEqual([
      [2, 3], // 短い区間では中央と 1/3 が同じ点になるので1回だけ
      [7, 6, 8],
      [15, 14, 17],
    ]);
  });

  it("川の名前がない流路は全体を1区間として扱う", () => {
    expect(probeSteps({ dist, rivers: [] })).toEqual([[10, 7, 14]]);
  });

  it("点が1つしかなければ問い合わせない", () => {
    expect(probeSteps({ dist: [0], rivers: [] })).toEqual([]);
  });
});

const at = (key: string, aza: string): Place => ({
  key,
  pref: "群馬県",
  muni: "沼田市",
  aza,
});

describe("placeEvents", () => {
  it("届いた順がばらばらでも流路の順に並べる", () => {
    const events = placeEvents([
      { step: 30, p: at("3", "戸鹿野町") },
      { step: 0, p: at("1", "岩本町") },
      { step: 10, p: at("2", "上発知町") },
    ]);
    expect(events.map((e) => [e.step, e.aza])).toEqual([
      [0, "岩本町"],
      [10, "上発知町"],
      [30, "戸鹿野町"],
    ]);
  });

  it("岸を行き来して同じ地区に戻っても、最初の地点だけ", () => {
    const events = placeEvents([
      { step: 20, p: at("1", "岩本町") },
      { step: 10, p: at("2", "上発知町") },
      { step: 0, p: at("1", "岩本町") },
    ]);
    expect(events.map((e) => [e.step, e.aza])).toEqual([
      [0, "岩本町"],
      [10, "上発知町"],
    ]);
  });

  it("大字のない地点と、問い合わせに失敗した地点は出さない", () => {
    expect(
      placeEvents([
        { step: 0, p: at("1", "") },
        { step: 10, p: null },
      ]),
    ).toEqual([]);
  });
});
