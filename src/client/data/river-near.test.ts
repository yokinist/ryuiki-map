import { describe, expect, it } from "vitest";
import { nearestRiverName, riverOfWaterArea } from "./river-near";

describe("nearestRiverName", () => {
  // 東西に約900m流れる本流と、その中ほどから北へ約1.1km延びる支流（pts は [経度, 緯度, ...]）
  const lines = [
    { name: "本流", km: 50, pts: [138.0, 37.0, 138.01, 37.0] },
    { name: "支流", km: 5, pts: [138.005, 37.0, 138.005, 37.01] },
  ];

  it("いちばん近い河川線の名前を返す", () => {
    expect(nearestRiverName(lines, 138.002, 37.0003, 100)).toBe("本流"); // 約33m
    expect(nearestRiverName(lines, 138.0052, 37.006, 100)).toBe("支流"); // 約18m
  });

  it("線の頂点の間（線分の途中）でも距離を測る", () => {
    // 本流の2点は約900m離れている。中ほどの真上 30m の地点は、どちらの頂点からも遠い
    expect(nearestRiverName([lines[0]], 138.0025, 37.00027, 100)).toBe("本流");
  });

  it("maxM より遠ければ null（川のそばではない）", () => {
    expect(nearestRiverName(lines, 138.002, 37.003, 100)).toBeNull(); // 約330m
  });
});

describe("riverOfWaterArea", () => {
  it("水域名から、上流・下流や区分の番号を除いた川の名前を取り出す", () => {
    expect(riverOfWaterArea("後沢川")).toBe("後沢川");
    expect(riverOfWaterArea("利根川上流（３）")).toBe("利根川");
    expect(riverOfWaterArea("多摩川中・下流")).toBe("多摩川");
    expect(riverOfWaterArea("肱川水域（甲）")).toBe("肱川");
  });

  it("括弧の中が川の名前なら、そちらが測った川（本流の水域に含めた支流）", () => {
    expect(riverOfWaterArea("多摩川（三沢川）")).toBe("三沢川");
  });

  it("川の名前にならない水域名は null", () => {
    expect(riverOfWaterArea("（芦田川周辺河川等）")).toBeNull();
    expect(riverOfWaterArea("浜名湖水域（河川）")).toBeNull();
  });
});
