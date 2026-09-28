import { describe, expect, it } from "vitest";
import { JAPAN_BBOX } from "./config";
import { covers, inBBox, latToY, lonToX, xToLon, yToLat } from "./geo";

describe("geo", () => {
  it("Web メルカトルの変換は往復で元に戻る", () => {
    for (const [lon, lat] of [
      [139.767, 35.681],
      [127.68, 26.21],
      [145.8, 45.5],
    ]) {
      expect(xToLon(lonToX(lon))).toBeCloseTo(lon, 9);
      expect(yToLat(latToY(lat))).toBeCloseTo(lat, 9);
    }
  });

  it("世界の端と赤道", () => {
    expect(lonToX(-180)).toBe(0);
    expect(lonToX(180)).toBe(1);
    expect(latToY(0)).toBeCloseTo(0.5);
    expect(latToY(35)).toBeLessThan(0.5); // 北ほど y が小さい
  });

  it("inBBox は日本の範囲内だけ true", () => {
    expect(inBBox([139, 35], JAPAN_BBOX)).toBe(true);
    expect(inBBox([128.5, 30.5], JAPAN_BBOX)).toBe(true);
    expect(inBBox([120, 35], JAPAN_BBOX)).toBe(false);
    expect(inBBox([139, 20], JAPAN_BBOX)).toBe(false);
  });

  it("covers は境界が一致しても覆っているとみなす", () => {
    const outer = [139, 35, 140, 36] as const;
    expect(covers([...outer], [...outer])).toBe(true);
    expect(covers([...outer], [139.2, 35.2, 139.8, 35.8])).toBe(true);
    expect(covers([...outer], [139.2, 35.2, 140.1, 35.8])).toBe(false);
  });
});
