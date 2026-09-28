import { describe, expect, it } from "vitest";
import { easeInOut, indexAtDistance, playDuration } from "./motion";

describe("motion", () => {
  it("距離から通り過ぎた最後の点を引く（点の間隔が不ぞろいでも）", () => {
    const dist = [0, 16, 32, 48, 178, 308, 438]; // 途中から粗い計算範囲に乗り換えて間隔が広がる
    expect(indexAtDistance(dist, 0)).toBe(0);
    expect(indexAtDistance(dist, 40)).toBe(2);
    expect(indexAtDistance(dist, 48)).toBe(3);
    expect(indexAtDistance(dist, 300)).toBe(4);
    expect(indexAtDistance(dist, 10_000)).toBe(6);
  });

  it("イージングは 0 と 1 を通り、途中は単調に増える", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(0.25)).toBeLessThan(0.25); // 動き始めはゆっくり
  });

  it("再生時間は距離に応じて伸び、10秒で頭打ち", () => {
    expect(playDuration(20_000)).toBe(2900);
    expect(playDuration(300_000)).toBe(8500);
    expect(playDuration(1_000_000)).toBe(10_000);
  });
});
