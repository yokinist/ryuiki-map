import { describe, expect, it } from "vitest";
import type { LngLat } from "../geo";
import {
  joinIndex,
  reverseToSource,
  type TraceGrid,
  traceDown,
  traceIn,
} from "./trace-core";

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

describe("traceDown の cut: 途中で止める・細かい範囲に乗り換える", () => {
  it("stop を返した点で止め、stopped になる（クリック地点に着いた）", async () => {
    const a = row(0, 6);
    const t = await traceDown(
      a,
      0,
      async () => null,
      undefined,
      (p) => (p[0] === 3.5 ? "stop" : null),
    );
    expect(t.stopped).toBe(true);
    expect(t.pts.map((p) => p[0])).toEqual([0.5, 1.5, 2.5, 3.5]);
    expect(t.dist[t.dist.length - 1]).toBe(300);
  });

  it("乗り換えるときに吸着の半径 r を渡すと、その範囲で一番大きい流れに乗る（細かい範囲で本流の隣の水路に乗らないように）", async () => {
    const a = row(0, 6);
    // 経度 2〜6 の細かい範囲を4行にする。上の行（y=0）は水路で出口へ、y=1・2 は流れのないセル、
    // 下の行（y=3）が本流で x=3 が海。水路から本流までは3行離れている
    const W = 4;
    const fine: TraceGrid = {
      W,
      H: 4,
      cellM: 100,
      down: new Int32Array([
        1, 2, 3, -1, -1, -1, -1, -1, -1, -1, -1, -1, 13, 14, 15, -1,
      ]),
      elev: new Float32Array([...Array(15).fill(10), Number.NaN]),
      acc: new Float32Array([
        1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 50, 60, 70, 80,
      ]),
      lngLat: (c) => [2 + (c % W) + 0.5, (c / W) | 0],
      toCell: (lon, lat) => Math.floor(lat) * W + Math.floor(lon - 2),
    };
    const stay = await traceDown(
      a,
      0,
      async () => null,
      undefined,
      (p, g) => (g === a && p[0] >= 2.5 ? { to: fine } : null),
    );
    expect(stay.toSea).toBe(false); // 半径を渡さなければ（2セル）y=0 の水路のまま。本流に乗らない
    const main = await traceDown(
      a,
      0,
      async () => null,
      undefined,
      (p, g) => (g === a && p[0] >= 2.5 ? { to: fine, r: 3 } : null),
    );
    expect(main.toSea).toBe(true);
  });

  it("別のグリッドを返した点で、そのグリッドに乗り換えて続ける（範囲の端を待たない）", async () => {
    const a = row(0, 6); // 粗い範囲
    const fine = row(2, 4, 3); // 経度 2〜6 の細かい範囲。x=3（経度 5.5）が海
    const seen: TraceGrid[] = [];
    const t = await traceDown(
      a,
      0,
      async () => null,
      (g) => {
        seen.push(g);
      },
      (p, g) => (g === a && fine.toCell(p[0], 0) >= 0 ? { to: fine } : null),
    );
    expect(seen).toEqual([a, fine]);
    expect(t.toSea).toBe(true);
    // a で 0.5, 1.5, 2.5 まで進み、2.5 で fine に乗り換えて 2.5, 3.5, 4.5, 5.5
    expect(t.pts.map((p) => p[0])).toEqual([0.5, 1.5, 2.5, 2.5, 3.5, 4.5, 5.5]);
  });

  it("abort を返した点で打ち切り、stopped にはならない（遠回りしすぎたら、つながらないとみなして早めにやめる）", async () => {
    const a = row(0, 6, 5);
    const t = await traceDown(
      a,
      0,
      async () => null,
      undefined,
      (p) => (p[0] === 2.5 ? "abort" : null),
    );
    expect(t.stopped).toBe(false);
    expect(t.toSea).toBe(false);
    expect(t.pts.map((p) => p[0])).toEqual([0.5, 1.5, 2.5]);
  });

  it("一度も stop にならなければ stopped は false（呼び出し側は粗い道のりに戻す）", async () => {
    const a = row(0, 4, 3);
    const t = await traceDown(
      a,
      0,
      async () => null,
      undefined,
      () => null,
    );
    expect(t.stopped).toBe(false);
    expect(t.toSea).toBe(true);
  });
});

describe("joinIndex: 道のりが目標の地点のそばを通ったか", () => {
  const pts: LngLat[] = [
    [139.0, 36.0],
    [139.001, 36.0],
    [139.002, 36.0],
  ];

  it("半径 m 以内に入った最初の点の添字を返す", () => {
    // 経度 0.001 度は北緯36度で約90m
    expect(joinIndex(pts, [139.002, 36.0005], 100)).toBe(2); // 約55m
    expect(joinIndex(pts, [139.0011, 36.0], 20)).toBe(1); // 約9m
  });

  it("どの点も半径の外なら -1", () => {
    expect(joinIndex(pts, [139.01, 36.01], 100)).toBe(-1);
  });
});

describe("reverseToSource: 水源から下った道のりを逆向きにして、さかのぼる道にする", () => {
  // 下り: 水源側の点 A から クリック地点側の点 D まで、100m ずつ
  const down = {
    pts: [
      [0, 3],
      [0, 2],
      [0, 1],
      [0, 0],
    ] as LngLat[],
    dist: [0, 100, 200, 300],
    stopped: true,
  };
  // 粗い道のり（クリック地点から水源へ）。添字 2 から下り始め、その先 3・4 が水源までの短い区間
  const coarse = {
    pts: [
      [0, 0],
      [0, 1.5],
      [0, 3],
      [0, 3.5],
      [0, 4],
    ] as LngLat[],
    dist: [0, 150, 300, 350, 400],
  };

  it("クリック地点が先頭、距離はクリック地点から測り、下り始めた点から水源までは粗い道のりを足す", () => {
    const r = reverseToSource(down, coarse, 2);
    expect(r?.pts).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 3.5],
      [0, 4],
    ]);
    expect(r?.dist).toEqual([0, 100, 200, 300, 350, 400]);
  });

  it("始まりの地点を渡すと先頭に足し、そこからの距離で測る（止めた点とクリック地点のすき間を埋める）", () => {
    // 止めた点 [0, 0] の 50m 手前（南）がクリック地点という想定で、[0, -0.00045]（約50m）を渡す
    const r = reverseToSource(down, coarse, 2, [0, -0.00045]);
    expect(r?.pts[0]).toEqual([0, -0.00045]);
    expect(r?.pts[1]).toEqual([0, 0]);
    expect(r?.dist[1]).toBeCloseTo(50, 0);
    expect(r?.dist[2]).toBeCloseTo(150, 0);
    expect(r?.offset).toBe(1); // 足した点の数（川の名前や支流の位置をその分ずらす）
  });

  it("クリック地点のそばを通らなかった（stopped でない）なら null。呼び出し側は粗い道のりのまま出す", () => {
    expect(reverseToSource({ ...down, stopped: false }, coarse, 2)).toBeNull();
  });
});
