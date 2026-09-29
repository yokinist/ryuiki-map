import type { LngLat } from "../geo";
import { snap } from "./hydro";

// 雨の流れをたどる計算の中心。grid.ts（Web Worker を起動する）を読まないので、Vitest から小さな格子で確かめられる

/** たどるのに要るグリッドの部分 */
export interface TraceGrid {
  W: number;
  H: number;
  cellM: number;
  down: Int32Array;
  elev: Float32Array;
  acc: Float32Array;
  lngLat: (c: number) => LngLat;
  toCell: (lon: number, lat: number) => number;
}

/** 隣り合うセル p, q の間の距離 m */
export function stepM(g: TraceGrid, p: number, q: number) {
  const diagonal = q % g.W !== p % g.W && ((q / g.W) | 0) !== ((p / g.W) | 0);
  return diagonal ? g.cellM * Math.SQRT2 : g.cellM;
}

/** 1つのグリッド内で s から海（または範囲の端）まで */
export function traceIn(g: TraceGrid, s: number) {
  const cells = [s];
  const dist = [0];
  let p = s;
  let len = 0;
  let toSea = false;
  while (g.down[p] >= 0) {
    const q = g.down[p];
    len += stepM(g, p, q);
    p = q;
    cells.push(p);
    dist.push(len);
    if (Number.isNaN(g.elev[p])) {
      toSea = true;
      break;
    }
  }
  return { cells, dist, toSea };
}

/** 乗り換えの上限。行ったり来たりしても終わるように */
export const MAX_HOPS = 8;

/**
 * s から海まで。グリッドの端に出たら next で得た次のグリッドに乗り換えて続きを追う（next が null なら止まる）。
 * onSegment: グリッドごとの区間を受け取る（川の名前を引くなど）。base は区間の先頭が全体の何点目か
 */
export async function traceDown<G extends TraceGrid>(
  g: G,
  s: number,
  next: (exit: LngLat, g: G) => Promise<G | null>,
  onSegment?: (g: G, cells: number[], base: number) => void,
): Promise<{ pts: LngLat[]; dist: number[]; toSea: boolean }> {
  const pts: LngLat[] = [];
  const dist: number[] = [];
  let toSea = false;
  let off = 0;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const tr = traceIn(g, s);
    onSegment?.(g, tr.cells, pts.length);
    tr.cells.forEach((c, i) => {
      pts.push(g.lngLat(c));
      dist.push(off + tr.dist[i]);
    });
    off = dist[dist.length - 1];
    if (tr.toSea) {
      toSea = true;
      break;
    }
    const exit = pts[pts.length - 1];
    const n = await next(exit, g);
    if (!n) break;
    g = n;
    s = snap(g.acc, g.W, g.H, g.toCell(...exit), 2);
    if (Number.isNaN(g.elev[s])) {
      toSea = true;
      break;
    }
  }
  return { pts, dist, toSea };
}
