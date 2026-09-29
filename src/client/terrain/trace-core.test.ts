import { describe, expect, it } from "vitest";
import type { LngLat } from "../geo";
import { type TraceGrid, traceDown, traceIn } from "./trace-core";

/**
 * 1行の格子（W×1）を「経度 x0〜」に置いた模型。down は右隣（x+1）へ。
 * sea を指定すると、その x のセルは海（NaN）。端のセル（右端）は出口（down = -1）
 */
function row(x0: number, W: number, sea?: number): TraceGrid {
  const elev = new Float32Array(W).fill(10);
  if (sea !== undefined) elev[sea] = Number.NaN;
  const down = new Int32Array(W);
  for (let x = 0; x < W; x++) down[x] = x + 1 < W ? x + 1 : -1;
  const acc = new Float32Array(W).fill(1);
  return {
    W,
    H: 1,
    cellM: 100,
    down,
    elev,
    acc,
    lngLat: (c) => [x0 + c + 0.5, 0],
    toCell: (lon) => {
      const x = Math.floor(lon - x0);
      return x < 0 || x >= W ? -1 : x;
    },
  };
}

describe("traceIn: 1つの範囲の中で下る", () => {
  it("海（標高 NaN）に着いたら止まり、toSea になる", () => {
    const g = row(0, 5, 3);
    const t = traceIn(g, 0);
    expect(t.cells).toEqual([0, 1, 2, 3]);
    expect(t.toSea).toBe(true);
    expect(t.dist).toEqual([0, 100, 200, 300]);
  });

  it("範囲の端（出口）に着いたら止まり、toSea にはならない", () => {
    const g = row(0, 5);
    const t = traceIn(g, 2);
    expect(t.cells).toEqual([2, 3, 4]);
    expect(t.toSea).toBe(false);
  });

  it("斜めに進んだ区間は、まっすぐの √2 倍の距離になる", () => {
    // 2x2 の格子。(0,0) → (1,1) と斜めに流れ、(1,1) は出口
    const g: TraceGrid = {
      W: 2,
      H: 2,
      cellM: 100,
      down: new Int32Array([3, -1, -1, -1]),
      elev: new Float32Array([10, 10, 10, 10]),
      acc: new Float32Array([1, 1, 1, 2]),
      lngLat: (c) => [c % 2, (c / 2) | 0],
      toCell: () => -1,
    };
    expect(traceIn(g, 0).dist[1]).toBeCloseTo(100 * Math.SQRT2);
  });
});

describe("traceDown: 範囲の端に出たら次の範囲に乗り換えて続ける", () => {
  it("乗り換え先の範囲で距離を足し続け、海に着いたら止まる", async () => {
    const a = row(0, 3); // 経度 0〜3、右端が出口
    const b = row(2, 5, 3); // 経度 2〜7（a と重なる）、x=3（経度 5.5）が海
    const next = async (exit: LngLat) => (b.toCell(exit[0], 0) >= 0 ? b : null);
    const t = await traceDown(a, 0, next);
    expect(t.toSea).toBe(true);
    // a: 0,1,2（200m）→ 出た点（経度 2.5）を b で引き直して 0,1,2,3（+300m）。乗り換えの点は2回入る
    expect(t.pts.map((p) => p[0])).toEqual([0.5, 1.5, 2.5, 2.5, 3.5, 4.5, 5.5]);
    expect(t.dist[t.dist.length - 1]).toBe(500);
  });

  it("乗り換え先がなければ、そこで止まる（toSea にならない）", async () => {
    const a = row(0, 3);
    const t = await traceDown(a, 0, async () => null);
    expect(t.toSea).toBe(false);
    expect(t.pts).toHaveLength(3);
  });

  it("乗り換えは8回までで必ず終わる（行ったり来たりしても）", async () => {
    const a = row(0, 3);
    let hops = 0;
    const t = await traceDown(a, 0, async () => {
      hops++;
      return a; // いつも同じ範囲に戻る
    });
    expect(t.toSea).toBe(false);
    expect(hops).toBe(8); // 上限まで乗り換えを試してから終わる
  });
});

describe("stepM: 行ごとのセルの大きさ（rowM）があれば、それで測る", () => {
  it("北の行ほど短い。2つの行をまたぐときは平均", () => {
    // 1x3 の縦の格子。行 0〜2 のセルの大きさが 80・90・100 m
    const g: TraceGrid = {
      W: 1,
      H: 3,
      cellM: 90,
      rowM: (y) => 80 + 10 * y,
      down: new Int32Array([1, 2, -1]),
      elev: new Float32Array([10, 10, 10]),
      acc: new Float32Array([1, 2, 3]),
      lngLat: (c) => [0, c],
      toCell: () => -1,
    };
    const t = traceIn(g, 0);
    expect(t.dist).toEqual([0, 85, 180]);
  });
});
