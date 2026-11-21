// 川の生きもの調べ（全国水生生物調査）の表を作る。調査地点を、1次メッシュ単位のファイルにする
//
//   pnpm build:suisei          未取得の年度を取得し、配信用ファイルを作り直す
//   pnpm build:suisei --pack   取得はせず、取得済みのデータから配信用ファイルだけ作り直す
//
// 1. 環境省「水環境総合情報サイト」の全国水生生物調査結果。閲覧ページの地図が読む ArcGIS の地図サーバーに、
//    年度ごとに1回問い合わせる（SUISEI_YEARS の数だけ）→ .cache/suisei/<年度>.json
// 2. public/suisei/<版>/ に書き出す（形式は src/client/data/suisei-format.ts）。public/suisei/latest.json が今の版を指す
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { meshOf } from "../src/client/data/karte-format.ts";
import {
  SUISEI_YEARS,
  type SuiseiRow,
} from "../src/client/data/suisei-format.ts";
import { sleep } from "./overpass.ts";
import { riverNameAt } from "./river-names.ts";

const PAGE =
  "https://water-pub.env.go.jp/water-pub/mizu-site/suisei/pub/eturan/select.html";
// レイヤー 0 は「調査地点名（過去）」。終わった年度の調査地点が全部入っている
const LAYER =
  "https://water-pub.env.go.jp/gis/rest/services/RESULT/MapServer/0/query";

const root = join(import.meta.dirname, "..");
const cache = join(root, ".cache", "suisei");
const out = join(root, "public", "suisei");
const yearFile = (year: number) => join(cache, `${year}.json`);

interface Attrs {
  longitude: number;
  latitude: number;
  locationname: string;
  rivername: string | null;
  surveydate: number | null;
  quality: number;
}

async function download(year: number): Promise<Attrs[]> {
  const q = new URLSearchParams({
    // 閲覧ページの地図と同じ条件（公開済み・削除されていない・水質階級の判定があるもの）
    where: `nendo = ${year} AND quality > 0 AND deletionflag = 0 AND openflag = 1`,
    outFields: "longitude,latitude,locationname,rivername,surveydate,quality",
    returnGeometry: "false",
    f: "json",
  });
  const res = await fetch(`${LAYER}?${q}`);
  if (!res.ok) throw new Error(`${year}: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`${year}: ${JSON.stringify(json.error)}`);
  // 1回に返るのは2,000件まで。近年は1年度1,000件ほど
  if (json.exceededTransferLimit) throw new Error(`${year}: 2,000件を超えた`);
  return json.features.map((f: { attributes: Attrs }) => f.attributes);
}

// ---- 1. 取得 ----
mkdirSync(cache, { recursive: true });
if (process.argv[2] !== "--pack")
  for (const year of SUISEI_YEARS) {
    if (existsSync(yearFile(year))) continue;
    const rows = await download(year);
    writeFileSync(yearFile(year), JSON.stringify(rows));
    console.log(`${year}年度 ${rows.length} 地点`);
    await sleep();
  }

// ---- 2. まとめる ----
/** 川のそばとみなす距離 m。参加者が地図で置いた位置なので、水質の測定点（150m）よりずれやすいとみて広めにとる */
const RIVER_NEAR_M = 200;

/** 調査日。地図サーバーは日本時間の0時を UTC の時刻で返す */
const day = (ms: number) =>
  new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);

const byM1 = new Map<number, SuiseiRow[]>();
// 同じ地点を毎年調べている団体も多い。地点名と約100m の位置が同じなら、新しい年度だけ残す
const placed = new Set<string>();
let points = 0;
for (const year of [...SUISEI_YEARS].reverse()) {
  if (!existsSync(yearFile(year))) continue;
  const rows: Attrs[] = JSON.parse(readFileSync(yearFile(year), "utf8"));
  for (const a of rows) {
    const lon = a.longitude;
    const lat = a.latitude;
    // 日本の範囲の外（座標の書き間違い）は除く
    if (!(lon > 122 && lon < 154 && lat > 20 && lat < 46)) continue;
    if (!(a.quality >= 1 && a.quality <= 4) || !a.surveydate) continue;
    const key = `${a.locationname},${lon.toFixed(3)},${lat.toFixed(3)}`;
    if (placed.has(key)) continue;
    placed.add(key);
    const row: SuiseiRow = [
      Math.round(lon * 1e5) / 1e5,
      Math.round(lat * 1e5) / 1e5,
      a.quality,
      a.locationname,
      day(a.surveydate),
      // 雨の通り道の川と名前を揃えるため、河川線の名前を先に使い、なければ参加者が書いた川の名前
      riverNameAt(lon, lat, RIVER_NEAR_M) ?? (a.rivername?.trim() || null),
    ];
    const { m1 } = meshOf(lon, lat);
    byM1.set(m1, [...(byM1.get(m1) ?? []), row]);
    points++;
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
writeFileSync(join(dir, "index.json"), JSON.stringify({ meshes }));
writeFileSync(join(out, "latest.json"), JSON.stringify({ version }));
writeFileSync(
  join(out, "README.txt"),
  `このフォルダのデータは、流域探索マップ（地図アプリ）で、市民による川の生きもの調べの結果を出すためのものです。

出典: 「全国水生生物調査結果」（環境省 水環境総合情報サイト） ${PAGE} を加工して作成
  公共データ利用規約（第1.0版） https://www.env.go.jp/mail.html に基づき利用しています。
  全国水生生物調査は、環境省と国土交通省の呼びかけで、学校や市民団体などが川の指標生物を調べ、水質を4つの階級で判定するものです。
加工内容: ${SUISEI_YEARS.join("・")}年度の調査地点のうち水質階級の判定があるものを選び、1次メッシュ（約80km四方）ごとに分けました。
  同じ地点（地点名と約100m の位置が同じもの）は、新しい年度の結果だけを残しています。日本の範囲の外にある座標は除いています。
  そばの川の名前は、同じフォルダ階層の河川データ（public/rivers/、OpenStreetMap © OpenStreetMap contributors、ODbL 1.0）の河川線のうち、
  調査地点にいちばん近いもの（${RIVER_NEAR_M}m 以内）の名前です。なければ調査票に書かれた川の名前です。

形式（latest.json が指す版のフォルダ）:
  index.json = { meshes: [ファイルがある1次メッシュ番号, ...] }
  1次メッシュ番号.json = [[経度, 緯度, 水質階級（1 きれいな水・2 ややきれいな水・3 きたない水・4 とてもきたない水）, 地点名, 調査日（YYYY-MM-DD）, そばの川の名前（分からなければ null）], ...]
`,
);
console.log(
  `${meshes.length} files, ${points} 地点, ${(bytes / 1024).toFixed(0)} KB → ${dir}`,
);
