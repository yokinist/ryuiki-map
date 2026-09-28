// OpenStreetMap の河川線（waterway=river / stream で name があるもの）から配信用の河川タイルを作る。依存なし。
//
//   pnpm build:rivers                 未取得のタイルを Overpass API で取得し、配信用タイルを作り直す（途中から再開できる）
//   pnpm build:rivers 139_36 138_36   指定した1°タイルだけ取り直してから作り直す
//   pnpm build:rivers --pack          取得はせず、取得済みのデータから配信用タイルだけ作り直す
//
// 1. 取得: 1°四方ずつ Overpass API に問い合わせ、そのまま .cache/osm/<経度>_<緯度>.json に保存する
// 2. 変換: 全タイルを読み、川ごとの総延長を求め、0.5°タイル・コンパクトな形式（src/client/data/river-format.ts）にして
//    public/rivers/<版>/ に書き出す。public/rivers/latest.json が今の版を指す
//
// Overpass API への問い合わせ方（1本ずつ・間隔・User-Agent・混雑時の取り直し）は scripts/overpass.ts。
// 取れないタイルは飛ばして最後に一覧を出す。
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  encodeTile,
  type RiverLine,
  tileKey,
} from "../src/client/data/river-format.ts";
import { overpass, sleep } from "./overpass.ts";

type Position = [number, number];
type BBox = [w: number, s: number, e: number, n: number];
interface OsmWay {
  type: "way";
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}
interface OsmRelation {
  type: "relation";
  id: number;
  members: { type: string; ref: number }[];
}
/** 取得した生データ（1°タイルごと） */
interface RawLine {
  name: string;
  rel?: number;
  pts: Position[];
}

const root = join(import.meta.dirname, "..");
const raw = join(root, ".cache", "osm");
const out = join(root, "public", "rivers");
const JAPAN: string[] = JSON.parse(
  readFileSync(join(import.meta.dirname, "japan-tiles.json"), "utf8"),
);
/** 線の間引きの許容誤差（度）。約10m。計算グリッドは最も細かくて約16mなので見た目も流向計算も変わらない */
const SIMPLIFY_DEG = 0.0001;

// ---- 1. 取得 ----
/** bbox 内の名前付きの川と、それらをまとめる waterway リレーション（1本の川としてのまとまり）を1回の問い合わせで取る */
async function fetchArea([w, s, e, n]: BBox): Promise<RawLine[]> {
  const bbox = `${s},${w},${n},${e}`;
  const elements = await overpass<OsmWay | OsmRelation>(`
    [out:json][timeout:180];
    (way["waterway"="river"]["name"](${bbox}); way["waterway"="stream"]["name"](${bbox});)->.w;
    .w out tags geom;
    relation(bw.w)["type"="waterway"]["waterway"="river"];
    out skel;
  `);
  const rel = new Map<number, number>(); // way id → それを含む waterway リレーションの id
  for (const el of elements)
    if (el.type === "relation")
      for (const m of el.members) if (m.type === "way") rel.set(m.ref, el.id);
  const lines: RawLine[] = [];
  for (const el of elements) {
    if (el.type !== "way" || !el.tags?.name || !el.geometry) continue;
    const pts = simplify(
      el.geometry.map(({ lon, lat }): Position => [lon, lat]),
      SIMPLIFY_DEG,
    ).map(([lon, lat]): Position => [+lon.toFixed(4), +lat.toFixed(4)]);
    // タイル境界をまたぐ線は隣のタイルでも返るので、最初の点がこの範囲にあるものだけ残す
    if (
      pts.length < 2 ||
      pts[0][0] < w ||
      pts[0][0] >= e ||
      pts[0][1] < s ||
      pts[0][1] >= n
    )
      continue;
    lines.push({
      name: el.tags.name,
      ...(rel.has(el.id) ? { rel: rel.get(el.id) } : {}),
      pts,
    });
  }
  return lines;
}

/** Douglas–Peucker で線を間引く */
function simplify(pts: Position[], tol: number): Position[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1e-12;
    let far = -1;
    let farD = tol;
    for (let i = a + 1; i < b; i++) {
      const d =
        Math.abs((by - ay) * (pts[i][0] - ax) - (bx - ax) * (pts[i][1] - ay)) /
        len;
      if (d > farD) {
        far = i;
        farD = d;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

mkdirSync(raw, { recursive: true });
const args = process.argv.slice(2);
const packOnly = args[0] === "--pack";
const todo = packOnly
  ? []
  : args.length
    ? args
    : JAPAN.filter((k) => !existsSync(join(raw, `${k}.json`)));
const failed: string[] = [];
for (const [i, key] of todo.entries()) {
  const [x, y] = key.split("_").map(Number);
  const t0 = Date.now();
  try {
    const lines = await fetchArea([x, y, x + 1, y + 1]);
    writeFileSync(join(raw, `${key}.json`), JSON.stringify(lines));
    console.log(
      `[${i + 1}/${todo.length}] ${key}: ${lines.length} rivers ${((Date.now() - t0) / 1000).toFixed(0)}s`,
    );
  } catch (err) {
    failed.push(key);
    console.log(
      `[${i + 1}/${todo.length}] ${key}: failed (${(err as Error).message})`,
    );
  }
  await sleep();
}

// ---- 2. 変換 ----
const lengthKm = (pts: Position[]) => {
  let km = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    km += Math.hypot(
      (x1 - x0) * 111.32 * Math.cos((((y0 + y1) / 2) * Math.PI) / 180),
      (y1 - y0) * 110.57,
    );
  }
  return km;
};
const all: RawLine[] = readdirSync(raw)
  .filter((f) => f.endsWith(".json"))
  .flatMap((f) => JSON.parse(readFileSync(join(raw, f), "utf8")) as RawLine[]);
// 川ごとの総延長。長い川ほど流向計算で深く焼き込む（本流が支流に負けないように）。次の2つの大きい方を使う
// - リレーション単位の長さ（OSM で1本の川としてまとめられているもの）
// - 同じ名前で端点がつながっている線をまとめた長さ（リレーションがない川や、リレーションから漏れた区間のため）
const relKm = new Map<number, number>();
for (const l of all)
  if (l.rel) relKm.set(l.rel, (relKm.get(l.rel) ?? 0) + lengthKm(l.pts));

const parent = all.map((_, i) => i);
const find = (i: number): number => {
  while (parent[i] !== i) i = parent[i] = parent[parent[i]];
  return i;
};
const endpoint = new Map<string, number>(); // "名前|経度,緯度" → その端点を持つ線
all.forEach((l, i) => {
  for (const [x, y] of [l.pts[0], l.pts[l.pts.length - 1]]) {
    const key = `${l.name}|${x},${y}`;
    const j = endpoint.get(key);
    if (j === undefined) endpoint.set(key, i);
    else parent[find(i)] = find(j);
  }
});
const chainKm = new Map<number, number>();
all.forEach((l, i) => {
  const r = find(i);
  chainKm.set(r, (chainKm.get(r) ?? 0) + lengthKm(l.pts));
});
const riverKm = (l: RawLine, i: number) =>
  Math.round(
    Math.max(l.rel ? (relKm.get(l.rel) ?? 0) : 0, chainKm.get(find(i)) ?? 0),
  );

const tiles = new Map<string, RiverLine[]>();
for (const [i, l] of all.entries()) {
  const key = tileKey(l.pts[0][0], l.pts[0][1]);
  const line: RiverLine = {
    name: l.name,
    km: riverKm(l, i),
    pts: l.pts.flat(),
  };
  const list = tiles.get(key);
  if (list) list.push(line);
  else tiles.set(key, [line]);
}

// 版ごとのフォルダに書き出し、古い版は消す（URL が版ごとに変わるのでタイルを長期間キャッシュできる）
const version = new Date().toISOString().slice(0, 10).replaceAll("-", "");
mkdirSync(out, { recursive: true });
for (const d of readdirSync(out))
  if (/^\d{8}$/.test(d) && d !== version)
    rmSync(join(out, d), { recursive: true });
const dir = join(out, version);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir);
let bytes = 0;
for (const [key, lines] of tiles) {
  const json = JSON.stringify(encodeTile(lines));
  bytes += json.length;
  writeFileSync(join(dir, `${key}.json`), json);
}
writeFileSync(
  join(dir, "index.json"),
  JSON.stringify([...tiles.keys()].sort()),
);
writeFileSync(join(out, "latest.json"), JSON.stringify({ version }));
writeFileSync(
  join(out, "README.txt"),
  `このフォルダのデータは、流域探索マップ（地図アプリ）の表示と流向計算のために OpenStreetMap から変換したものです。

出典: © OpenStreetMap contributors https://www.openstreetmap.org/copyright
ライセンス: Open Database License (ODbL) 1.0 https://opendatacommons.org/licenses/odbl/1-0/
  このデータ（OSM から作った派生データベース）も ODbL で提供します。再利用する場合は同じく ODbL に従ってください。
加工内容: waterway=river / stream のうち name があるものを Overpass API で取得し、線を約10mの許容誤差で間引き、
  座標を1/10000度の整数に丸め、川の総延長（km。waterway リレーション単位か、同じ名前でつながった線の合計の大きい方）を付けて0.5°四方のタイルに分割
形式: latest.json が版（フォルダ名）を指し、各タイルは { names: [川の名前...], rivers: [[名前の番号, 総延長km, x0, y0, dx1, dy1, ...], ...] }。
  座標は1/10000度の整数で、2点目以降は前の点との差分
備考: 日本の河川線の多くは「国土数値情報（河川データ）」（国土交通省）を OpenStreetMap に取り込んだものです。
  整備時点（2006年度前後）以降の河川改修や名称の変更は反映されていないことがあります。
  ナビゲーションや測量など高い精度が必要な用途には使えません。
`,
);
console.log(
  `${all.length} rivers → ${tiles.size} tiles, ${(bytes / 1024 / 1024).toFixed(1)} MB → ${dir}`,
);
if (failed.length)
  console.log(
    `取得できなかったタイル（再実行で取り直す）: ${failed.join(" ")}`,
  );
