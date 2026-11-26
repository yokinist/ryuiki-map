import { describe, expect, it } from "vitest";
import { dataCatalog, dataPageHtml } from "./catalog";

const URL = "https://example.test/";
const VERSIONS = {
  rivers: "20261125",
  karte: "20261125",
  places: "20261121",
  water: "20261119",
  suisei: "20261121",
  mizumap: "20261121",
};

describe("dataCatalog", () => {
  it("フォルダごとの今の版から、版つきのファイルの置き場を組み立てる", () => {
    const water = dataCatalog(URL, VERSIONS).datasets.find(
      (d) => d.id === "water",
    );
    expect(water?.latest).toBe("https://example.test/water/latest.json");
    expect(water?.readme).toBe("https://example.test/water/README.txt");
    expect(water?.version).toBe("20261119");
    expect(water?.files).toBe(
      "https://example.test/water/20261119/<1次メッシュ番号>.json",
    );
  });

  it("流域サマリは人口・土地とダム・堰を、同じ版の別の置き場として分ける", () => {
    const { datasets } = dataCatalog(URL, VERSIONS);
    const meshes = datasets.find((d) => d.id === "karte-meshes");
    const dams = datasets.find((d) => d.id === "karte-dams");
    expect(meshes?.files).toBe(
      "https://example.test/karte/20261125/meshes/<1次メッシュ番号>.json",
    );
    expect(dams?.files).toBe(
      "https://example.test/karte/20261125/dams/<1次メッシュ番号>.json",
    );
    expect(dams?.license).toContain("ODbL");
  });

  it("入手元の文には、データの名前と版と一覧のページが入る", () => {
    const water = dataCatalog(URL, VERSIONS).datasets.find(
      (d) => d.id === "water",
    );
    expect(water?.source).toBe(
      "流域探索マップの配信データ（水のきれいさ 20261119 版）https://example.test/data/",
    );
  });

  it("どのデータにも、書く出典とライセンスがある", () => {
    for (const d of dataCatalog(URL, VERSIONS).datasets) {
      expect(d.attribution, d.id).not.toBe("");
      expect(d.license, d.id).not.toBe("");
    }
  });

  it("人が読むページには、どのデータの名前と出典も載り、機械向けの一覧へのリンクがある", () => {
    const catalog = dataCatalog(URL, VERSIONS);
    const html = dataPageHtml(catalog, "流域探索マップ");
    for (const d of catalog.datasets) {
      expect(html).toContain(d.name);
      expect(html).toContain(d.attribution.replace(/</g, "&lt;"));
    }
    expect(html).toContain('href="https://example.test/data.json"');
  });

  it("ファイル名の決め方の <…> は、タグにならないよう書き換える", () => {
    const html = dataPageHtml(dataCatalog(URL, VERSIONS), "流域探索マップ");
    expect(html).toContain("&lt;1次メッシュ番号&gt;.json");
    expect(html).not.toContain("<1次メッシュ番号>");
  });

  it("版が分からないフォルダがあれば、書き出しを止める", () => {
    const { water: _, ...missing } = VERSIONS;
    expect(() => dataCatalog(URL, missing)).toThrow("water");
  });
});
