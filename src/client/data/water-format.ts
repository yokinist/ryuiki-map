// 水のきれいさの表（public/water/）の形式。scripts/build-water.ts と画面の両方が使う
// （node から直接読むので、拡張子なしの import は置かない）

/** 推移を見る過去の年度（10年おき）。最新の年度（WaterRow の year）と並べて、昔と今を比べる */
export const WATER_PAST_YEARS = [1994, 2004, 2014] as const;

/**
 * 測定点1つ: [経度, 緯度, BOD 年平均 mg/L（定量下限未満は下限値）, 地点名, 年度,
 * そばを流れる川の名前（分からなければ null）, WATER_PAST_YEARS の各年度の BOD（その年度に測っていなければ null）]
 */
export type WaterRow = [
  lon: number,
  lat: number,
  bod: number,
  name: string,
  year: number,
  river: string | null,
  past: (number | null)[],
];

/** public/water/<版>/index.json */
export interface WaterIndex {
  meshes: number[];
}
