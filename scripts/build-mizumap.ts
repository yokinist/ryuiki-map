// 市民の水質調べ（身近な水環境の全国一斉調査）の表を作る。調査地点を、1次メッシュ単位のファイルにする
//
//   pnpm build:mizumap          未取得の年を取得し、配信用ファイルを作り直す
//   pnpm build:mizumap --pack   取得はせず、取得済みのデータから配信用ファイルだけ作り直す
//
// 1. 全国水環境マップ実行委員会が年ごとに公開している「全国データ」の Excel（MIZUMAP_YEARS の数だけ）→ .cache/mizumap/<年>.xlsx
// 2. public/mizumap/<版>/ に書き出す（形式は src/client/data/mizumap-format.ts）。public/mizumap/latest.json が今の版を指す
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { meshOf } from "../src/client/data/karte-format.ts";
import {
  MIZUMAP_YEARS,
  type MizumapRow,
} from "../src/client/data/mizumap-format.ts";
import { sleep } from "./overpass.ts";
import { riverNameAt } from "./river-names.ts";

const SITE = "https://japan-mizumap.org/";
const REPORT = `${SITE}003main/004kekka/003-report/`;
// 年ごとの結果ページからリンクされている「全国データ」。ファイル名は年によって違う
const FILES: Record<number, string> = {
  2023: "2023/parts/2023-20kekka.xlsx",
  2024: "2024/parts/2024-21kekka.xlsx",
  2025: "2025/parts/2025-22_kekka.xlsx",
};

const root = join(import.meta.dirname, "..");
const cache = join(root, ".cache", "mizumap");
const out = join(root, "public", "mizumap");
const yearFile = (year: number) => join(cache, `${year}.xlsx`);

// ---- 1. 取得 ----
mkdirSync(cache, { recursive: true });
if (process.argv[2] !== "--pack")
  for (const year of MIZUMAP_YEARS) {
    if (existsSync(yearFile(year))) continue;
    const res = await fetch(REPORT + FILES[year]);
    if (!res.ok) throw new Error(`${year}: ${res.status}`);
    writeFileSync(yearFile(year), Buffer.from(await res.arrayBuffer()));
    console.log(`${year}年 取得`);
    await sleep();
  }

// ---- 2. まとめる ----
/** xlsx の中のファイルを、展開せずに読む */
const unzip = (file: string, entry: string) =>
  execFileSync("unzip", ["-p", file, entry], {
    maxBuffer: 256 * 1024 * 1024,
  }).toString("utf8");

const unxml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

/** 1枚目のシートの行。各行は列名（A, B, …）→ 値の文字列 */
function sheetRows(file: string): Record<string, string>[] {
  // 共有文字列。<rPh> はふりがななので除く（除かないと「地点名チテンメイ」のようになる）
  const strings = [
    ...unzip(file, "xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g),
  ].map(([, si]) =>
    unxml(
      [
        ...si
          .replace(/<rPh[\s\S]*?<\/rPh>/g, "")
          .matchAll(/<t[^>]*>([^<]*)<\/t>/g),
      ]
        .map(([, t]) => t)
        .join(""),
    ),
  );
  return [
    ...unzip(file, "xl/worksheets/sheet1.xml").matchAll(
      /<row [^>]*>([\s\S]*?)<\/row>/g,
    ),
  ].map(([, row]) =>
    Object.fromEntries(
      [
        ...row.matchAll(
          // 式のセル（<f t="shared" …>MEDIAN(…)</f> や <f … />）は、計算済みの <v> を読む
          /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>(?:<f[^>]*\/>|<f[^>]*>[^<]*<\/f>)?(?:<v>([^<]*)<\/v>)?<\/c>)/g,
        ),
      ].map(([, col, attrs, v]) => [
        col,
        v === undefined ? "" : /t="s"/.test(attrs) ? strings[+v] : unxml(v),
      ]),
    ),
  );
}

/** 度・分・秒 → 度 */
const dms = (d: string, m: string, s: string) =>
  Number(d) + Number(m) / 60 + Number(s) / 3600;

/** Excel の日付（1899-12-30 からの日数）→ YYYY-MM-DD */
const day = (serial: string) =>
  new Date(Date.UTC(1899, 11, 30) + Number(serial) * 86_400_000)
    .toISOString()
    .slice(0, 10);

/** 川のそばとみなす距離 m。水生生物調査（build-suisei.ts）と同じく、参加者が置いた位置なので広めにとる */
const RIVER_NEAR_M = 200;

const byM1 = new Map<number, MizumapRow[]>();
// 同じ地点を毎年調べている団体も多い。地点名と約100m の位置が同じなら、新しい年だけ残す
const placed = new Set<string>();
let points = 0;
for (const year of [...MIZUMAP_YEARS].reverse()) {
  if (!existsSync(yearFile(year))) continue;
  const rows = sheetRows(yearFile(year));
  // 列名の行を探し、列名から列を引く（年によって列の並びが変わっても読めるように）
  const head = rows.find((r) => Object.values(r).includes("地点名"));
  if (!head) throw new Error(`${year}: 列名の行がない`);
  const col = (name: string) => {
    const c = Object.entries(head).find(([, v]) => v.startsWith(name))?.[0];
    if (!c) throw new Error(`${year}: 列「${name}」がない`);
    return c;
  };
  const [lat1, lat2, lat3, lon1, lon2, lon3] = [
    "緯度(度)",
    "緯度(分)",
    "緯度(秒)",
    "経度(度)",
    "経度(分)",
    "経度(秒)",
  ].map(col);
  const [nameCol, riverCol, dateCol, codCol] = [
    "地点名",
    "調査河川名称",
    "採水日",
    "中央値",
  ].map(col);
  let n = 0;
  for (const r of rows) {
    const cod = Number(r[codCol]);
    const lat = dms(r[lat1], r[lat2], r[lat3]);
    const lon = dms(r[lon1], r[lon2], r[lon3]);
    // 列名の行・空の行・値のない地点と、日本の範囲の外（座標の書き間違い）は除く
    if (!r[codCol] || !Number.isFinite(cod) || !r[dateCol]) continue;
    if (!(lon > 122 && lon < 154 && lat > 20 && lat < 46)) continue;
    const name = r[nameCol]?.trim() ?? "";
    const key = `${name},${lon.toFixed(3)},${lat.toFixed(3)}`;
    if (placed.has(key)) continue;
    placed.add(key);
    // 調査票の川の名前は「十勝川水系札内川」のように書かれることがあるので、水系の後ろだけにする
    const written = r[riverCol]?.trim().replace(/^.*水系/, "") || null;
    const row: MizumapRow = [
      Math.round(lon * 1e5) / 1e5,
      Math.round(lat * 1e5) / 1e5,
      cod,
      name,
      day(r[dateCol]),
      riverNameAt(lon, lat, RIVER_NEAR_M) ?? written,
    ];
    const { m1 } = meshOf(lon, lat);
    byM1.set(m1, [...(byM1.get(m1) ?? []), row]);
    points++;
    n++;
  }
  console.log(`${year}年 ${n} 地点（新しい年と重なる地点は除く）`);
}

const version = new Date().toISOString().slice(0, 10).replaceAll("-", "");
mkdirSync(out, { recursive: true });
for (const d of readdirSync(out))
  if (/^\d{8}$/.test(d) && d !== version)
    rmSync(join(out, d), { recursive: true });
const dir = join(out, version);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

let bytes = 0;
const meshes = [...byM1.keys()].sort((a, b) => a - b);
for (const m1 of meshes) {
  const json = JSON.stringify(byM1.get(m1));
  bytes += json.length;
  writeFileSync(join(dir, `${m1}.json`), json);
}
writeFileSync(join(dir, "index.json"), JSON.stringify({ meshes }));
writeFileSync(join(out, "latest.json"), JSON.stringify({ version }));
writeFileSync(
  join(out, "README.txt"),
  `このフォルダのデータは、流域探索マップ（地図アプリ）で、市民による川の水質調べの結果を出すためのものです。

出典: 「身近な水環境の全国一斉調査」全国公開データ（全国水環境マップ実行委員会 作成） ${SITE}
  市民団体や学校などが毎年6月の同じ日に、パックテストで川などの COD（水中の有機物の量の目安）を測った結果です。
加工内容: ${MIZUMAP_YEARS.join("・")}年の調査地点のうち COD の値（3回測った中央値）と位置があるものを選び、1次メッシュ（約80km四方）ごとに分けました。
  同じ地点（地点名と約100m の位置が同じもの）は、新しい年の結果だけを残しています。日本の範囲の外にある座標は除いています。
  位置は調査票の緯度・経度（度・分・秒）を度に直したものです。
  そばの川の名前は、同じフォルダ階層の河川データ（public/rivers/、OpenStreetMap © OpenStreetMap contributors、ODbL 1.0）の河川線のうち、
  調査地点にいちばん近いもの（${RIVER_NEAR_M}m 以内）の名前です。なければ調査票に書かれた川の名前（「〜水系」の後ろ）です。

形式（latest.json が指す版のフォルダ）:
  index.json = { meshes: [ファイルがある1次メッシュ番号, ...] }
  1次メッシュ番号.json = [[経度, 緯度, COD mg/L, 地点名, 調査日（YYYY-MM-DD）, そばの川の名前（分からなければ null）], ...]
`,
);
console.log(
  `${meshes.length} files, ${points} 地点, ${(bytes / 1024).toFixed(0)} KB → ${dir}`,
);
