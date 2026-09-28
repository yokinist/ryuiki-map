import { describe, expect, it } from "vitest";
import { landIndex, mesh1Bounds, mesh3Km2, meshOf } from "./karte-format";
import {
  annualMeanMm,
  damsNearPath,
  longestFlowKm,
  mesh3Lat,
  pathMeshWeights,
  summarizeMeshes,
  summarizePathLand,
} from "./karte-stats";

describe("地域メッシュ", () => {
  it("経度・緯度から1次メッシュと3次メッシュの番号を求める（東京駅は 5339-46-11）", () => {
    // 東京駅 139.7671, 35.6812 → 3次メッシュ 53394611
    const { m1, sub } = meshOf(139.7671, 35.6812);
    expect(m1).toBe(5339);
    expect(sub).toBe(4611);
  });

  it("3次メッシュの中心の緯度は、そのメッシュの中に入る", () => {
    const { m1, sub } = meshOf(139.7671, 35.6812);
    const lat = mesh3Lat(m1 * 10000 + sub);
    expect(meshOf(139.7671, lat)).toEqual({ m1, sub });
  });

  it("1次メッシュの範囲は経度1°・緯度40分", () => {
    const [w, s, e, n] = mesh1Bounds(5339);
    expect([w, e]).toEqual([139, 140]);
    expect(s).toBeCloseTo(35.3333, 3);
    expect(n).toBeCloseTo(36, 6);
  });

  it("3次メッシュは約1km四方（東京付近で約1.04km²）", () => {
    expect(mesh3Km2(35.68)).toBeCloseTo(1.04, 1);
  });
});

describe("流域サマリの集計", () => {
  const key = 53394611;
  const full = mesh3Km2(mesh3Lat(key));

  it("メッシュの半分が流域に入るなら、人口も半分として数える", () => {
    const rows = new Map([[key, [4611, 100, 120, 140, 50, 20, 30, 0, 0, 0]]]);
    const s = summarizeMeshes(new Map([[key, full / 2]]), rows);
    expect(s.population).toEqual([50, 60, 70]);
    expect(s.land[0]).toBeCloseTo(0.5);
    expect(s.land[2]).toBeCloseTo(0.3);
    expect(s.coverage).toBe(1);
  });

  it("データのないメッシュ（海・範囲外）は覆えた割合を下げ、土地の割合には入れない", () => {
    const rows = new Map([[key, [4611, 0, 0, 0, 100, 0, 0, 0, 0, 0]]]);
    const s = summarizeMeshes(
      new Map([
        [key, 1],
        [key + 1, 1],
      ]),
      rows,
    );
    expect(s.coverage).toBeCloseTo(0.5);
    expect(s.land[0]).toBeCloseTo(1);
  });

  it("WorldCover の分類を6つにまとめる", () => {
    expect(landIndex(10)).toBe(0); // 樹木 → 森林
    expect(landIndex(40)).toBe(1); // 耕作地 → 農地
    expect(landIndex(50)).toBe(2); // 建物 → 市街地
    expect(landIndex(90)).toBe(4); // 湿地 → 水面・湿地
    expect(landIndex(60)).toBe(5); // 裸地 → その他
  });

  it("日ごとの降水量から年平均を出す（欠測は除く）", () => {
    expect(annualMeanMm([1, null, 3])).toBeCloseTo(730.5);
    expect(annualMeanMm([null])).toBeNull();
  });
});

describe("longestFlowKm", () => {
  it("枝分かれした上流のうち、出口までいちばん遠い経路の長さを返す", () => {
    // 3x3グリッド。出口は中央下(7)。左上(0)から斜めに7セル分下るのが最長経路
    // 0 1 2
    // 3 4 5
    // 6 7 8
    const W = 3;
    // down[c] = 流れ込む先のセル。-1は出口自身
    const down = new Int32Array([4, 4, 4, 4, 7, 4, 7, -1, 7]);
    const order = new Int32Array([7, 4, 6, 8, 0, 1, 2, 3, 5]); // 出口→…→水源の順
    const up = new Uint8Array([1, 1, 0, 1, 1, 0, 1, 1, 0]);
    const cellM = 100;
    const s = 7;
    // 0→4 は斜め(√2)、4→7 は直進。最長は 0→4→7 = 100√2 + 100
    expect(longestFlowKm(down, order, up, W, cellM, s)).toBeCloseTo(
      (100 * Math.SQRT2 + 100) / 1000,
    );
  });

  it("水源がすぐ隣なら、その距離だけになる", () => {
    const W = 2;
    const down = new Int32Array([1, -1]);
    const order = new Int32Array([1, 0]);
    const up = new Uint8Array([1, 1]);
    expect(longestFlowKm(down, order, up, W, 50, 1)).toBeCloseTo(0.05);
  });
});

describe("pathMeshWeights", () => {
  it("流路の線分の長さを通過メッシュに按分する", () => {
    const pts: [number, number][] = [
      [138.0, 37.0],
      [138.005, 37.0],
    ];
    const w = pathMeshWeights(pts);
    expect([...w.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(400);
    expect(w.size).toBeGreaterThan(0);
  });

  it("メッシュの土地割合を流路の長さで加重平均する", () => {
    const key = 53394611;
    const rows = new Map([[key, [4611, 0, 0, 0, 80, 10, 10, 0, 0, 0]]]);
    const s = summarizePathLand(new Map([[key, 1000]]), rows);
    expect(s).not.toBeNull();
    if (!s) return;
    expect(s.land[0]).toBeCloseTo(0.8);
    expect(s.coverage).toBe(1);
  });
});

describe("damsNearPath", () => {
  // 東へまっすぐ約900m（経度0.01°）進む流路
  const pts: [number, number][] = [
    [138.0, 37.0],
    [138.005, 37.0],
    [138.01, 37.0],
  ];

  it("流路の近くのダム・堰を、流路の順に拾う", () => {
    const found = damsNearPath(pts, [
      [138.0099, 37.0005, 0, "下のダム"], // 約55m
      [138.0001, 37.0, 1, "上の堰"],
    ]);
    expect(found).toEqual([
      { step: 0, kind: 1, name: "上の堰" },
      { step: 2, kind: 0, name: "下のダム" },
    ]);
  });

  it("遠いもの・名前のない堰は除き、同じ名前は1つにまとめる", () => {
    const found = damsNearPath(pts, [
      [138.005, 37.01, 0, "遠いダム"], // 約1.1km
      [138.005, 37.0, 1, ""],
      [138.005, 37.0, 0, "Aダム"],
      [138.0051, 37.0001, 0, "Aダム"],
      [138.01, 37.0, 0, ""], // 名前のないダムは出す
    ]);
    expect(found).toEqual([
      { step: 1, kind: 0, name: "Aダム" },
      { step: 2, kind: 0, name: "" },
    ]);
  });

  it("名前のあるダムのすぐ近くにある名前のない点は、同じダムとみなして除く", () => {
    const found = damsNearPath(pts, [
      [138.005, 37.0, 0, "Bダム"],
      [138.006, 37.0, 0, ""], // 約90m 離れた重複
    ]);
    expect(found).toEqual([{ step: 1, kind: 0, name: "Bダム" }]);
  });
});
