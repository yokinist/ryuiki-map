// 流域サマリ用のデータを作る。1kmメッシュごとの人口と土地の使われ方、ダム・堰の位置を1次メッシュ単位のファイルにする
//
//   pnpm build:karte          未取得の分を取得し、配信用ファイルを作り直す（途中から再開できる）
//   pnpm build:karte 5339 5439 指定した1次メッシュだけ取得する（試すとき用。まとめは取得済みの全メッシュで作る）
//   pnpm build:karte --pack   取得はせず、取得済みのデータから配信用ファイルだけ作り直す
//
// 1. 人口: e-Stat「地図で見る統計（統計GIS）」の国勢調査 1kmメッシュ（2010・2015・2020年）→ .cache/estat/
// 2. 土地の使われ方: ESA WorldCover 2021（10m）の縮小版（約70m）を読み、1kmメッシュごとに分類の割合を数える → .cache/worldcover/
// 3. ダム・堰: OpenStreetMap の waterway=dam / weir を Overpass API で取得 → .cache/dams/
// 4. まとめて public/karte/<版>/ に書き出す（形式は src/client/data/karte-format.ts）。public/karte/latest.json が今の版を指す。
//    ライセンスの違うデータを混ぜないよう、人口・土地は meshes/、OSM 由来のダム・堰は dams/ に分け、それぞれに README.txt を添える
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
import { fromUrl } from "geotiff";
import {
  CENSUS_YEARS,
  type DamRow,
  type KarteIndex,
  LAND,
  landIndex,
  type MeshRow,
  mesh1Bounds,
  meshOf,
} from "../src/client/data/karte-format.ts";
import { overpass, sleep } from "./overpass.ts";

const root = join(import.meta.dirname, "..");
const cache = join(root, ".cache");
const out = join(root, "public", "karte");
const JAPAN: string[] = JSON.parse(
  readFileSync(join(import.meta.dirname, "japan-tiles.json"), "utf8"),
);

/** 国勢調査の1kmメッシュ（統計GIS の統計表ID と、人口総数の列） */
const CENSUS = [
  { year: 2010, id: "T000608", col: 1 },
  { year: 2015, id: "T000846", col: 4 },
  { year: 2020, id: "T001140", col: 4 },
] as const;
const WORLDCOVER = (lon: number, lat: number) =>
  `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N${String(lat).padStart(2, "0")}E${String(lon).padStart(3, "0")}_Map.tif`;
/** WorldCover の縮小版の解像度（1度あたりの画素数）。元の10mから1/8の約70m。1kmメッシュあたり約230画素で数える */
const WC_PX = 1500;

// 日本の河川タイル（1°四方）と重なる1次メッシュ
const MESH1 = [
  ...new Set(
    JAPAN.flatMap((k) => {
      const [x, y] = k.split("_").map(Number);
      const list: number[] = [];
      for (let p = Math.floor(y * 1.5); p < (y + 1) * 1.5; p++)
        list.push(p * 100 + (x - 100));
      return list;
    }),
  ),
].sort((a, b) => a - b);

const args = process.argv.slice(2);
const packOnly = args[0] === "--pack";
/** 取得する1次メッシュ。引数で絞れる */
const FETCH = !packOnly && args.length ? args.map(Number) : MESH1;

// ---- 1. 人口 ----
const estatDir = join(cache, "estat");
mkdirSync(estatDir, { recursive: true });
const estatFile = (id: string, m1: number) => join(estatDir, `${id}_${m1}.csv`);

if (!packOnly) {
  const todo = CENSUS.flatMap((c) =>
    FETCH.filter((m1) => !existsSync(estatFile(c.id, m1))).map((m1) => ({
      ...c,
      m1,
    })),
  );
  for (const [i, { id, year, m1 }] of todo.entries()) {
    const res = await fetch(
      `https://www.e-stat.go.jp/gis/statmap-search/data?statsId=${id}&code=${m1}&downloadType=2`,
    );
    const buf = Buffer.from(await res.arrayBuffer());
    // データのないメッシュ（海だけ・無人島）は zip ではなくエラーページが返る。空ファイルにして取り直さない
    let csv = "";
    if (buf.subarray(0, 2).toString() === "PK") {
      const zip = join(estatDir, "tmp.zip");
      writeFileSync(zip, buf);
      csv = new TextDecoder("shift_jis").decode(
        execFileSync("unzip", ["-p", zip], { maxBuffer: 64 * 1024 * 1024 }),
      );
      rmSync(zip);
    }
    writeFileSync(estatFile(id, m1), csv);
    console.log(
      `[人口 ${i + 1}/${todo.length}] ${year} ${m1}: ${csv ? "ok" : "なし"}`,
    );
    await sleep(1000);
  }
}

/** 1次メッシュ内の番号 → [2010, 2015, 2020 の人口] */
function population(m1: number): Map<number, number[]> {
  const pop = new Map<number, number[]>();
  CENSUS.forEach(({ id, col }, yi) => {
    const f = estatFile(id, m1);
    if (!existsSync(f)) return;
    for (const line of readFileSync(f, "utf8").split(/\r?\n/).slice(2)) {
      const cells = line.split(",");
      const key = Number(cells[0]);
      const n = Number(cells[col]); // 秘匿（*）は NaN。近くのメッシュに合算されているので 0 として扱う
      if (!key) continue;
      const sub = key % 10000;
      const row = pop.get(sub) ?? CENSUS_YEARS.map(() => 0);
      row[yi] = Number.isFinite(n) ? n : 0;
      pop.set(sub, row);
    }
  });
  return pop;
}

/** 取得できなかった1次メッシュ（再実行で取り直す） */
const failed: number[] = [];
const failedDams: string[] = [];

// ---- 2. 土地の使われ方 ----
const wcDir = join(cache, "worldcover");
mkdirSync(wcDir, { recursive: true });
const wcFile = (m1: number) => join(wcDir, `${m1}.json`);

/** 1次メッシュ内の番号 → LAND ごとの画素数 */
async function countLand(m1: number): Promise<Record<number, number[]>> {
  const [w, s, e, n] = mesh1Bounds(m1);
  const counts: Record<number, number[]> = {};
  // 1次メッシュと重なる WorldCover のタイル（3°四方、南西の角の度で名前が付く）
  for (let tlat = Math.floor(s / 3) * 3; tlat < n; tlat += 3)
    for (let tlon = Math.floor(w / 3) * 3; tlon < e; tlon += 3) {
      const tiff = await fromUrl(WORLDCOVER(tlon, tlat)).catch(() => null);
      if (!tiff) continue; // 海だけのタイルはない
      const image = await tiff.getImage(3); // 4500 × 4500 画素（1/1500°）
      const x0 = Math.round((Math.max(w, tlon) - tlon) * WC_PX);
      const x1 = Math.round((Math.min(e, tlon + 3) - tlon) * WC_PX);
      const y0 = Math.round((tlat + 3 - Math.min(n, tlat + 3)) * WC_PX);
      const y1 = Math.round((tlat + 3 - Math.max(s, tlat)) * WC_PX);
      if (x1 <= x0 || y1 <= y0) continue;
      const [data] = (await image.readRasters({
        window: [x0, y0, x1, y1],
      })) as unknown as Uint8Array[];
      const width = x1 - x0;
      for (let y = y0; y < y1; y++) {
        const lat = tlat + 3 - (y + 0.5) / WC_PX;
        for (let x = x0; x < x1; x++) {
          const code = data[(y - y0) * width + (x - x0)];
          if (!code) continue; // 0 = データなし（海）
          const { sub } = meshOf(tlon + (x + 0.5) / WC_PX, lat);
          counts[sub] ??= LAND.map(() => 0);
          counts[sub][landIndex(code)]++;
        }
      }
    }
  return counts;
}

if (!packOnly) {
  const todo = FETCH.filter((m1) => !existsSync(wcFile(m1)));
  let done = 0;
  // S3 の静的ファイルなので、いくつか並べて読んでよい
  const worker = async () => {
    for (let m1 = todo.shift(); m1 !== undefined; m1 = todo.shift()) {
      // 通信が一時的に切れることがあるので、少し待って取り直す。それでもだめなら飛ばして最後に知らせる
      let counts: Record<number, number[]> | null = null;
      for (let i = 0; i < 3 && !counts; i++)
        counts = await countLand(m1).catch(async (e: Error) => {
          console.log(`  ${m1}: ${e.message}、取り直します`);
          await sleep(10_000);
          return null;
        });
      if (!counts) {
        failed.push(m1);
        continue;
      }
      writeFileSync(wcFile(m1), JSON.stringify(counts));
      console.log(
        `[土地 ${++done}/${FETCH.length}] ${m1}: ${Object.keys(counts).length} メッシュ`,
      );
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

// ---- 3. ダム・堰 ----
const damDir = join(cache, "dams");
mkdirSync(damDir, { recursive: true });
interface OsmDam {
  type: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}
// 日本を2°四方に分けて問い合わせる（広く問うと混雑時に時間切れになる）
const DAM_BOXES = [
  ...new Set(
    JAPAN.map((k) => {
      const [x, y] = k.split("_").map(Number);
      return `${Math.floor(x / 2) * 2}_${Math.floor(y / 2) * 2}`;
    }),
  ),
];
if (!packOnly) {
  const boxes =
    FETCH === MESH1
      ? DAM_BOXES
      : [
          ...new Set(
            FETCH.map((m1) => {
              const [w, s] = mesh1Bounds(m1);
              return `${Math.floor(w / 2) * 2}_${Math.floor(s / 2) * 2}`;
            }),
          ),
        ];
  const todo = boxes.filter((b) => !existsSync(join(damDir, `${b}.json`)));
  for (const [i, box] of todo.entries()) {
    const [x, y] = box.split("_").map(Number);
    const bbox = `${y},${x},${y + 2},${x + 2}`;
    const els = await overpass<OsmDam>(`
      [out:json][timeout:180];
      (nwr["waterway"="dam"](${bbox}); nwr["waterway"="weir"](${bbox}););
      out center tags;
    `).catch((e: Error) => {
      console.log(
        `[ダム・堰 ${i + 1}/${todo.length}] ${box}: failed (${e.message})`,
      );
      failedDams.push(box);
      return null;
    });
    if (!els) continue;
    const rows: DamRow[] = els.flatMap((el) => {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (lat === undefined || lon === undefined) return [];
      return [
        [
          +lon.toFixed(4),
          +lat.toFixed(4),
          el.tags?.waterway === "dam" ? 0 : 1,
          el.tags?.name ?? "",
        ],
      ];
    });
    writeFileSync(join(damDir, `${box}.json`), JSON.stringify(rows));
    console.log(`[ダム・堰 ${i + 1}/${todo.length}] ${box}: ${rows.length}`);
    await sleep();
  }
}

// ---- 4. まとめる ----
const damsBy = new Map<number, DamRow[]>();
for (const f of readdirSync(damDir).filter((f) => f.endsWith(".json")))
  for (const d of JSON.parse(
    readFileSync(join(damDir, f), "utf8"),
  ) as DamRow[]) {
    const { m1 } = meshOf(d[0], d[1]);
    // 範囲の境界上のものは両方に入るので、座標で重複を除く
    const list = damsBy.get(m1) ?? [];
    if (!list.some((x) => x[0] === d[0] && x[1] === d[1])) list.push(d);
    damsBy.set(m1, list);
  }

const version = new Date().toISOString().slice(0, 10).replaceAll("-", "");
mkdirSync(out, { recursive: true });
for (const d of readdirSync(out))
  if (/^\d{8}$/.test(d) && d !== version)
    rmSync(join(out, d), { recursive: true });
const dir = join(out, version);
rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, "meshes"), { recursive: true });
mkdirSync(join(dir, "dams"), { recursive: true });

let bytes = 0;
const index: KarteIndex = { meshes: [], dams: [] };
const write = (kind: keyof KarteIndex, m1: number, rows: unknown[]) => {
  const json = JSON.stringify(rows);
  bytes += json.length;
  writeFileSync(join(dir, kind, `${m1}.json`), json);
  index[kind].push(m1);
};
for (const m1 of MESH1) {
  const dams = damsBy.get(m1);
  if (dams?.length) write("dams", m1, dams);
  if (!existsSync(wcFile(m1))) continue; // まだ取得していない
  const pop = population(m1);
  const land: Record<number, number[]> = JSON.parse(
    readFileSync(wcFile(m1), "utf8"),
  );
  const subs = new Set([...pop.keys(), ...Object.keys(land).map(Number)]);
  const meshes: MeshRow[] = [];
  for (const sub of [...subs].sort((a, b) => a - b)) {
    const counts = land[sub] ?? LAND.map(() => 0);
    const total = counts.reduce((a, b) => a + b, 0);
    const people = pop.get(sub) ?? CENSUS_YEARS.map(() => 0);
    const water = total ? counts[4] / total : 1;
    if (water > 0.99 && !people.some(Boolean)) continue; // 海・湖だけのメッシュ
    meshes.push([
      sub,
      ...people,
      ...counts.map((c) => (total ? Math.round((c / total) * 100) : 0)),
    ]);
  }
  if (meshes.length) write("meshes", m1, meshes);
}
writeFileSync(join(dir, "index.json"), JSON.stringify(index));
writeFileSync(join(out, "latest.json"), JSON.stringify({ version }));
writeFileSync(
  join(out, "README.txt"),
  `このフォルダのデータは、流域探索マップ（地図アプリ）の「流域サマリ」のためのものです。
ライセンスの違うデータを混ぜないよう、版（latest.json が指すフォルダ）の中で置き場を分けています。

meshes/  人口と土地の使われ方（1kmメッシュ単位）。出典とライセンスは meshes/README.txt
dams/    ダム・堰の位置と名前（OpenStreetMap 由来、ODbL）。出典とライセンスは dams/README.txt
index.json  ファイルがある1次メッシュの一覧 { meshes: [...], dams: [...] }
`,
);
writeFileSync(
  join(dir, "meshes", "README.txt"),
  `流域探索マップの「流域サマリ」のために、次のデータを1kmメッシュ（JIS X 0410 3次メッシュ）単位に集計したものです。

人口: 出典：政府統計の総合窓口(e-Stat)（https://www.e-stat.go.jp/）
  「国勢調査」2010年・2015年・2020年 3次メッシュ（1kmメッシュ）人口総数（総務省統計局）を加工して作成。
  政府標準利用規約（第2.0版）に基づき利用しています。秘匿値は0としています。
土地の使われ方: © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium
  https://esa-worldcover.org/ 。CC BY 4.0（https://creativecommons.org/licenses/by/4.0/）。
  約70mに縮小した版から、分類を6つ（${LAND.join("・")}）にまとめ、メッシュごとの面積の割合（%）にしました。

形式: 1次メッシュ番号.json = [[1次メッシュ内の番号(4桁), 人口2010, 人口2015, 人口2020, ${LAND.map((l) => `${l}%`).join(", ")}], ...]
`,
);
writeFileSync(
  join(dir, "dams", "README.txt"),
  `流域探索マップの「流域サマリ」のために、OpenStreetMap から取り出したダム・堰のデータです。

出典: © OpenStreetMap contributors https://www.openstreetmap.org/copyright
ライセンス: Open Database License (ODbL) 1.0 https://opendatacommons.org/licenses/odbl/1-0/
  このデータ（OSM から作った派生データベース）も ODbL で提供します。再利用する場合は同じく ODbL に従ってください。
加工内容: waterway=dam / weir を Overpass API で取得し、位置（線・面は中心点）を1/10000度に丸め、名前とともに1次メッシュごとに分けました。

形式: 1次メッシュ番号.json = [[経度, 緯度, 0=ダム 1=堰, 名前（なければ空）], ...]
`,
);
if (failed.length)
  console.log(
    `取得できなかった1次メッシュ（再実行で取り直す）: ${failed.join(" ")}`,
  );
if (failedDams.length)
  console.log(
    `ダム・堰を取得できなかった範囲（再実行で取り直す）: ${failedDams.join(" ")}`,
  );
console.log(
  `meshes ${index.meshes.length}・dams ${index.dams.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB → ${dir}`,
);
