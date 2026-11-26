// 配信しているデータの目録（/data.json と /data/ のもと）。出典の文は各フォルダの README.txt と揃える

/** 版（日付のフォルダ名）を持つフォルダ。public/<フォルダ>/latest.json が今の版を指す */
export type DataFolder =
  | "rivers"
  | "karte"
  | "places"
  | "water"
  | "suisei"
  | "mizumap";

interface DatasetSpec {
  id: string;
  name: string;
  description: string;
  period: string;
  folder: DataFolder;
  /** 版のフォルダの中の置き場とファイル名の決め方 */
  path: string;
  /** 1ファイルの大きさの目安（いちばん大きいもの） */
  maxSize: string;
  attribution: string;
  license: string;
  commercial: string;
}

const MESH = "<1次メッシュ番号>.json";
const NOTE_MESH =
  "1次メッシュ番号は「緯度×1.5 の整数」と「経度−100 の整数」を並べた4桁（例: 経度139.3・緯度35.5 → 5339）";
const OSM = "© OpenStreetMap contributors（ODbL 1.0）";
const ODBL = "ODbL 1.0（加工したデータそのものを配るときは同じ ODbL で配る）";
const PDL = "公共データ利用規約（第1.0版）";
const GOV = "政府標準利用規約（第2.0版）";

const SPECS: DatasetSpec[] = [
  {
    id: "rivers",
    name: "川の線と名前",
    description: "名前のある川・小川の線と、川の総延長（km）",
    period: "OpenStreetMap から2026年取得",
    folder: "rivers",
    path: "<経度×2 の整数>_<緯度×2 の整数>.json",
    maxSize: "約210KB",
    attribution: OSM,
    license: ODBL,
    commercial:
      "要確認（日本の河川線の多くは、非商用の国土数値情報（河川データ）を取り込んだもの）",
  },
  {
    id: "water",
    name: "水のきれいさ",
    description:
      "国の水質測定点の BOD 年平均と、同じ地点の1994・2004・2014年度の値",
    period: "2023・2024年度",
    folder: "water",
    path: MESH,
    maxSize: "約20KB",
    attribution:
      "「公共用水域水質測定結果」（環境省 水環境総合情報サイト）を加工して作成",
    license: PDL,
    commercial: "可",
  },
  {
    id: "suisei",
    name: "川の生きもの調べ",
    description:
      "全国水生生物調査で、学校や市民団体が生きもので判定した水質（4段階）",
    period: "2023〜2025年度",
    folder: "suisei",
    path: MESH,
    maxSize: "約14KB",
    attribution:
      "「全国水生生物調査結果」（環境省 水環境総合情報サイト）を加工して作成",
    license: PDL,
    commercial: "可",
  },
  {
    id: "mizumap",
    name: "市民の水質調べ",
    description: "身近な水環境の全国一斉調査で、パックテストで測った COD",
    period: "2023〜2025年の6月",
    folder: "mizumap",
    path: MESH,
    maxSize: "約130KB",
    attribution:
      "「身近な水環境の全国一斉調査」全国公開データ（全国水環境マップ実行委員会 作成）を加工して作成",
    license: "明記なし（使うときは「全国水環境マップ実行委員会 作成」と書く）",
    commercial: "要確認（書かれていない）",
  },
  {
    id: "karte-meshes",
    name: "人口と土地の使われ方",
    description:
      "1kmメッシュごとの人口（2010・2015・2020年）と、森林・農地・市街地などの割合",
    period: "人口 2010・2015・2020年、土地 2021年",
    folder: "karte",
    path: `meshes/${MESH}`,
    maxSize: "約210KB",
    attribution:
      "人口：政府統計の総合窓口(e-Stat)、「国勢調査」1kmメッシュ（総務省統計局）を加工して作成。土地の使われ方：© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium",
    license: `人口は${GOV}、土地の使われ方は CC BY 4.0`,
    commercial: "可",
  },
  {
    id: "karte-dams",
    name: "ダム・堰",
    description: "ダム・堰の位置、ダムか堰か、名前",
    period: "OpenStreetMap から2026年取得",
    folder: "karte",
    path: `dams/${MESH}`,
    maxSize: "約85KB",
    attribution: OSM,
    license: ODBL,
    commercial: "可",
  },
  {
    id: "places",
    name: "地名",
    description:
      "市区町村・町丁・字の範囲（約56m×46m のマス）と、地名から位置を引く表 search.json（約9MB、地名から位置を引くときだけ取る）",
    period: "2020年10月1日現在",
    folder: "places",
    path: MESH,
    maxSize: "約2.4MB",
    attribution:
      "政府統計の総合窓口(e-Stat)、「令和2年国勢調査 町丁・字等別境界データ」（総務省統計局）を加工して作成",
    license: GOV,
    commercial: "可",
  },
];

export interface Dataset extends Omit<DatasetSpec, "path"> {
  version: string;
  latest: string;
  readme: string;
  files: string;
  /** 出典に添える入手元の文（決まりではない）。版が入るので、同じ時点のデータをたどれる */
  source: string;
}

export interface DataCatalog {
  site: string;
  howTo: string[];
  datasets: Dataset[];
}

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * 目録を人が読むページ（/data/）にする。出典の行のリンク先になるので、データだけで完結させる。
 * 地図アプリとは別のページなので独自の色は持たず、ブラウザの標準の色（ライト・ダーク両対応）だけを使う
 */
export function dataPageHtml(catalog: DataCatalog, siteName: string): string {
  const url = esc(catalog.site);
  const rows = catalog.datasets
    .map(
      (d) => `<section>
<h3>${esc(d.name)}</h3>
<p>${esc(d.description)}</p>
<dl>
<dt>時点</dt><dd>${esc(d.period)}（今の版 ${esc(d.version)}）</dd>
<dt>ファイル</dt><dd><code>${esc(d.files)}</code>（1ファイル最大${esc(d.maxSize)}）</dd>
<dt>説明</dt><dd><a href="${esc(d.readme)}">README.txt</a> ・ 今の版を指す <a href="${esc(d.latest)}">latest.json</a></dd>
<dt>出典</dt><dd>${esc(d.attribution)}</dd>
<dt>入手元</dt><dd>${esc(d.source)}（決まりではないが、添えると同じ時点のデータをたどれる）</dd>
<dt>ライセンス</dt><dd>${esc(d.license)}</dd>
<dt>商用</dt><dd>${esc(d.commercial)}</dd>
</dl>
</section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="ja">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>データの一覧 | ${esc(siteName)}</title>
<style>
:root { color-scheme: light dark; }
body { font-family: system-ui, sans-serif; line-height: 1.7; max-width: 52rem; margin: 0 auto; padding: 1rem; }
section { border-top: 1px solid GrayText; padding-block: .5rem; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: .2rem 1rem; margin: 0; }
dt { font-weight: bold; }
dd { margin: 0; min-width: 0; }
code { overflow-wrap: anywhere; }
</style>
<h1>${esc(siteName)}のデータ</h1>
<p><a href="${url}">${esc(siteName)}</a>のために集めて整えた、全国の流域のデータです。自分の流域の分析や可視化に使えます。機械向けの一覧は <a href="${url}data.json">data.json</a>、AI 向けの説明は <a href="${url}llms.txt">llms.txt</a> にあります。</p>
<h2>取り方</h2>
<ul>
${catalog.howTo.map((s) => `<li>${esc(s)}</li>`).join("\n")}
</ul>
<h2>データ</h2>
${rows}
</html>
`;
}

/** 今の版（フォルダ → 日付）から、目録を組み立てる。版が分からないフォルダがあれば止める */
export function dataCatalog(
  siteUrl: string,
  versions: Partial<Record<DataFolder, string>>,
): DataCatalog {
  const datasets = SPECS.map(({ path, ...spec }) => {
    const version = versions[spec.folder];
    if (!version)
      throw new Error(`${spec.folder} の版（latest.json）が分からない`);
    return {
      ...spec,
      version,
      latest: `${siteUrl}${spec.folder}/latest.json`,
      readme: `${siteUrl}${spec.folder}/README.txt`,
      files: `${siteUrl}${spec.folder}/${version}/${path}`,
      source: `流域探索マップの配信データ（${spec.name} ${version} 版）${siteUrl}data/`,
    };
  });
  return {
    site: siteUrl,
    howTo: [
      "範囲（経度・緯度の四隅）から、要る1次メッシュとタイルを先に決め、ファイルを1つずつ取る。全国分を丸ごと取らない",
      NOTE_MESH,
      "ほかのサイトのページからブラウザで直接は読めない（CORS を許していない）。取ったファイルを自分のプロジェクトに置いて使う",
      "出典は、使ったデータの「出典」（attribution）の文を1行ずつ書く。非商用なら、出典を書けば自由に使える",
      "決まりではないが、「データの入手元：」に続けて「入手元」（source）の文を添えると、版（日付）まで分かり、同じ時点のデータをたどれる",
    ],
    datasets,
  };
}
