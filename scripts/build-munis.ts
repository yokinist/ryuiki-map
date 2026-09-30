// 地名（市区町村）を引く表を作る。1kmメッシュごとの市区町村コードを、1次メッシュ単位のファイルにする
//
//   pnpm build:munis          未取得の都道府県を取得し、配信用ファイルを作り直す
//   pnpm build:munis --pack   取得はせず、取得済みのデータから配信用ファイルだけ作り直す
//
// 1. 統計局「市区町村別メッシュ・コード一覧」（令和2年10月1日現在の境界。都道府県ごとの CSV）→ .cache/munis/
// 2. public/munis/<版>/ に書き出す（形式は src/client/data/places.ts の MuniIndex）。public/munis/latest.json が今の版を指す
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { MuniIndex } from "../src/client/data/places.ts";
import { sleep } from "./overpass.ts";

const PAGE = "https://www.stat.go.jp/data/mesh/m_itiran.html";
const CSV = (pref: string) =>
  `https://www.stat.go.jp/data/mesh/csv/${pref}.csv`;
// 都道府県コード順
const PREFS =
  "北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県".split(
    " ",
  );

const root = join(import.meta.dirname, "..");
const cache = join(root, ".cache", "munis");
const out = join(root, "public", "munis");
const csvFile = (i: number) =>
  join(cache, `${String(i + 1).padStart(2, "0")}.csv`);

// ---- 1. 取得 ----
mkdirSync(cache, { recursive: true });
if (process.argv[2] !== "--pack")
  for (let i = 0; i < PREFS.length; i++) {
    if (existsSync(csvFile(i))) continue;
    const res = await fetch(CSV(String(i + 1).padStart(2, "0")));
    if (!res.ok) throw new Error(`${PREFS[i]}: ${res.status}`);
    writeFileSync(csvFile(i), Buffer.from(await res.arrayBuffer()));
    console.log(`[${i + 1}/${PREFS.length}] ${PREFS[i]}`);
    await sleep();
  }

// ---- 2. まとめる ----
const names: MuniIndex["names"] = {};
// 1次メッシュ → 市区町村コード → 1次メッシュ内の番号
const byM1 = new Map<number, Record<string, number[]>>();
for (let i = 0; i < PREFS.length; i++) {
  // Shift_JIS。北海道だけ4列目に備考（北方領土は「*」）がある
  const text = new TextDecoder("shift_jis").decode(readFileSync(csvFile(i)));
  for (const [, code, name, mesh] of text.matchAll(
    /^(\d{5}),([^,\r\n]+),(\d{8})/gm,
  )) {
    names[code] = [PREFS[i], name];
    // 3次メッシュ・コードの上4桁が1次メッシュ、下4桁が1次メッシュ内の番号（karte-format.ts の meshOf と同じ）
    const m1 = +mesh.slice(0, 4);
    const sub = +mesh.slice(4);
    const codes = byM1.get(m1) ?? {};
    codes[code] = [...(codes[code] ?? []), sub];
    byM1.set(m1, codes);
  }
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
const index: MuniIndex = { meshes, names };
writeFileSync(join(dir, "index.json"), JSON.stringify(index));
writeFileSync(join(out, "latest.json"), JSON.stringify({ version }));
writeFileSync(
  join(out, "README.txt"),
  `このフォルダのデータは、流域探索マップ（地図アプリ）で地名（市区町村）を出すためのものです。

出典: 「市区町村別メッシュ・コード一覧」（総務省統計局） ${PAGE} を加工して作成
  令和2年10月1日現在の市区町村の区域に基づきます（一覧の作成に用いた境界は、国土交通省「国土数値情報（行政区域）」に基づくとされています）。
  公共データ利用規約（第1.0版）に基づき利用しています。
加工内容: 都道府県名を添え、1次メッシュ（約80km四方）ごとに分けました。

形式（latest.json が指す版のフォルダ）:
  index.json = { meshes: [ファイルがある1次メッシュ番号, ...], names: { 市区町村コード: [都道府県名, 市区町村名] } }
  1次メッシュ番号.json = { 市区町村コード: [1次メッシュ内の番号(4桁), ...] }
  境界をまたぐ1kmメッシュは、またがる市区町村すべてに入っています。
`,
);
console.log(
  `${meshes.length} files, ${Object.keys(names).length} 市区町村, ${(bytes / 1024 / 1024).toFixed(1)} MB → ${dir}`,
);
