// 地名（市区町村・町丁・字等）を引く格子を作る
//
//   pnpm build:places          未取得の都道府県を取得し、配信用ファイルを作り直す
//   pnpm build:places --pack   取得はせず、取得済みのデータから配信用ファイルだけ作り直す
//
// 1. e-Stat「令和2年国勢調査 町丁・字等別境界データ」（世界測地系緯度経度・Shapefile、都道府県ごとの zip、合計約320MB）→ .cache/places/
//    zip は展開せず、unzip コマンドで shp・dbf をメモリに読む（手元のディスクを使わないように）
// 2. 1次メッシュ（約80km四方）ごとに GRID×GRID のマスに割り、マスの中心が入る町丁・字等を塗って、
//    public/places/<版>/ に書き出す（形式は src/client/data/places.ts の PlaceIndex・PlaceFile）。public/places/latest.json が今の版を指す
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { rle } from "../src/client/data/place-grid.ts";
import type { PlaceFile, PlaceIndex } from "../src/client/data/places.ts";
import { sleep } from "./overpass.ts";

/** 1次メッシュを縦横に割る数。1マスは経度 1/1600°・緯度 1/2400°（約56m×46m） */
const GRID = 1600;
/** 水面調査区（港・湖・海面など）。市区町村は使い、名前は出さない */
const WATER = "8154";

const PAGE = "https://www.e-stat.go.jp/gis/statmap-search?type=2";
const ZIP = (pref: string) =>
  `https://www.e-stat.go.jp/gis/statmap-search/data?dlserveyId=A002005212020&code=${pref}&coordSys=1&format=shape&downloadType=5&datum=2000`;
const PREFS = Array.from({ length: 47 }, (_, i) =>
  String(i + 1).padStart(2, "0"),
);

const root = join(import.meta.dirname, "..");
const cache = join(root, ".cache", "places");
const out = join(root, "public", "places");
const zipFile = (pref: string) => join(cache, `A002005212020DDSWC${pref}.zip`);

// ---- 1. 取得 ----
mkdirSync(cache, { recursive: true });
if (process.argv[2] !== "--pack")
  for (const pref of PREFS) {
    if (existsSync(zipFile(pref))) continue;
    const res = await fetch(ZIP(pref));
    const body = Buffer.from(await res.arrayBuffer());
    // 失敗しても 200 で HTML を返すことがあるので、zip の頭（PK）で確かめる
    if (!res.ok || body.readUInt32LE(0) !== 0x04034b50)
      throw new Error(
        `${pref}: ${res.status} ${res.headers.get("content-type")}`,
      );
    writeFileSync(zipFile(pref), body);
    console.log(`[${pref}/47] ${(body.length / 1024 / 1024).toFixed(1)} MB`);
    await sleep(1500);
  }

// ---- 2. 読む ----
const readZip = (pref: string, ext: "shp" | "dbf") =>
  execFileSync("unzip", ["-p", zipFile(pref), `r2ka${pref}.${ext}`], {
    maxBuffer: 1 << 30,
  });

interface Poly {
  /** areas の添字 */
  area: number;
  bbox: [number, number, number, number];
  /** 閉じたリング [x0, y0, x1, y1, …]（最初と最後が同じ点） */
  rings: Float64Array[];
}

/** .shp のポリゴン。図形のないレコードは rings が空 */
function readShp(buf: Buffer) {
  const shapes: Omit<Poly, "area">[] = [];
  for (let off = 100; off + 8 <= buf.length; ) {
    const c = off + 8;
    off = c + buf.readInt32BE(off + 4) * 2;
    const type = buf.readInt32LE(c);
    if (type === 0) {
      shapes.push({ bbox: [0, 0, 0, 0], rings: [] });
      continue;
    }
    if (type !== 5) throw new Error(`ポリゴン以外の図形: ${type}`);
    const bbox: Poly["bbox"] = [
      buf.readDoubleLE(c + 4),
      buf.readDoubleLE(c + 12),
      buf.readDoubleLE(c + 20),
      buf.readDoubleLE(c + 28),
    ];
    const nParts = buf.readInt32LE(c + 36);
    const nPts = buf.readInt32LE(c + 40);
    const parts = Array.from({ length: nParts }, (_, i) =>
      buf.readInt32LE(c + 44 + i * 4),
    );
    parts.push(nPts);
    const p0 = c + 44 + nParts * 4;
    const rings: Float64Array[] = [];
    for (let i = 0; i < nParts; i++) {
      const r = new Float64Array((parts[i + 1] - parts[i]) * 2);
      for (let k = 0; k < r.length; k++)
        r[k] = buf.readDoubleLE(p0 + parts[i] * 16 + k * 8);
      rings.push(r);
    }
    shapes.push({ bbox, rings });
  }
  return shapes;
}

/** .dbf の行（Shift_JIS） */
function readDbf(buf: Buffer): Record<string, string>[] {
  const n = buf.readUInt32LE(4);
  const headLen = buf.readUInt16LE(8);
  const recLen = buf.readUInt16LE(10);
  const fields: { name: string; len: number }[] = [];
  for (let o = 32; buf[o] !== 0x0d; o += 32)
    fields.push({
      name: buf.toString("latin1", o, o + 11).replace(/\0.*$/, ""),
      len: buf[o + 16],
    });
  const dec = new TextDecoder("shift_jis");
  return Array.from({ length: n }, (_, i) => {
    let o = headLen + i * recLen + 1;
    const row: Record<string, string> = {};
    for (const f of fields) {
      row[f.name] = dec.decode(buf.subarray(o, o + f.len)).trim();
      o += f.len;
    }
    return row;
  });
}

const cities: PlaceIndex["cities"] = {};
/** 町丁・字等（市区町村コード＋名前で1つ。飛び地・島で同じ名前が複数の図形に分かれていても1つにまとめる） */
const areas: [number, string][] = [];
const areaId = new Map<string, number>();
const polys: Poly[] = [];
for (const pref of PREFS) {
  const shapes = readShp(readZip(pref, "shp"));
  const rows = readDbf(readZip(pref, "dbf"));
  if (shapes.length !== rows.length)
    throw new Error(`${pref}: shp ${shapes.length} 件・dbf ${rows.length} 件`);
  rows.forEach((r, i) => {
    if (!shapes[i].rings.length) return;
    const city = `${r.PREF}${r.CITY}`;
    cities[city] = [r.PREF_NAME, r.CITY_NAME];
    const name = r.HCODE === WATER ? "" : r.S_NAME;
    const key = `${city}|${name}`;
    let area = areaId.get(key);
    if (area === undefined) {
      area = areas.push([+city, name]) - 1;
      areaId.set(key, area);
    }
    polys.push({ area, ...shapes[i] });
  });
}
console.log(
  `${polys.length} 図形・${areas.length} 町丁・字等・${Object.keys(cities).length} 市区町村`,
);

// ---- 3. 1次メッシュごとに塗る ----
// 図形の外接矩形がかかる1次メッシュに振り分ける
const byMesh = new Map<number, Poly[]>();
for (const p of polys) {
  const [w, s, e, n] = p.bbox;
  for (let lat = Math.floor(s * 1.5); lat <= Math.floor(n * 1.5); lat++)
    for (let lon = Math.floor(w - 100); lon <= Math.floor(e - 100); lon++) {
      const m1 = lat * 100 + lon;
      const list = byMesh.get(m1);
      if (list) list.push(p);
      else byMesh.set(m1, [p]);
    }
}

/** 1次メッシュの各マスの中心が入る町丁・字等（areas の添字+1。どこにも入らなければ0）。偶奇規則で、穴のあるポリゴンも塗れる */
function raster(m1: number, list: Poly[]) {
  const grid = new Int32Array(GRID * GRID);
  const lon0 = 100 + (m1 % 100);
  const y0 = Math.floor(m1 / 100); // 緯度 × 1.5
  const yOf = (j: number) => (y0 + (j + 0.5) / GRID) / 1.5;
  for (const poly of list) {
    const j0 = Math.max(0, Math.ceil((poly.bbox[1] * 1.5 - y0) * GRID - 0.5));
    const j1 = Math.min(
      GRID - 1,
      Math.floor((poly.bbox[3] * 1.5 - y0) * GRID - 0.5),
    );
    if (j1 < j0) continue;
    const xs: number[][] = Array.from({ length: j1 - j0 + 1 }, () => []);
    for (const r of poly.rings)
      for (let k = 0; k + 3 < r.length; k += 2) {
        const ya = r[k + 1];
        const yb = r[k + 3];
        if (ya === yb) continue;
        // 辺は下端を含み上端を含まない（頂点を2回数えない）
        const ja = Math.max(
          j0,
          Math.ceil((Math.min(ya, yb) * 1.5 - y0) * GRID - 0.5),
        );
        const jb = Math.min(
          j1,
          Math.ceil((Math.max(ya, yb) * 1.5 - y0) * GRID - 0.5) - 1,
        );
        for (let j = ja; j <= jb; j++)
          xs[j - j0].push(
            r[k] + ((r[k + 2] - r[k]) * (yOf(j) - ya)) / (yb - ya),
          );
      }
    for (let j = j0; j <= j1; j++) {
      const row = xs[j - j0].sort((a, b) => a - b);
      for (let k = 0; k + 1 < row.length; k += 2) {
        const ia = Math.max(0, Math.ceil((row[k] - lon0) * GRID - 0.5));
        const ib = Math.min(
          GRID - 1,
          Math.ceil((row[k + 1] - lon0) * GRID - 0.5) - 1,
        );
        // 区間がメッシュの外（東西）なら塗らない（fill は負の終わりを末尾からと読むので、ここで除く）
        if (ia <= ib)
          grid.fill(poly.area + 1, j * GRID + ia, j * GRID + ib + 1);
      }
    }
  }
  return grid;
}

// ---- 4. 書き出す ----
const version = new Date().toISOString().slice(0, 10).replaceAll("-", "");
mkdirSync(out, { recursive: true });
for (const d of readdirSync(out))
  if (/^\d{8}$/.test(d) && d !== version)
    rmSync(join(out, d), { recursive: true });
const dir = join(out, version);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const meshes: number[] = [];
let bytes = 0;
let gz = 0;
const sizes: [number, number][] = [];
for (const m1 of [...byMesh.keys()].sort((a, b) => a - b)) {
  const grid = raster(m1, byMesh.get(m1) ?? []);
  // ファイルの中だけで通じる番号（1から）に振り直す。0 はどこにも入らないマス
  const local = new Map<number, number>();
  const file: PlaceFile = { areas: [], rows: [] };
  for (let j = 0; j < GRID; j++) {
    const row = grid.subarray(j * GRID, (j + 1) * GRID).map((v) => {
      if (!v) return 0;
      let k = local.get(v);
      if (k === undefined) {
        k = file.areas.push(areas[v - 1]);
        local.set(v, k);
      }
      return k;
    });
    file.rows.push(rle(row));
  }
  if (!file.areas.length) continue;
  // 画面側は番号を Uint16Array に広げる（src/client/data/places.ts の rowOf）。今は最多で2万弱
  if (file.areas.length > 0xffff)
    throw new Error(
      `${m1}: 町丁・字等が ${file.areas.length} 件（65535 まで）`,
    );
  const json = JSON.stringify(file);
  writeFileSync(join(dir, `${m1}.json`), json);
  meshes.push(m1);
  const z = gzipSync(json).length;
  bytes += json.length;
  gz += z;
  sizes.push([m1, z]);
}
const index: PlaceIndex = { grid: GRID, meshes, cities };
writeFileSync(join(dir, "index.json"), JSON.stringify(index));
writeFileSync(join(out, "latest.json"), JSON.stringify({ version }));
writeFileSync(
  join(out, "README.txt"),
  `このフォルダのデータは、流域探索マップ（地図アプリ）で地名（市区町村・町丁・字等）を出すためのものです。

出典: 政府統計の総合窓口(e-Stat)（https://www.e-stat.go.jp/ ） ${PAGE}
  「令和2年国勢調査 町丁・字等別境界データ」（総務省統計局）を加工して作成。
  政府統計の総合窓口(e-Stat)利用規約（https://www.e-stat.go.jp/terms-of-use 。政府標準利用規約（第2.0版）に準拠）に基づき利用しています。
加工内容: 1次メッシュ（経度1°×緯度40′、約80km四方）を縦横${GRID}に割り（1マスは約56m×46m）、マスの中心が入る町丁・字等を塗って、
  行ごとに同じ値の連なりをまとめました。境界から1マス以内では、隣の町丁・字等になることがあります。水面調査区（港・海面など）は名前を外し、市区町村だけにしています。
  令和2年10月1日現在の区域・名前です。

形式（latest.json が指す版のフォルダ）:
  index.json = { grid: ${GRID}, meshes: [ファイルがある1次メッシュ番号, ...], cities: { 市区町村コード: [都道府県名, 市区町村名] } }
  1次メッシュ番号.json = { areas: [[市区町村コード, 町丁・字等の名前], ...], rows: [行, ...] }
    rows は南の行から順に、西から [areas の番号（1から。0 はどこにも入らない）, 続くマスの数, ...]
`,
);
sizes.sort((a, b) => b[1] - a[1]);
console.log(
  `${meshes.length} files, JSON ${(bytes / 1024 / 1024).toFixed(1)} MB（gzip ${(gz / 1024 / 1024).toFixed(1)} MB）→ ${dir}`,
);
console.log(
  `gzip の大きいファイル: ${sizes
    .slice(0, 5)
    .map(([m, z]) => `${m} ${(z / 1024).toFixed(0)}KB`)
    .join("・")}`,
);
