// 配信用の河川タイルの形式。scripts/build-rivers.ts が書き出し、ページ（メインスレッドと Worker）が読む。
//
// 0.5°四方のタイルに、そのタイルに最初の点がある線を入れる。GeoJSON より小さくするため、
// 座標は 1/10000 度の整数にして「前の点との差分」で持ち、川の名前はタイル内の一覧を番号で参照する。
//   { "names": ["片品川", ...], "rivers": [[名前の番号, 総延長km, x0, y0, dx1, dy1, dx2, dy2, ...], ...] }
import type { BBox } from "../geo";

const TILE_DEG = 0.5;
const SCALE = 1e4;

export interface PackedTile {
  names: string[];
  rivers: number[][];
}

/** 1本の河川線。pts は [経度, 緯度, 経度, 緯度, ...] */
export interface RiverLine {
  name: string;
  /** その川の総延長 km（OSM の waterway リレーション単位か、同じ名前でつながった線の合計の大きい方） */
  km: number;
  pts: number[];
}

/** 地点を含むタイルのキー（南西角を 0.5° 単位で数えた整数 "x_y"） */
export const tileKey = (lon: number, lat: number) =>
  `${Math.floor(lon / TILE_DEG)}_${Math.floor(lat / TILE_DEG)}`;

/** bbox にかかるタイルのキー。線は最初の点のタイルに入っているので、隣から入り込む線も拾えるよう margin 度広げる */
export function tileKeysFor(bbox: BBox, margin = 0.1): string[] {
  const keys: string[] = [];
  for (
    let x = Math.floor((bbox[0] - margin) / TILE_DEG);
    x <= Math.floor((bbox[2] + margin) / TILE_DEG);
    x++
  )
    for (
      let y = Math.floor((bbox[1] - margin) / TILE_DEG);
      y <= Math.floor((bbox[3] + margin) / TILE_DEG);
      y++
    )
      keys.push(`${x}_${y}`);
  return keys;
}

export function encodeTile(lines: RiverLine[]): PackedTile {
  const names: string[] = [];
  const index = new Map<string, number>();
  const rivers = lines.map(({ name, km, pts }) => {
    let n = index.get(name);
    if (n === undefined) {
      n = names.push(name) - 1;
      index.set(name, n);
    }
    const out = [n, km];
    let px = 0;
    let py = 0;
    for (let i = 0; i < pts.length; i += 2) {
      const x = Math.round(pts[i] * SCALE);
      const y = Math.round(pts[i + 1] * SCALE);
      out.push(x - px, y - py);
      px = x;
      py = y;
    }
    return out;
  });
  return { names, rivers };
}

export function decodeTile({ names, rivers }: PackedTile): RiverLine[] {
  return rivers.map((r) => {
    const pts: number[] = [];
    let x = 0;
    let y = 0;
    for (let i = 2; i < r.length; i += 2) {
      x += r[i];
      y += r[i + 1];
      pts.push(x / SCALE, y / SCALE);
    }
    return { name: names[r[0]], km: r[1], pts };
  });
}

/**
 * タイル単位の LRU キャッシュから keys のタイルを取り出す（なければ load で読む）。
 * Map の挿入順を「最近使った順」として使い、max 枚を超えたら古いものから捨てる。今回使う分は捨てない
 */
export function cachedTiles<T>(
  cache: Map<string, Promise<T>>,
  keys: string[],
  max: number,
  load: (key: string) => Promise<T>,
): Promise<T>[] {
  const out = keys.map((k) => {
    const tile = cache.get(k) ?? load(k);
    cache.delete(k);
    cache.set(k, tile);
    return tile;
  });
  for (const k of cache.keys()) {
    if (cache.size <= Math.max(max, keys.length)) break;
    cache.delete(k);
  }
  return out;
}

// ---- 配信場所: /rivers/latest.json が今の版を指し、タイルは /rivers/<版>/ に置く ----
// 版ごとに URL が変わるので、タイルは長期間キャッシュできる（_headers を参照）
let base: Promise<{ url: string; keys: Set<string> }> | null = null;

/** 今の版のタイル置き場と、存在するタイルの一覧 */
function riverIndex(root: string) {
  base ??= fetch(`${root}/latest.json`)
    .then((r) =>
      r.ok ? r.json() : Promise.reject(new Error(`latest.json: ${r.status}`)),
    )
    .then(async ({ version }: { version: string }) => {
      const url = `${root}/${version}`;
      const keys: string[] = await fetch(`${url}/index.json`).then((r) =>
        r.json(),
      );
      return { url, keys: new Set(keys) };
    })
    .catch(() => {
      base = null; // 読めなかったときは覚えずに、次の呼び出しでまた取りに行く
      return { url: root, keys: new Set<string>() };
    });
  return base;
}

/** タイルを1枚読んで展開する（タイル単位のキャッシュは呼び出し側で持つ） */
export async function fetchTile(
  root: string,
  key: string,
): Promise<RiverLine[]> {
  const { url, keys } = await riverIndex(root);
  if (!keys.has(key)) return [];
  const res = await fetch(`${url}/${key}.json`);
  return res.ok ? decodeTile(await res.json()) : [];
}
