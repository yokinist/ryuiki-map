import { describe, expect, it } from "vitest";
import { isSourceCut } from "./source-cut";

// 5x4 の範囲。左上が (0,0)、W=5 なので添字 = y*W + x
const g = { W: 5, H: 4 };
const at = (x: number, y: number) => y * g.W + x;

describe("isSourceCut: 水源まで追いきれなかったか", () => {
  it("範囲の中で終わり、集水域も収まっていれば、水源にたどり着いた", () => {
    expect(isSourceCut(g, at(2, 1), false)).toBe(false);
  });

  it("最後の点が範囲の端（左端・上端・右端・下端）なら追いきれていない", () => {
    expect(isSourceCut(g, at(0, 2), false)).toBe(true);
    expect(isSourceCut(g, at(2, 0), false)).toBe(true);
    expect(isSourceCut(g, at(4, 2), false)).toBe(true);
    expect(isSourceCut(g, at(2, 3), false)).toBe(true);
  });

  it("集水域が範囲からはみ出していれば、最後の点が範囲の中でも追いきれていない（本流が端で切れ、支流の先を選んでいる）", () => {
    expect(isSourceCut(g, at(2, 1), true)).toBe(true);
  });
});
