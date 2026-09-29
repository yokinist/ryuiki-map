import type { LngLat } from "../geo";
import { snap } from "./hydro";

// 雨の流れをたどる計算の中心。grid.ts（Web Worker を起動する）を読まないので、Vitest から小さな格子で確かめられる

/** たどるのに要るグリッドの部分 */
export interface TraceGrid {
  W: number;
  H: number;
  cellM: number;
  /** 行 y のセル1辺の長さ m。なければ cellM で測る */
  rowM?: (y: number) => number;
  down: Int32Array;
  elev: Float32Array;
  acc: Float32Array;
  lngLat: (c: number) => LngLat;
  toCell: (lon: number, lat: number) => number;
}

/** 隣り合うセル p, q の間の距離 m。セルの大きさは2つの行の平均（南北に長い範囲でも緯度ごとの大きさで測る） */
export function stepM(g: TraceGrid, p: number, q: number) {
  const yp = (p / g.W) | 0;
  const yq = (q / g.W) | 0;
  const m = g.rowM ? (g.rowM(yp) + g.rowM(yq)) / 2 : g.cellM;
  const diagonal = q % g.W !== p % g.W && yp !== yq;
  return diagonal ? m * Math.SQRT2 : m;
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
 * onSegment: グリッドごとの区間を受け取る（川の名前を引くなど）。base は区間の先頭が全体の何点目か。
 * cut: 各点で呼び、"stop" ならそこで止め（stopped）、"abort" ならそこで打ち切り（stopped にしない）、
 * { to } を返せば範囲の端を待たずにそのグリッドへ乗り換える。
 * r は乗り換え先で吸着させる半径（セル数）。省くと2セル
 */
export async function traceDown<G extends TraceGrid>(
  g: G,
  s: number,
  next: (exit: LngLat, g: G) => Promise<G | null>,
  onSegment?: (g: G, cells: number[], base: number) => void,
  cut?: (p: LngLat, g: G) => "stop" | "abort" | { to: G; r?: number } | null,
): Promise<{
  pts: LngLat[];
  dist: number[];
  toSea: boolean;
  stopped: boolean;
}> {
  const pts: LngLat[] = [];
  const dist: number[] = [];
  let toSea = false;
  let stopped = false;
  let off = 0;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const tr = traceIn(g, s);
    // 途中で止める・乗り換える点を探す（先頭の点は乗り換えてきた点なので見ない）
    let switchTo: { to: G; r?: number } | null = null;
    let aborted = false;
    for (let i = 1; cut && i < tr.cells.length; i++) {
      const r = cut(g.lngLat(tr.cells[i]), g);
      if (!r) continue;
      tr.cells.length = i + 1;
      tr.dist.length = i + 1;
      tr.toSea = false;
      if (r === "stop") stopped = true;
      else if (r === "abort") aborted = true;
      else switchTo = r;
      break;
    }
    onSegment?.(g, tr.cells, pts.length);
    tr.cells.forEach((c, i) => {
      pts.push(g.lngLat(c));
      dist.push(off + tr.dist[i]);
    });
    off = dist[dist.length - 1];
    if (tr.toSea) toSea = true;
    if (tr.toSea || stopped || aborted) break;
    const exit = pts[pts.length - 1];
    const n = switchTo?.to ?? (await next(exit, g));
    if (!n) break;
    g = n;
    s = snap(g.acc, g.W, g.H, g.toCell(...exit), switchTo?.r ?? 2);
    if (Number.isNaN(g.elev[s])) {
      toSea = true;
      break;
    }
  }
  return { pts, dist, toSea, stopped };
}

/** 2点間のおおよその距離 m（数百 m の判定用。緯度で経度方向を縮める平面近似） */
export function nearM([x1, y1]: LngLat, [x2, y2]: LngLat) {
  const k = Math.cos((((y1 + y2) / 2) * Math.PI) / 180);
  return Math.hypot((x2 - x1) * k, y2 - y1) * 111_320;
}

/** 道のり pts が target の半径 radiusM 以内を通った最初の点の添字。通らなければ -1 */
export function joinIndex(pts: LngLat[], target: LngLat, radiusM: number) {
  return pts.findIndex((p) => nearM(p, target) <= radiusM);
}

/**
 * 水源側から下った道のり down（クリック地点で止まったもの）を逆向きにして、クリック地点を先頭にした「さかのぼる道」にする。
 * start（クリック地点）を渡すと先頭に足し、止めた点とのすき間を埋める。offset は先頭に足した点の数。
 * 粗い道のり coarse（クリック地点から水源へ）で、下り始めた点 tip から先（水源まで）の短い区間は、そのまま足す。
 * クリック地点のそばを通らなかった（stopped でない）なら null
 */
export function reverseToSource(
  down: { pts: LngLat[]; dist: number[]; stopped: boolean },
  coarse: { pts: LngLat[]; dist: number[] },
  tip: number,
  start?: LngLat,
): { pts: LngLat[]; dist: number[]; offset: number } | null {
  if (!down.stopped) return null;
  const total = down.dist[down.dist.length - 1];
  const pts = [...down.pts].reverse();
  const gap = start ? nearM(start, pts[0]) : 0;
  const dist = down.dist.map((d) => gap + total - d).reverse();
  if (start) {
    pts.unshift(start);
    dist.unshift(0);
  }
  const end = dist[dist.length - 1];
  for (let i = tip + 1; i < coarse.pts.length; i++) {
    pts.push(coarse.pts[i]);
    dist.push(end + coarse.dist[i] - coarse.dist[tip]);
  }
  return { pts, dist, offset: start ? 1 : 0 };
}
