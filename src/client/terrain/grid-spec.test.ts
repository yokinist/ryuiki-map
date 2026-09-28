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
