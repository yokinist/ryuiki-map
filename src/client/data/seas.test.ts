import { describe, expect, it } from "vitest";
import { findSea, type SeaFeature } from "./seas";

const square = (
  name: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): SeaFeature => ({
  type: "Feature",
  properties: { name },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
      ],
    ],
  },
});

describe("findSea", () => {
  // 経度140度を境に西が日本海、東が太平洋（どちらも北緯35〜36度）
  const seas = [
    square("日本海", 139, 35, 140, 36),
    square("太平洋", 140, 35, 141, 36),
  ];

  it("海域の中の点はその海", () => {
    expect(findSea(seas, [140.5, 35.5])).toBe("太平洋");
    expect(findSea(seas, [139.5, 35.5])).toBe("日本海");
  });

  it("境界の外でも近ければ一番近い海（海岸線が粗くて河口が陸側に外れる場合）", () => {
    expect(findSea(seas, [140.9, 36.05])).toBe("太平洋"); // 北に約5km外れている
  });

  it("遠く離れていれば null", () => {
    expect(findSea(seas, [140.5, 37])).toBeNull(); // 北に約110km
  });
});
