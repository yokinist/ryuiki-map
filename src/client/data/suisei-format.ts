// 川の生きもの調べ（全国水生生物調査）の表（public/suisei/）の形式。scripts/build-suisei.ts と画面の両方が使う
// （node から直接読むので、拡張子なしの import は置かない）

/** 表に入れる調査の年度。地点は参加者が毎年選び直すので、1年度だけだと少ない。同じ地点は新しい年度だけ残す */
export const SUISEI_YEARS = [2023, 2024, 2025] as const;

/**
 * 調査地点1つ: [経度, 緯度, 水質階級（1〜4。1 がきれい）, 地点名, 調査日（YYYY-MM-DD）,
 * そばを流れる川の名前（分からなければ null）]
 */
export type SuiseiRow = [
  lon: number,
  lat: number,
  grade: number,
  name: string,
  date: string,
  river: string | null,
];
