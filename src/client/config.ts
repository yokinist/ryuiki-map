import type { BBox, Bounds } from "./geo";

/** 起動時の表示範囲（日本全体） */
export const START_BOUNDS: Bounds = [
  [128.5, 30.5],
  [146, 45.6],
];

/** 雨をたどれる範囲（標高・河川データの対象）。START_BOUNDS と同じ */
export const JAPAN_BBOX: BBox = [
  START_BOUNDS[0][0],
  START_BOUNDS[0][1],
  START_BOUNDS[1][0],
  START_BOUNDS[1][1],
];

/** この縮尺より拡大して地図を止めたら、表示範囲を自動で計算する（マウス位置からの流れの先読み用） */
export const AUTO_COMPUTE_ZOOM = 10;

/** この縮尺以上で、表示範囲の河川データを読み込んで線と名前を描く（広域では読み込むタイルが多すぎるので描かない） */
export const SHOW_RIVERS_ZOOM = 9;

/** まだ計算していない場所をクリックしたときに読み込む範囲。クリック地点を中心に、標高タイル z13 で縦横6枚（約25km四方） */
export const CLICK_GRID = { z: 13, tiles: 6 };

/** 広域の表示でクリックしたとき、この縮尺まで寄せる（いきなり寄りすぎないよう控えめに。その後は雨粒を追いながら引いていく） */
export const CLICK_ZOOM = 10;

/** 表示範囲の自動計算に使う標高タイル数の上限。超えるときは解像度を下げる（先読み用なのでメモリを食いすぎないように） */
export const MAX_TILES = 64;

/** 詳細範囲の外に出た雨は、その地点を中心にした広域グリッド（約120mメッシュ・約190km四方）をその場で読み込んで追う */
export const WIDE = { z: 10, tiles: 6, keep: 4 }; // keep: クリック地点のグリッドもここに入る

/**
 * 集水域が広域グリッドにも収まらない大きな川（北上川・石狩川・信濃川など）を水源までさかのぼるための、さらに粗い範囲
 * （約240mメッシュ・約360km四方）。「上流へさかのぼる」か流域サマリを開いたときだけ読む。下りの乗り換えには使わない（線が粗くなる）
 */
export const WIDEST = { z: 9, tiles: 6 };

/** 標高から推定した川として薄く描く集水面積のしきい値 km² */
export const DEM_RIVER_KM2 = 0.1;

/**
 * 河川線上のセルを流向計算でどれだけ低く扱うか m。
 * 平野では標高差がほぼなく流れが別の川へ逃げるので、実際の河川線に沿って下げる。
 * 長い川ほど深くして、本流が支流・派川に負けないようにする（利根川 322km → 約50m、小貝川 112km → 約39m、沢 → 10m）
 */
export const burnDepth = (km = 0) =>
  Math.round(Math.min(60, 10 + 8 * Math.log2(1 + km / 10)));

// ponytail: 流下時間の目安は一律 1m/s。実際は勾配・水量で大きく変わる
// 変えるときは index.html と site.files.ts（/llms.txt） の「利用上の注意」の記述も合わせる
export const FLOW_MPS = 1;

/** 東京ドームの建築面積 km² */
export const DOME_KM2 = 0.0467;

/** 東京ドームの容積 m³ */
export const DOME_M3 = 1_240_000;

export const SOURCES = {
  dem: (z: number, x: number, y: number) =>
    `https://cyberjapandata.gsi.go.jp/xyz/dem_png/${z}/${x}/${y}.png`,
  /** 道路・市町村界の色付き線がない白地図（川・海岸など最小限） */
  blank: "https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png",
  /** 淡色地図。白地図の上に薄く重ね、土地の色味だけ足す（道路の黄・緑は彩度を落として弱める） */
  pale: "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",
  hillshade:
    "https://cyberjapandata.gsi.go.jp/xyz/hillshademap/{z}/{x}/{y}.png",
  reverseGeocoder: (lon: number, lat: number) =>
    `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lon}`,
  muni: "https://maps.gsi.go.jp/js/muni.js",
  rivers: "/rivers",
  karte: "/karte",
  // 1991〜2020年（気候の平年値と同じ30年）の日降水量
  climate: (lon: number, lat: number) =>
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&start_date=1991-01-01&end_date=2020-12-31&daily=precipitation_sum&timezone=Asia%2FTokyo`,
  seas: "/seas.json",
  // 日本語はブラウザのフォントで描かれる（MapLibre の localIdeographFontFamily）。ここは欧文・数字用。
  // MapLibre のデモ用サーバーは混むと 429 を返して読めなくなるので、同じファイルを public/fonts/ に置いて自前で配る
  glyphs: "/fonts/{fontstack}/{range}.pbf",
};

/**
 * 地理院の逆ジオコーダへの配慮: 同時接続数。問い合わせるのは川の区間ごとに最大3地点（data/places.ts）。
 * 混んでいると1件10秒以上かかることがあるので、timeoutMs で打ち切る
 */
export const GEOCODER = { concurrency: 4, timeoutMs: 20_000 };

const LINKS = {
  osmCopyright: "https://www.openstreetmap.org/copyright",
  gsiTiles: "https://maps.gsi.go.jp/development/ichiran.html",
};

// 河川線は OpenStreetMap（ODbL）。地図に出典を表示し、著作権ページへリンクする
export const ATTRIBUTION = {
  gsi: `<a href="${LINKS.gsiTiles}" target="_blank" rel="noopener">地理院タイル</a>（白地図・淡色地図・陰影起伏図・標高タイル）・地理院 逆ジオコーダ`,
  rivers: `河川: <a href="${LINKS.osmCopyright}" target="_blank" rel="noopener">© OpenStreetMap contributors</a>`,
};
