// 地理院の陰影起伏図は海だけのタイルがなく 404 を返す。ブラウザのコンソールにエラーが並ぶので、
// 無いタイルの一覧を作り、地図側で問い合わせずに済ませる（src/client/map/sea-tiles.ts）。
//
//   pnpm build:hill     親が無ければ子も無いので、上のズームから子をたどって HEAD で確かめる（約1,500件・1回きりでよい）
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  HILL_INDEX_MAX_Z,
  HILL_INDEX_MIN_Z,
} from "../src/client/map/sea-tiles.ts";

const out = join(
  import.meta.dirname,
  "..",
  "src",
  "client",
  "map",
  "hill-missing.json",
);
/** 地図を動かせる範囲（main.ts の maxBounds）[西, 南, 東, 北] */
const BOUNDS = [124.5, 26.5, 150, 49.6];
const URL = "https://cyberjapandata.gsi.go.jp/xyz/hillshademap";

const lon2x = (lon: number, z: number) =>
  Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z,
  );
};
const inBounds = (z: number, x: number, y: number) =>
  x >= lon2x(BOUNDS[0], z) &&
  x <= lon2x(BOUNDS[2], z) &&
  y >= lat2y(BOUNDS[3], z) &&
  y <= lat2y(BOUNDS[1], z);

async function exists(z: number, x: number, y: number) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${URL}/${z}/${x}/${y}.png`, { method: "HEAD" });
      if (r.status === 200) return true;
      if (r.status === 404) return false;
      throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (i >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

async function pool<T, R>(items: T[], n: number, f: (t: T) => Promise<R>) {
  const out: R[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await f(items[k]);
      }
    }),
  );
  return out;
}

const missing: string[] = [];
let tiles: [number, number, number][] = [];
for (
  let x = lon2x(BOUNDS[0], HILL_INDEX_MIN_Z);
  x <= lon2x(BOUNDS[2], HILL_INDEX_MIN_Z);
  x++
)
  for (
    let y = lat2y(BOUNDS[3], HILL_INDEX_MIN_Z);
    y <= lat2y(BOUNDS[1], HILL_INDEX_MIN_Z);
    y++
  )
    tiles.push([HILL_INDEX_MIN_Z, x, y]);

for (let z = HILL_INDEX_MIN_Z; z <= HILL_INDEX_MAX_Z; z++) {
  // 地理院への負荷を抑えて同時4件
  const ok = await pool(tiles, 4, ([z, x, y]) => exists(z, x, y));
  const next: [number, number, number][] = [];
  tiles.forEach(([z, x, y], i) => {
    if (!ok[i]) {
      missing.push(`${z}/${x}/${y}`);
      return;
    }
    for (const [cx, cy] of [
      [2 * x, 2 * y],
      [2 * x + 1, 2 * y],
      [2 * x, 2 * y + 1],
      [2 * x + 1, 2 * y + 1],
    ])
      if (z < HILL_INDEX_MAX_Z && inBounds(z + 1, cx, cy))
        next.push([z + 1, cx, cy]);
  });
  console.log(
    `z${z}: ${tiles.length}件を確認、無いタイル 累計${missing.length}件`,
  );
  tiles = next;
}

writeFileSync(out, `${JSON.stringify(missing)}\n`);
console.log(`${out} に書き出しました`);
