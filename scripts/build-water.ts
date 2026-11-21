// 水のきれいさ（BOD の年平均）を引く表を作る。河川の測定点を、1次メッシュ単位のファイルにする
//
//   pnpm build:water          未取得の都道府県を取得し、配信用ファイルを作り直す
//   pnpm build:water --pack   取得はせず、取得済みのデータから配信用ファイルだけ作り直す
//
// 1. 環境省「水環境総合情報サイト」の公共用水域水質測定結果（年間値・生活環境項目、河川、都道府県ごと）
//    最新の年度 → .cache/water/<県>.csv、推移を見る過去の年度（WATER_PAST_YEARS）→ .cache/water/<年度>/<県>.csv
//    サイトの「ダウンロード」画面と同じく、ZIP を作らせてでき上がるのを待ってから受け取る
// 2. public/water/<版>/ に書き出す（形式は src/client/data/water-format.ts）。public/water/latest.json が今の版を指す
import { execFileSync } from "node:child_process";
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
import { riverOfWaterArea } from "../src/client/data/river-near.ts";
import {
  WATER_PAST_YEARS,
  type WaterIndex,
  type WaterRow,
} from "../src/client/data/water-format.ts";
import { sleep } from "./overpass.ts";
import { riverNameAt } from "./river-names.ts";

const SITE = "https://water-pub.env.go.jp/water-pub/mizu-site/";
const ZIP = `${SITE}zip_create`;
// 新しい年度から順に試し、その県で最初に見つかった年度を使う（県によって公表が遅れる）
const YEARS = [2024, 2023];

const root = join(import.meta.dirname, "..");
const cache = join(root, ".cache", "water");
const out = join(root, "public", "water");
const pref = (i: number) => String(i + 1).padStart(2, "0");
const csvFile = (i: number) => join(cache, `${pref(i)}.csv`);
const pastFile = (year: number, i: number) =>
  join(cache, String(year), `${pref(i)}.csv`);

async function call(method: string, body: object): Promise<string> {
  const res = await fetch(`${ZIP}/WebService.asmx/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method}: ${res.status}`);
  return (await res.json()).d;
}

/** 1県・1年度の年間値（生活環境項目、河川）の CSV。その年度がなければ null */
async function download(i: number, year: number): Promise<Buffer | null> {
  const id = await call("StartCreation", {
    featureClassName: "p_kosui_y02",
    // 水域コード 500 未満が河川（湖沼は 500〜、海域は 600〜。湖沼の水質は BOD ではなく COD で評価するので含めない）
    whereClause: `nendo=${year} and suiikicode < '500' and prefcode='${pref(i)}'`,
    extension: "csv",
  });
  if (id === "RecordNotFound") return null;
  if (id === "BadRequest") throw new Error("BadRequest");
  for (;;) {
    await sleep(2000);
    const status = await call("GetThreadStatus", { resultFileName: id });
    if (status === "Stopped") break;
    if (status !== "Running") throw new Error(status);
  }
  const res = await fetch(`${ZIP}/download.aspx?id=${id}`);
  if (!res.ok) throw new Error(`download: ${res.status}`);
  const zip = join(cache, "tmp.zip");
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  return execFileSync("unzip", ["-p", zip], { maxBuffer: 64 * 1024 * 1024 });
}

// ---- 1. 取得 ----
mkdirSync(cache, { recursive: true });
if (process.argv[2] !== "--pack")
  for (let i = 0; i < 47; i++) {
    if (existsSync(csvFile(i))) continue;
    let csv: Buffer | null = null;
    for (const year of YEARS) {
      csv = await download(i, year);
      if (csv) break;
      await sleep();
    }
    // どの年度もない県は空のファイルにして、次に走らせたとき取り直さない
    writeFileSync(csvFile(i), csv ?? "");
    console.log(`[${i + 1}/47] ${pref(i)} ${csv ? csv.length : "なし"}`);
    await sleep();
  }
if (process.argv[2] !== "--pack")
  for (const year of WATER_PAST_YEARS) {
    mkdirSync(join(cache, String(year)), { recursive: true });
    for (let i = 0; i < 47; i++) {
      if (existsSync(pastFile(year, i))) continue;
      const csv = await download(i, year);
      writeFileSync(pastFile(year, i), csv ?? "");
      console.log(
        `[${year}年度 ${i + 1}/47] ${pref(i)} ${csv ? csv.length : "なし"}`,
      );
      await sleep();
    }
  }

// ---- 2. まとめる ----
/** 川のそばとみなす距離 m。測定点の座標は秒単位（約30m）で、河川線も数十m ずれるので、少し広くとる */
const RIVER_NEAR_M = 150;

/** CSV の河川の測定点（同じ地点の重なりは除く）。値は get(列名) で取る */
function* readStations(file: string) {
  // Shift_JIS。1行目が列名。文字列の列は "" で囲まれ、中に , は入らない
  const [head, ...lines] = new TextDecoder("shift_jis")
    .decode(readFileSync(file))
    .split(/\r?\n/)
    .filter(Boolean);
  if (!head) return;
  const col = Object.fromEntries(head.split(",").map((c, j) => [c, j]));
  const seen = new Set<string>();
  for (const line of lines) {
    const v = line.split(",").map((s) => s.replace(/^"|"$/g, ""));
    const get = (name: string) => v[col[name]];
    // 湖沼・海域は除く（取得済みのキャッシュに湖沼が入っていても、ここで落とす）。同じ地点が重ねて入っていることもある
    if (get("rlscode") !== "1" || seen.has(get("zettaicode"))) continue;
    seen.add(get("zettaicode"));
    // bod3 は表に出す形の文字列。定量下限未満は「<0.5」（数値の bod は 0 になる）なので、下限値で代用する
    const bod = Number(get("bod3")?.replace("<", "") || Number.NaN);
    if (Number.isFinite(bod)) yield { get, bod };
  }
}

const byM1 = new Map<number, WaterRow[]>();
let stations = 0;
let withPast = 0;
// 県境の川は両方の県が同じ測定点を報告していることがある（筑後川・利根川など）。座標と名前が同じなら1つにする
const placed = new Set<string>();
for (let i = 0; i < 47; i++) {
  // 過去の年度の BOD を、測定点の通し番号（zettaicode）でつなぐ。
  // 区分の番号（水域・地点コード）は年度で振り直されることがあるが、通し番号は30年たっても同じだった（神奈川で確認）
  // ponytail: 通し番号が変わった測定点は、過去の値がつながらない（null になる）。座標でつなぐなら測定点の移設に気をつける
  const past = WATER_PAST_YEARS.map((year) => {
    const byId = new Map<string, number>();
    if (existsSync(pastFile(year, i)))
      for (const { get, bod } of readStations(pastFile(year, i)))
        byId.set(get("zettaicode"), bod);
    return byId;
  });
  for (const { get, bod } of readStations(csvFile(i))) {
    const lon = Number(get("longitude"));
    const lat = Number(get("latitude"));
    if (!lon || !lat) continue;
    const key = `${lon},${lat},${get("locationname")}`;
    if (placed.has(key)) continue;
    placed.add(key);
    const pastBod = past.map((byId) => byId.get(get("zettaicode")) ?? null);
    const row: WaterRow = [
      Math.round(lon * 1e5) / 1e5,
      Math.round(lat * 1e5) / 1e5,
      bod,
      get("locationname"),
      Number(get("nendo")),
      // 細い川は河川線がないことがあるので、そのときは水域名（「後沢川」など）から取る。
      // 名前が分からないままだと、本流のそばにある支流の測定点（「利根川合流前」など）を本流のものとして拾ってしまう
      riverNameAt(lon, lat, RIVER_NEAR_M) ?? riverOfWaterArea(get("water")),
      pastBod,
    ];
    const { m1 } = meshOf(lon, lat);
    byM1.set(m1, [...(byM1.get(m1) ?? []), row]);
    stations++;
    if (pastBod.some((b) => b !== null)) withPast++;
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
const index: WaterIndex = { meshes };
writeFileSync(join(dir, "index.json"), JSON.stringify(index));
writeFileSync(join(out, "latest.json"), JSON.stringify({ version }));
writeFileSync(
  join(out, "README.txt"),
  `このフォルダのデータは、流域探索マップ（地図アプリ）で川の水のきれいさを出すためのものです。

出典: 「公共用水域水質測定結果」（環境省 水環境総合情報サイト） ${SITE} を加工して作成
  公共データ利用規約（第1.0版） https://www.env.go.jp/mail.html に基づき利用しています。
加工内容: 河川の測定点のうち BOD（生物化学的酸素要求量）の年平均値があるものを選び、
  都道府県ごとに公表されている最新の年度（${YEARS.join("・")}年度のうち新しいもの）の値を、1次メッシュ（約80km四方）ごとに分けました。
  推移を見るため、同じ測定点の ${WATER_PAST_YEARS.join("・")} 年度の値も添えています（測定点の通し番号でつなぎ、その年度に測っていなければ null）。
  定量下限未満（「<0.5」など）は下限値に置き換えています。
  そばの川の名前は、同じフォルダ階層の河川データ（public/rivers/、OpenStreetMap © OpenStreetMap contributors、ODbL 1.0）の河川線のうち、測定点にいちばん近いものの名前です。

形式（latest.json が指す版のフォルダ）:
  index.json = { meshes: [ファイルがある1次メッシュ番号, ...] }
  1次メッシュ番号.json = [[経度, 緯度, BOD 年平均 mg/L, 地点名, 年度, そばの川の名前（150m 以内の河川線の名前。なければ水域名から取り、それでも分からなければ null）, [${WATER_PAST_YEARS.join("・")}年度の BOD]], ...]
`,
);
console.log(
  `${meshes.length} files, ${stations} 地点（過去の値あり ${withPast}）, ${(bytes / 1024).toFixed(0)} KB → ${dir}`,
);
