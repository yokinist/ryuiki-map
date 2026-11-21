// 市民の水質調べ（身近な水環境の全国一斉調査）の表（public/mizumap/）の形式。scripts/build-mizumap.ts と画面の両方が使う
// （node から直接読むので、拡張子なしの import は置かない）

/** 表に入れる調査の年。地点は参加者が毎年選び直すので、水生生物調査（suisei-format.ts）と同じく3年分。同じ地点は新しい年だけ残す */
export const MIZUMAP_YEARS = [2023, 2024, 2025] as const;

/**
 * 調査地点1つ: [経度, 緯度, COD mg/L（3回測った中央値）, 地点名, 調査日（YYYY-MM-DD）,
 * そばを流れる川の名前（分からなければ null）]
 */
export type MizumapRow = [
  lon: number,
  lat: number,
  cod: number,
  name: string,
  date: string,
  river: string | null,
];
