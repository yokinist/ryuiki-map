import type { Feature, LineString } from "geojson";
import { burnDepth, SOURCES } from "../config";
import type { BBox } from "../geo";
import {
  cachedTiles,
  fetchTile,
  type RiverLine,
  tileKeysFor,
} from "./river-format";

/** 河川の属性。グリッドの label はこの配列（Grid.rivers）の添字を指す */
export interface RiverProps {
  name: string;
  /** その川の総延長 km（OSM の waterway リレーション単位か、同じ名前でつながった線の合計の大きい方） */
  km: number;
}
export type RiverFeature = Feature<LineString, RiverProps>;

/** 流路沿いで川が変わった地点 */
export interface RiverEvent extends RiverProps {
  step: number;
}

/** 川の名前を引くのに必要なグリッドの部分 */
export interface LabelGrid {
  W: number;
  H: number;
  cellM: number;
  label: Int32Array;
  rivers: RiverProps[];
}

// ---- 地図に表示する河川（メインスレッド用。焼き込みは grid.worker.ts が別に読む） ----
/** 読み込んだタイル。MAX_CACHED を超えたら使っていないものから捨てる */
const cache = new Map<string, Promise<RiverFeature[]>>();
// ponytail: 0.5°タイルの LRU。1枚は数十〜数百KBなので80枚で足りる。全国を見て回ってもこれ以上は増えない
const MAX_CACHED = 80;
/** いま地図に渡しているタイル。表示範囲の分だけにして、地図側の描画処理を軽く保つ */
let shownKeys = "";
let latest = 0;
const listeners = new Set<(features: RiverFeature[]) => void>();

/** 地図に表示する河川が変わったときに呼ばれる */
export const onRiversChange = (fn: (features: RiverFeature[]) => void) =>
  listeners.add(fn);

const toFeature = ({ name, km, pts }: RiverLine): RiverFeature => {
  const coordinates: [number, number][] = [];
  for (let i = 0; i < pts.length; i += 2)
    coordinates.push([pts[i], pts[i + 1]]);
  return {
    type: "Feature",
    properties: { name, km },
    geometry: { type: "LineString", coordinates },
  };
};

/** 表示範囲 bbox にかかる河川タイルだけを地図に出す（読み込んだタイルはキャッシュに残す） */
export async function showRivers(bbox: BBox) {
  const keys = tileKeysFor(bbox);
  const id = ++latest;
  const tiles = cachedTiles(cache, keys, MAX_CACHED, (k) =>
    fetchTile(SOURCES.rivers, k).then((lines) => lines.map(toFeature)),
  );
  const joined = keys.join(",");
  if (joined === shownKeys) return;
  const features = (await Promise.all(tiles)).flat();
  if (id !== latest) return; // 読み込み中に地図がまた動いた
  shownKeys = joined;
  for (const fn of listeners) fn(features);
}

// ---- グリッドへの焼き込み ----
/**
 * 河川線をグリッドに焼き込む。
 * label[cell] = lines の添字、burn[cell] = 流向計算で下げる深さ m（重なったら深い方＝長い川を優先）
 */
export function rasterize(
  g: {
    W: number;
    H: number;
    toPixel: (lon: number, lat: number) => [number, number];
  },
  lines: RiverLine[],
) {
  const label = new Int32Array(g.W * g.H).fill(-1);
  const burn = new Uint8Array(g.W * g.H);
  lines.forEach(({ km, pts }, li) => {
    const depth = burnDepth(km);
    let [x0, y0] = g.toPixel(pts[0], pts[1]);
    for (let k = 2; k < pts.length; k += 2) {
      const [x1, y1] = g.toPixel(pts[k], pts[k + 1]);
      const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) + 1;
      for (let s = 0; s <= n; s++) {
        const x = Math.floor(x0 + ((x1 - x0) * s) / n);
        const y = Math.floor(y0 + ((y1 - y0) * s) / n);
        if (x < 0 || y < 0 || x >= g.W || y >= g.H) continue;
        const c = y * g.W + x;
        if (depth >= burn[c]) {
          burn[c] = depth;
          label[c] = li;
        }
      }
      x0 = x1;
      y0 = y1;
    }
  });
  return { label, burn };
}

// ---- 名前の参照 ----
function* around(g: LabelGrid, c: number, r: number) {
  const x = c % g.W;
  const y = (c / g.W) | 0;
  for (let j = Math.max(0, y - r); j <= Math.min(g.H - 1, y + r); j++)
    for (let i = Math.max(0, x - r); i <= Math.min(g.W - 1, x + r); i++)
      yield { c: j * g.W + i, d2: (i - x) ** 2 + (j - y) ** 2 };
}

/** セル c の周囲 r セル内で一番近い河川 */
function riverAt(g: LabelGrid, c: number, r: number): RiverProps | null {
  let best = -1;
  let bd = Number.POSITIVE_INFINITY;
  for (const { c: n, d2 } of around(g, c, r))
    if (g.label[n] >= 0 && d2 < bd) {
      best = g.label[n];
      bd = d2;
    }
  return best < 0 ? null : g.rivers[best];
}

/** セル c の周囲 r セル内に name の川があるか */
function nearName(g: LabelGrid, c: number, r: number, name: string) {
  for (const { c: n } of around(g, c, r))
    if (g.label[n] >= 0 && g.rivers[g.label[n]].name === name) return true;
  return false;
}

/**
 * 流路 cells 沿いの川の移り変わり。
 * isStart: 流路の出発点を含む区間か。出発点の川だけは短くても残す（クリックした沢の名前）。
 * 計算範囲を乗り換えた後の区間では、乗り換え直後に一瞬かすった川を拾わないよう、短い川は捨てる
 */
export function riversAlong(
  g: LabelGrid,
  cells: number[],
  isStart = true,
): RiverEvent[] {
  const runs: { r: RiverProps; n: number; step: number }[] = [];
  cells.forEach((p, i) => {
    const cur = runs.at(-1);
    // 今いる川が2セル以内にあればそのまま。合流点や、支流が本流に並行して流れる区間で支流の名前に飛ばないように
    const r = cur && nearName(g, p, 2, cur.r.name) ? cur.r : riverAt(g, p, 1);
    if (r && cur && r.name === cur.r.name)
      cur.n++; // 同名の別セグメントも同じ川として数える
    else if (r) runs.push({ r, n: 1, step: i });
  });
  // 1km 未満しか沿わない川は合流点のかすりなので捨て、同名の連続をまとめる
  const minCells = Math.max(5, 1000 / g.cellM);
  const out: RiverEvent[] = [];
  for (const { r, n, step } of runs)
    if (
      (n >= minCells || (isStart && !out.length)) &&
      out.at(-1)?.name !== r.name
    )
      out.push({ ...r, step });
  return out;
}
