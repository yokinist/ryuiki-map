export type LngLat = [lon: number, lat: number];
/** [西, 南, 東, 北] */
export type BBox = [west: number, south: number, east: number, north: number];
/** [南西, 北東] */
export type Bounds = [sw: LngLat, ne: LngLat];

/** 点が bbox の中（境界を含む）か */
export const inBBox = ([lon, lat]: LngLat, [w, s, e, n]: BBox) =>
  lon >= w && lon <= e && lat >= s && lat <= n;

/** outer が inner をすっぽり覆っているか */
export const covers = (outer: BBox, inner: BBox) =>
  outer[0] <= inner[0] &&
  outer[1] <= inner[1] &&
  outer[2] >= inner[2] &&
  outer[3] >= inner[3];

// Web メルカトル。世界全体を 0〜1 とした座標（x は東へ、y は南へ増える）と経緯度を変換する
export const lonToX = (lon: number) => (lon + 180) / 360;
export const latToY = (lat: number) =>
  (1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2;
export const xToLon = (x: number) => x * 360 - 180;
export const yToLat = (y: number) =>
  (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
