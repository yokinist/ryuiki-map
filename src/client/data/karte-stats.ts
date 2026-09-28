// 流域サマリの集計（純粋な計算だけ。テストできるように読み込み・DOM は data/karte.ts と ui/karte.ts に置く）
import type { LngLat } from "../geo";
import {
  CENSUS_YEARS,
  type DamRow,
  LAND,
  type MeshRow,
  mesh3Km2,
  meshOf,
  ROW,
} from "./karte-format";

/** 3次メッシュのキー（1次メッシュ番号 × 10000 + 1次メッシュ内の番号）の中心の緯度 */
export function mesh3Lat(key: number) {
  const p = Math.floor(key / 1_000_000);
  const sub = key % 10000;
  const q = Math.floor(sub / 1000);
  const r = Math.floor(sub / 10) % 10;
  return (p + (q + (r + 0.5) / 10) / 8) / 1.5;
}

export interface MeshSummary {
  /** 国勢調査の年ごとの人口。メッシュのうち流域に入る面積の割合で按分した推定 */
  population: number[];
  /** LAND ごとの面積の割合（0〜1、合計1） */
  land: number[];
  /** 流域の面積のうち、メッシュのデータで覆えた割合（0〜1）。低ければデータの範囲外 */
  coverage: number;
}

/**
 * 流域に入る面積（3次メッシュのキー → km²）と、メッシュのデータから人口と土地の使われ方を集計する。
 * ponytail: 人口は1kmメッシュの中で均等に住んでいると仮定して面積で按分する。小さな流域ほど誤差が大きい
 */
export function summarizeMeshes(
  inBasin: Map<number, number>,
  rows: Map<number, MeshRow>,
): MeshSummary {
  const population = CENSUS_YEARS.map(() => 0);
  const land = LAND.map(() => 0);
  let total = 0;
  let known = 0;
  for (const [key, km2] of inBasin) {
    total += km2;
    const row = rows.get(key);
    if (!row) continue;
    known += km2;
    const share = Math.min(1, km2 / mesh3Km2(mesh3Lat(key)));
    for (let i = 0; i < CENSUS_YEARS.length; i++)
      population[i] += row[ROW.pop + i] * share;
    for (let i = 0; i < LAND.length; i++)
      land[i] += (row[ROW.land + i] / 100) * km2;
  }
  const landSum = land.reduce((a, b) => a + b, 0);
  return {
    population: population.map(Math.round),
    land: land.map((v) => (landSum ? v / landSum : 0)),
    coverage: total ? known / total : 0,
  };
}

/** 流路 pts の各線分の長さ m を、通過する3次メッシュごとに足す */
export function pathMeshWeights(pts: LngLat[]): Map<number, number> {
  const weights = new Map<number, number>();
  if (pts.length < 2) return weights;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const lat = (y0 + y1) / 2;
    const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
    const len = Math.hypot((x1 - x0) * kx, (y1 - y0) * 110_574);
    const { m1, sub } = meshOf((x0 + x1) / 2, lat);
    const key = m1 * 10000 + sub;
    weights.set(key, (weights.get(key) ?? 0) + len);
  }
  return weights;
}

/** 流路が通る1kmメッシュの土地の使われ方を、線分の長さで加重平均する */
export function summarizePathLand(
  weights: Map<number, number>,
  rows: Map<number, MeshRow>,
): { land: number[]; coverage: number } | null {
  const land = LAND.map(() => 0);
  let total = 0;
  let known = 0;
  for (const [key, len] of weights) {
    total += len;
    const row = rows.get(key);
    if (!row) continue;
    known += len;
    for (let i = 0; i < LAND.length; i++)
      land[i] += (row[ROW.land + i] / 100) * len;
  }
  if (!known) return null;
  const sum = land.reduce((a, b) => a + b, 0);
  return {
    land: land.map((v) => (sum ? v / sum : 0)),
    coverage: total ? known / total : 0,
  };
}

/** 日ごとの降水量 mm（欠測は null）から、1年あたりの平均 mm */
export function annualMeanMm(daily: (number | null)[]) {
  let sum = 0;
  let days = 0;
  for (const v of daily)
    if (v !== null) {
      sum += v;
      days++;
    }
  return days ? (sum / days) * 365.25 : null;
}

/**
 * 範囲（up マスク）の中で最も水源から遠い地点から、出口セル s までの川筋に沿った距離 km。
 * down で下流へ、order は下流側が必ず先に来る順（route() の保証）なので、1回なめるだけで求まる
 */
export function longestFlowKm(
  down: Int32Array,
  order: Int32Array,
  up: Uint8Array,
  W: number,
  cellM: number,
  s: number,
): number {
  const dist = new Float32Array(down.length);
  let maxM = 0;
  for (const c of order) {
    if (!up[c] || c === s) continue;
    const d = down[c];
    const dx = (c % W) - (d % W);
    const dy = ((c / W) | 0) - ((d / W) | 0);
    dist[c] = dist[d] + (dx !== 0 && dy !== 0 ? cellM * Math.SQRT2 : cellM);
    if (dist[c] > maxM) maxM = dist[c];
  }
  return maxM / 1000;
}

export interface DamOnPath {
  /** 流路上の位置（いちばん近い点の添字） */
  step: number;
  /** 0=ダム 1=堰 */
  kind: 0 | 1;
  name: string;
}

/**
 * 流路 pts から maxM 以内にあるダム・堰を、流路の順に返す。
 * 名前のない堰は数が多く時系列が埋まるので除く。1つのダムが重ねて登録されていることがあるので、同じ名前は最初の1つにまとめる
 */
export function damsNearPath(
  pts: LngLat[],
  dams: DamRow[],
  maxM = 250,
): DamOnPath[] {
  if (!pts.length) return [];
  // 流路を囲む範囲の外のダムは、点ごとの距離を測る前に除く
  const margin = maxM / 90_000; // 度。緯度1度 ≈ 111km なので少し広めに
  let [w, s, e, n] = [pts[0][0], pts[0][1], pts[0][0], pts[0][1]];
  for (const [x, y] of pts) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  const kx = 111_320 * Math.cos((((s + n) / 2) * Math.PI) / 180);
  const found: (DamOnPath & { x: number; y: number })[] = [];
  const seen = new Set<string>();
  for (const [x, y, kind, name] of dams) {
    if (kind === 1 && !name) continue;
    if (x < w - margin || x > e + margin || y < s - margin || y > n + margin)
      continue;
    let best = -1;
    let bestD = maxM * maxM;
    for (let i = 0; i < pts.length; i++) {
      const dx = (pts[i][0] - x) * kx;
      const dy = (pts[i][1] - y) * 110_574;
      const d = dx * dx + dy * dy;
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) continue;
    const key = name || `${kind}@${best}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ step: best, kind, name, x, y });
  }
  // 名前のあるダムが、名前のない点としても重ねて登録されていることがある。すぐ近く（300m 以内）なら同じものとみなす
  const named = found.filter((d) => d.name);
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    ((a.x - b.x) * kx) ** 2 + ((a.y - b.y) * 110_574) ** 2 < 300 ** 2;
  return found
    .filter((d) => d.name || !named.some((m) => near(d, m)))
    .sort((a, b) => a.step - b.step)
    .map(({ step, kind, name }) => ({ step, kind, name }));
}
