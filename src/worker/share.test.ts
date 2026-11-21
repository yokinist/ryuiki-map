import { describe, expect, it } from "vitest";
import { parseShare, previewImage, previewMeta, shareKey } from "./share";

const yodo = {
  p: "135.51440,34.72370",
  dir: null,
  origin: "大阪府大阪市北区 天満一丁目",
  headline: "瀬戸内海にたどり着きました",
  distance: "9.9 km・約3時間",
  where: "淀川河口（大阪府大阪市西淀川区 中島二丁目）",
};

describe("parseShare", () => {
  it("画面に出ている結論だけを受け取る", () => {
    expect(parseShare(yodo)).toEqual(yodo);
  });

  it("さかのぼり（dir=up）も受け取る。河口の地名がない結論も受け取る", () => {
    const up = {
      ...yodo,
      dir: "up",
      headline: "水源にたどり着きました",
      distance: "95.5 km上流・約27時間前",
      where: null,
    };
    expect(parseShare(up)).toEqual(up);
  });

  it("座標の形が共有 URL と違うもの・知らない向きは捨てる", () => {
    expect(parseShare({ ...yodo, p: "135.5,34.7;drop" })).toBeNull();
    expect(parseShare({ ...yodo, dir: "down" })).toBeNull();
  });

  it("画面に出ない見出しや距離の言い回し（よその文言の書き込み）は捨てる", () => {
    expect(parseShare({ ...yodo, headline: "ここは危険です" })).toBeNull();
    expect(parseShare({ ...yodo, distance: "とても遠い" })).toBeNull();
  });

  it("地名が長すぎるもの・URL や記号の入ったものは捨てる", () => {
    expect(parseShare({ ...yodo, origin: "あ".repeat(81) })).toBeNull();
    expect(parseShare({ ...yodo, where: "https://example.com/" })).toBeNull();
  });

  it("実際の地名にある記号（，、～－・全角の空白・全角の英字・ローマ数字・半角の括弧）は受け取る", () => {
    for (const place of [
      "宮崎県都城市 西別府、辺川",
      "鹿児島県薩摩川内市 浦之名川口，梁瀬（大字浦之名）",
      "沖縄県国頭郡今帰仁村 仲深西林～熊山",
      "東京都江東区 青海２丁目　Ｊ街区",
      "北海道札幌市中央区 北一条西２丁目－Ⅱ",
      "四万十川(渡川)河口（高知県四万十市 下田）",
    ])
      expect(
        parseShare({ ...yodo, origin: place, where: place }),
      ).not.toBeNull();
  });

  it('HTML や URL を混ぜられる記号（<>"& と : .）は捨てる', () => {
    for (const place of [
      "<b>大阪</b>",
      '大阪"市',
      "大阪&北区",
      "https://example.com",
      "example.com",
    ])
      expect(parseShare({ ...yodo, origin: place })).toBeNull();
  });

  it("向きと見出しが食い違うもの（下りなのに水源、さかのぼりなのに海）は捨てる", () => {
    expect(
      parseShare({ ...yodo, headline: "水源にたどり着きました" }),
    ).toBeNull();
    expect(parseShare({ ...yodo, dir: "up" })).toBeNull();
  });

  it("オブジェクトでないものは捨てる", () => {
    expect(parseShare(null)).toBeNull();
    expect(parseShare("瀬戸内海")).toBeNull();
  });
});

describe("shareKey", () => {
  it("座標と向きで決まる（同じ URL なら同じ鍵）", () => {
    expect(shareKey("135.51440,34.72370", null)).toBe("135.51440,34.72370");
    expect(shareKey("135.51440,34.72370", "up")).toBe("135.51440,34.72370|up");
  });
});

describe("previewMeta", () => {
  const site = { name: "流域探索マップ", stage: "(β)" };

  it("タイトルに結論と距離、説明に出発点と河口の地名を入れる", () => {
    expect(previewMeta(yodo, site)).toEqual({
      title: "瀬戸内海にたどり着きました（9.9 km・約3時間）｜流域探索マップ(β)",
      description:
        "大阪府大阪市北区 天満一丁目に降った雨は、淀川河口（大阪府大阪市西淀川区 中島二丁目）から瀬戸内海にたどり着きました。9.9 km・約3時間",
    });
  });

  it("さかのぼり（dir=up）は、水源までの言い回しにする", () => {
    const up = {
      ...yodo,
      dir: "up" as const,
      headline: "水源にたどり着きました",
      distance: "95.5 km上流・約27時間前",
      where: null,
    };
    expect(previewMeta(up, site).description).toBe(
      "大阪府大阪市北区 天満一丁目から水の来た道をさかのぼり、水源にたどり着きました。95.5 km上流・約27時間前",
    );
  });
});

describe("previewImage", () => {
  const site = { name: "流域探索マップ", stage: "(β)", themeColor: "#12343b" };
  const params = (url: string) => Object.fromEntries(new URL(url).searchParams);

  it("大きな字は結論（どの海まで何 km）、小さな字は出発点の市区町村・河口・時間にする", () => {
    const { url, alt } = previewImage(yodo, site);
    expect(new URL(url).pathname).toBe(
      `/${encodeURIComponent("瀬戸内海まで 9.9 km")}.png`,
    );
    expect(params(url)).toEqual({
      siteTitle: "流域探索マップ(β)",
      description: "大阪府大阪市北区に降った雨は、淀川河口から・約3時間",
      background: "#12343b",
      accent: "#d6336c",
    });
    expect(alt).toBe(
      "瀬戸内海まで 9.9 km。大阪府大阪市北区に降った雨は、淀川河口から・約3時間",
    );
  });

  it("さかのぼり（dir=up）は「水源まで何 km」", () => {
    const up = {
      ...yodo,
      dir: "up" as const,
      headline: "水源にたどり着きました",
      distance: "248.0 km上流・約3日前",
      where: null,
    };
    const { url } = previewImage(up, site);
    expect(new URL(url).pathname).toBe(
      `/${encodeURIComponent("水源まで 248.0 km")}.png`,
    );
    expect(params(url).description).toBe(
      "大阪府大阪市北区の水の来た道・約3日前",
    );
  });

  it("河口の地名は、最後の全角の括弧だけを外す（川の名前の括弧は残す）", () => {
    const shimanto = {
      ...yodo,
      where: "四万十川(渡川)河口（高知県四万十市 下田）",
    };
    expect(params(previewImage(shimanto, site).url).description).toBe(
      "大阪府大阪市北区に降った雨は、四万十川(渡川)河口から・約3時間",
    );
  });

  it("追いきれなかったときは、見出しをそのまま大きな字にする", () => {
    const cut = {
      ...yodo,
      headline: "河口まで追いきれませんでした",
      where: null,
    };
    const { url } = previewImage(cut, site);
    expect(new URL(url).pathname).toBe(
      `/${encodeURIComponent("河口まで追いきれませんでした")}.png`,
    );
    expect(params(url).description).toBe("大阪府大阪市北区に降った雨・約3時間");
  });
});
