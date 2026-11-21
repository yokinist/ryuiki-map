import { describe, expect, it } from "vitest";
import { codGrade } from "./mizumap";

describe("codGrade", () => {
  // 全国一斉調査の結果の概要と同じく、3 と 6 mg/L を境目にする（3未満・3〜6未満・6以上）
  it.each([
    [0, 0, "よごれは少ない"],
    [2.5, 0, "よごれは少ない"],
    [3, 1, "少しよごれている"],
    [5.5, 1, "少しよごれている"],
    [6, 2, "よごれている"],
    [8, 2, "よごれている"],
  ])("COD %s → 段階 %s「%s」", (cod, level, label) => {
    expect(codGrade(cod)).toEqual({ level, label });
  });
});
