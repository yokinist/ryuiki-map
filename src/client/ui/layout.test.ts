import { describe, expect, it } from "vitest";
import { fitPadding, MIN_FREE_PX } from "./layout";

describe("fitPadding", () => {
  it("映す範囲が十分あればそのまま", () => {
    const p = { top: 48, bottom: 48, left: 380, right: 56 };
    expect(fitPadding(p, 1280, 800)).toEqual(p);
  });

  it("縦が足りなければ、まず下（出典表示）の余白を削る", () => {
    // 375×550 のスマホ。パネルの下まで 335px、出典表示が 108px
    const p = fitPadding(
      { top: 335, bottom: 108, left: 48, right: 48 },
      375,
      550,
    );
    expect(p.top).toBe(335);
    expect(550 - p.top - p.bottom).toBe(MIN_FREE_PX);
  });

  it("下を削っても足りなければパネル側も削る（横向きのスマホ）", () => {
    const p = fitPadding(
      { top: 250, bottom: 90, left: 48, right: 48 },
      700,
      320,
    );
    expect(p.bottom).toBe(0);
    expect(p.top).toBe(120);
  });

  it("画面が MIN_FREE_PX より小さくても負の余白にはしない", () => {
    expect(
      fitPadding({ top: 100, bottom: 50, left: 0, right: 0 }, 150, 150),
    ).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });
});
