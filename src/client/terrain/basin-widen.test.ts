import { describe, expect, it } from "vitest";
import { widenBasin } from "./basin-widen";

// 候補は集水域の広さ km² と、切れているかだけの模型。読む範囲は「何回目か」の番号で表す
type C = { km2: number; truncated: boolean };
const c = (km2: number, truncated: boolean): C => ({ km2, truncated });

describe("widenBasin: 切れた集水域を、広げて読み直しながら数え直す", () => {
  it("はじめから収まっていれば読まない", async () => {
    let loads = 0;
    const r = await widenBasin(c(100, false), {
      load: async () => {
        loads++;
        return c(0, false);
      },
      current: () => true,
    });
    expect(loads).toBe(0);
    expect(r).toEqual({ basin: c(100, false), complete: true });
  });

  it("収まるまで読み直す（最大3回）。収まったらそこで止める", async () => {
    const seq = [c(200, true), c(300, false)];
    let loads = 0;
    const r = await widenBasin(c(100, true), {
      load: async () => seq[loads++],
      current: () => true,
    });
    expect(loads).toBe(2);
    expect(r).toEqual({ basin: c(300, false), complete: true });
  });

  it("3回読んでもまだ切れていれば、いちばん広く数えた結果で終える（最後まで試したので complete）", async () => {
    let km2 = 100;
    let loads = 0;
    const r = await widenBasin(c(km2, true), {
      load: async () => {
        loads++;
        km2 += 100;
        return c(km2, true);
      },
      current: () => true,
    });
    expect(loads).toBe(3);
    expect(r).toEqual({ basin: c(400, true), complete: true });
  });

  it("広げても集水域が増えなければ、それ以上は読まない", async () => {
    let loads = 0;
    const r = await widenBasin(c(100, true), {
      load: async () => {
        loads++;
        return c(100, true);
      },
      current: () => true,
    });
    expect(loads).toBe(1);
    expect(r).toEqual({ basin: c(100, true), complete: true });
  });

  it("読めなかったら、そこまでの結果で終える（complete でない＝覚えずに次は読み直す）", async () => {
    const r = await widenBasin(c(100, true), {
      load: async () => null,
      current: () => true,
    });
    expect(r).toEqual({ basin: c(100, true), complete: false });
  });

  it("別の地点に移ったら（current が false）、次を読まずに打ち切る", async () => {
    let loads = 0;
    let asked = true;
    const r = await widenBasin(c(100, true), {
      load: async () => {
        loads++;
        asked = false; // 1回目を読んでいる間に、別の地点が聞かれた
        return c(200, true);
      },
      current: () => asked,
    });
    expect(loads).toBe(1);
    expect(r).toEqual({ basin: c(200, true), complete: false });
  });
});
