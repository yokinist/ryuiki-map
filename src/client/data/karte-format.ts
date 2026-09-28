// 流域サマリ（コード・ファイル・配信パスでは karte と呼ぶ）のデータ形式と、地域メッシュ（JIS X 0410）の計算。scripts/build-karte.ts と画面の両方が使う
//
// ライセンスの違うデータを混ぜないよう、置き場を分ける。どちらも1次メッシュ（約80km四方）ごとに1ファイル
// - public/karte/<版>/meshes/<1次メッシュ>.json: 1kmメッシュごとの人口（国勢調査）と土地の使われ方（ESA WorldCover）
// - public/karte/<版>/dams/<1次メッシュ>.json: ダム・堰（OpenStreetMap、ODbL）

/** 人口を持つ国勢調査の年 */
export const CENSUS_YEARS = [2010, 2015, 2020] as const;

/** 土地の使われ方の分類。WorldCover の11分類をこの6つにまとめる */
export const LAND = [
  "森林",
  "農地",
  "市街地",
  "草地・低木",
  "水面・湿地",
  "その他",
] as const;
export type Land = (typeof LAND)[number];

/** WorldCover の分類コード → LAND の添字 */
export function landIndex(code: number): number {
  switch (code) {
    case 10: // Tree cover
    case 95: // Mangroves
      return 0;
    case 40: // Cropland
      return 1;
    case 50: // Built-up
      return 2;
    case 20: // Shrubland
    case 30: // Grassland
    case 100: // Moss and lichen
      return 3;
    case 80: // Permanent water bodies
    case 90: // Herbaceous wetland
      return 4;
    default: // 60 Bare / sparse vegetation, 70 Snow and ice
      return 5;
  }
}

/**
 * 1kmメッシュ1つ分: [1次メッシュ内の番号, 人口2010, 人口2015, 人口2020, ...LAND ごとの面積の割合（%）]。
 * 人口が秘匿（*）や未調査なら 0
 */
export type MeshRow = number[];
export const ROW = { sub: 0, pop: 1, land: 1 + CENSUS_YEARS.length } as const;

/** ダム・堰1つ分: [経度, 緯度, 0=ダム 1=堰, 名前（なければ空）] */
export type DamRow = [lon: number, lat: number, kind: 0 | 1, name: string];

/** public/karte/<版>/index.json: ファイルがある1次メッシュの一覧 */
export interface KarteIndex {
  meshes: number[];
  dams: number[];
}

/** 経度・緯度が入る 1次メッシュ番号（4桁）と、その中の3次メッシュの番号（4桁: 2次の縦横・3次の縦横） */
export function meshOf(lon: number, lat: number): { m1: number; sub: number } {
  const y = lat * 1.5;
  const x = lon - 100;
  const p = Math.floor(y);
  const u = Math.floor(x);
  const y2 = (y - p) * 8;
  const x2 = (x - u) * 8;
  const q = Math.floor(y2);
  const v = Math.floor(x2);
  const r = Math.floor((y2 - q) * 10);
  const w = Math.floor((x2 - v) * 10);
  return { m1: p * 100 + u, sub: q * 1000 + v * 100 + r * 10 + w };
}

/** 1次メッシュの範囲 [西, 南, 東, 北] */
export function mesh1Bounds(m1: number): [number, number, number, number] {
  const p = Math.floor(m1 / 100);
  const u = m1 % 100;
  return [100 + u, p / 1.5, 101 + u, (p + 1) / 1.5];
}

/** 3次メッシュ（30秒 × 45秒）の面積 km²。緯度で東西の幅が変わる */
export const mesh3Km2 = (lat: number) =>
  (110.57 / 120) * ((111.32 / 80) * Math.cos((lat * Math.PI) / 180));
