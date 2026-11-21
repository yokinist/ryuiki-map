import { describe, expect, it } from "vitest";
import { surveyNearPath } from "./survey-points";

describe("surveyNearPath", () => {
  // 東へまっすぐ約900m（経度0.01°）進む流路
  const pts: [number, number][] = [
    [138.0, 37.0],
    [138.005, 37.0],
    [138.01, 37.0],
  ];

  it("流路の近く（250m 以内）の調査地点を、流路の順に拾う", () => {
    const found = surveyNearPath({ pts }, [
      [138.0099, 37.0005, 2, "下の橋", "2025-07-20", null], // 約55m
      [138.0001, 37.0, 1, "上の橋", "2025-07-20", null],
      [138.005, 37.01, 1, "隣の川", "2025-07-20", null], // 約1.1km
    ]);
    expect(found.map((s) => [s.step, s.name])).toEqual([
      [0, "上の橋"],
      [2, "下の橋"],
    ]);
  });

  it("調査地点の川が、流路のその位置の川と違えば出さない（近くを流れる支流の調査地点）", () => {
    const rivers = [
      { name: "本流", step: 0 },
      { name: "下流川", step: 2 },
    ];
    const found = surveyNearPath({ pts, rivers }, [
      [138.0, 37.0, 1, "本流の橋", "2025-07-20", "本流"],
      [138.005, 37.0, 1, "支流の橋", "2025-07-20", "支流"],
      [138.01, 37.0, 1, "下流の橋", "2025-07-20", "下流川"],
      [138.01, 37.0001, 1, "川の名前なし", "2025-07-20", null],
    ]);
    expect(found.map((s) => s.name)).toEqual([
      "本流の橋",
      "下流の橋",
      "川の名前なし",
    ]);
  });
});
