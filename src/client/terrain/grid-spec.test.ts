import { describe, expect, it } from "vitest";
import { MAX_TILES } from "../config";
import { type LngLat, xToLon, yToLat } from "../geo";
import { bboxAround, gridSpec } from "./grid-spec";

const tileCount = (g: ReturnType<typeof gridSpec>) =>
  (g.tx1 - g.tx0 + 1) * (g.ty1 - g.ty0 + 1);

describe("gridSpec", () => {
  const g = gridSpec([139.5, 35.6, 139.6, 35.7], 13);

  it("セルの中心の経緯度からはそのセルに戻る", () => {
    for (const c of [0, g.W - 1, g.W * 100 + 37, g.W * g.H - 1])
      expect(g.toCell(...g.lngLat(c))).toBe(c);
  });

  it("範囲外の地点は -1", () => {
    expect(g.toCell(g.bbox[0] - 0.01, 35.65)).toBe(-1);
    expect(g.toCell(139.55, g.bbox[3] + 0.01)).toBe(-1);
  });

  it("グリッドは元の範囲を覆い、左上の角が bbox の北西の角になる", () => {
    expect(g.bbox[0]).toBeLessThanOrEqual(139.5);
    expect(g.bbox[1]).toBeLessThanOrEqual(35.6);
    expect(g.bbox[2]).toBeGreaterThanOrEqual(139.6);
    expect(g.bbox[3]).toBeGreaterThanOrEqual(35.7);
    const [lon, lat] = g.at(0, 0);
    expect(lon).toBeCloseTo(g.bbox[0], 9);
    expect(lat).toBeCloseTo(g.bbox[3], 9);
    expect(g.toPixel(lon, lat)[0]).toBeCloseTo(0, 6);
  });

  it("z13 のセルは約16m", () => {
    expect(g.cellM).toBeGreaterThan(15);
    expect(g.cellM).toBeLessThan(17);
  });

  it("z を省くと、タイル数が MAX_TILES に収まる一番細かいズームを選ぶ", () => {
    const wide = gridSpec([139, 35, 140, 36]);
    expect(tileCount(wide)).toBeLessThanOrEqual(MAX_TILES);
    expect(tileCount(gridSpec([139, 35, 140, 36], wide.Z + 1))).toBeGreaterThan(
      MAX_TILES,
    );
  });
});

describe("bboxAround", () => {
  // タイルの角・辺の近くでも、ちょうど tiles×tiles 枚になる
  const points: LngLat[] = [
    [139.767, 35.681],
    [xToLon(909 / 2 ** 10), yToLat(403 / 2 ** 10)], // z10 のタイルの角ちょうど
    [130.4, 33.59],
  ];
  for (const [z, tiles] of [
    [13, 6],
    [10, 6],
    [10, 5],
  ])
    it(`z${z} で ${tiles}×${tiles} 枚`, () => {
      for (const p of points) {
        const g = gridSpec(bboxAround(p, z, tiles), z);
        expect(g.tx1 - g.tx0 + 1).toBe(tiles);
        expect(g.ty1 - g.ty0 + 1).toBe(tiles);
        expect(g.toCell(...p)).toBeGreaterThanOrEqual(0);
      }
    });
});

describe("rowM: 緯度ごとのセルの大きさ", () => {
  // 北緯30〜45度にまたがる広い範囲（ズーム9）。Web メルカトルのセルは、緯度 φ で赤道の cos φ 倍になる
  const w = gridSpec([130, 30, 131, 45], 9);
  const rowAt = (lat: number) => Math.floor(w.toPixel(130.5, lat)[1]);

  it("北緯45度の行は、北緯30度の行の cos45°/cos30° 倍（約0.82倍）になる", () => {
    const ratio = w.rowM(rowAt(45)) / w.rowM(rowAt(30));
    expect(ratio).toBeCloseTo(Math.cos(Math.PI / 4) / Math.cos(Math.PI / 6), 2);
  });

  it("赤道の1セルは、地球の周長をズームの全ピクセル数で割った長さ", () => {
    const eq = gridSpec([0, -0.1, 0.1, 0.1], 9);
    const y = Math.floor(eq.toPixel(0.05, 0)[1]);
    expect(eq.rowM(y)).toBeCloseTo(40075016.686 / (256 * 2 ** 9), 0);
  });
});
