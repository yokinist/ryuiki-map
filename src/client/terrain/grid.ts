import { WIDE, WIDEST } from "../config";
import type { RiverProps } from "../data/rivers";
import type { BBox, LngLat } from "../geo";
import { type TileRange, tilesBBox } from "./basin-range";
import type { BuildDone, BuildMessage, BuildRequest } from "./grid.worker";
import { bboxAround, type GridSpec, gridSpec } from "./grid-spec";
import type { Routed } from "./hydro";

export type { GridSpec };

export interface Grid extends GridSpec, Routed {
  elev: Float32Array;
  /** 焼き込んだ河川。label の値はこの配列の添字 */
  rivers: RiverProps[];
  label: Int32Array;
}

// ---- グリッドづくり（標高・河川の読み込み、焼き込み、流向計算）は丸ごと Web Worker で ----
// メインスレッドは地図の描画と操作に専念させる（数百万セルの処理で画面が固まらないように）。
// Worker は2つ用意し、クリック地点の周りと下流用の広域の計算を別々のコアで同時に進める
type Pending = {
  resolve: (m: BuildDone) => void;
  reject: (e: Error) => void;
  say?: (text: string) => void;
  worker: Worker;
};
const pending = new Map<number, Pending>();
let nextId = 0;
const workers = Array.from(
  { length: Math.min(2, navigator.hardwareConcurrency || 2) },
  () => {
    const w = new Worker(new URL("./grid.worker.ts", import.meta.url), {
      type: "module",
    });
    w.onmessage = (e: MessageEvent<BuildMessage>) => {
      const m = e.data;
      const p = pending.get(m.id);
      if (!p) return;
      if (m.type === "progress") return p.say?.(m.text);
      pending.delete(m.id);
      if (m.type === "error") p.reject(new Error(m.message));
      else p.resolve(m);
    };
    w.onerror = (e) => {
      for (const [id, p] of pending)
        if (p.worker === w) {
          p.reject(new Error(e.message));
          pending.delete(id);
        }
    };
    return w;
  },
);
/** 抱えている仕事が一番少ない Worker */
const idleWorker = () => {
  const load = (w: Worker) =>
    [...pending.values()].filter((p) => p.worker === w).length;
  return workers.reduce((a, b) => (load(b) < load(a) ? b : a));
};

/** 標高タイルと河川データを読み、流向を計算したグリッドを作る */
export async function buildGrid(
  bbox: BBox,
  opts: { z?: number; say?: (text: string) => void } = {},
): Promise<Grid> {
  const id = nextId++;
  const worker = idleWorker();
  const done = await new Promise<BuildDone>((resolve, reject) => {
    pending.set(id, { resolve, reject, say: opts.say, worker });
    worker.postMessage({ id, bbox, z: opts.z } satisfies BuildRequest);
  });
  if (import.meta.env.DEV) console.info(`[grid] ${done.timing}`);
  // 関数を含む GridSpec は Worker から渡せないので、同じ入力からこちらでも作る（決まったズームなら同じ結果になる）
  const spec = gridSpec(bbox, done.Z);
  const { elev, rivers, label, down, order, acc } = done;
  return { ...spec, elev, rivers, label, down, order, acc };
}

// ---- 読み込み済みのグリッド ----
export const grids: {
  local: Grid | null;
  wides: Grid[];
  /** さかのぼり専用の粗い範囲（WIDEST）。wides に入れると下りの乗り換えで粗い範囲が選ばれるので別に持つ */
  widest: Grid | null;
} = {
  local: null,
  wides: [],
  widest: null,
};

const all = () =>
  [grids.local, ...grids.wides].filter((g): g is Grid => g !== null);

/** その地点を含むグリッド（詳細グリッド優先） */
export const gridAt = ([lon, lat]: LngLat) =>
  all().find((g) => g.toCell(lon, lat) >= 0);

/** 端から margin セル以上内側にあるか（端ぎりぎりだと乗り換えた直後にまた外へ出てしまう） */
function insideOf(g: GridSpec, [lon, lat]: LngLat, margin = 16) {
  const [x, y] = g.toPixel(lon, lat);
  return x >= margin && y >= margin && x < g.W - margin && y < g.H - margin;
}

/** p を十分内側に含むグリッド。except は除く（出てきたばかりのグリッドに戻らないように） */
export const gridAround = (p: LngLat, except?: Grid) =>
  all().find((g) => g !== except && insideOf(g, p));

/** p を中心に、ズーム z の標高タイルで縦横 tiles 枚分のグリッドを作る */
export const buildAround = (
  p: LngLat,
  z: number,
  tiles: number,
  say?: (text: string) => void,
): Promise<Grid> => buildGrid(bboxAround(p, z, tiles), { z, say });

/** p を中心にした広域グリッドを読み込んでキャッシュに足す */
export async function loadWide(p: LngLat, say?: (text: string) => void) {
  const g = await buildAround(p, WIDE.z, WIDE.tiles, say);
  addWide(g);
  return g;
}

/** キャッシュに足す。古いものから捨てる */
export function addWide(g: Grid) {
  grids.wides.push(g);
  if (grids.wides.length > WIDE.keep) grids.wides.shift();
}

/**
 * さかのぼり専用の粗い範囲を、集水域に合わせたタイルの範囲（basin-range.ts の widestTiles）で読む。
 * 同じ範囲が読み込み済み・読み込み中ならそれを使う（先読みと「上流へさかのぼる」・流域サマリが重なっても二重に読まない）
 */
let widestKey = "";
let widestLoading: { key: string; promise: Promise<Grid> } | null = null;
export function loadWidest(range: TileRange, say?: (text: string) => void) {
  const key = `${range.tx0},${range.tx1},${range.ty0},${range.ty1}`;
  if (grids.widest && widestKey === key) return Promise.resolve(grids.widest);
  if (widestLoading?.key === key) return widestLoading.promise;
  const promise = buildGrid(tilesBBox(WIDEST.z, range), {
    z: WIDEST.z,
    say,
  }).then((g) => {
    // 後から頼まれた範囲の読み込みが走っていれば、そちらを残す（古い範囲で上書きして二重に読ませない）
    if (!widestLoading || widestLoading.key === key) {
      grids.widest = g;
      widestKey = key;
    }
    return g;
  });
  widestLoading = { key, promise };
  const done = () => {
    if (widestLoading?.promise === promise) widestLoading = null;
  };
  promise.then(done, done); // 失敗は呼び出し元（basinAt）で扱う
  return promise;
}
