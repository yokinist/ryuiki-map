import { MAX_TILES } from "../config";
import { type BBox, type LngLat, latToY, lonToX, xToLon, yToLat } from "../geo";

/** 標高タイル（Web メルカトル）の並びに合わせた計算グリッド。1セル = タイルの1ピクセル */
export interface GridSpec {
  Z: number;
  tx0: number;
  tx1: number;
  ty0: number;
  ty1: number;
  W: number;
  H: number;
  /** セル1辺の長さ m */
  cellM: number;
  cellKm2: number;
  /** グリッド左上から (x, y) ピクセルの位置（セルの角）の経緯度 */
  at: (x: number, y: number) => LngLat;
  bbox: BBox;
  /** 範囲外は -1 */
  toCell: (lon: number, lat: number) => number;
  toPixel: (lon: number, lat: number) => [number, number];
  lngLat: (c: number) => LngLat;
}

/**
 * p を中心に、ズーム z の標高タイルちょうど縦横 tiles 枚を覆う bbox。
 * タイル境界に揃える（中心がタイルの境目からずれると1列余分に読むので）
 */
export function bboxAround([lon, lat]: LngLat, z: number, tiles: number): BBox {
  const n = 2 ** z;
  const tx = Math.floor(lonToX(lon) * n) - Math.floor(tiles / 2);
  const ty = Math.floor(latToY(lat) * n) - Math.floor(tiles / 2);
  const e = 1e-9; // 隣のタイルにはみ出さないよう、ほんの少し内側
  return [
    xToLon(tx / n) + e,
    yToLat((ty + tiles) / n) + e,
    xToLon((tx + tiles) / n) - e,
    yToLat(ty / n) - e,
  ];
}

/** bbox を覆うグリッド。z を省くとタイル数が MAX_TILES に収まる一番細かいズームを選ぶ */
export function gridSpec(bbox: BBox, z?: number): GridSpec {
  for (let Z = z ?? 13; ; Z--) {
    const N2 = 256 * 2 ** Z;
    const lon2x = (lon: number) => lonToX(lon) * N2;
    const lat2y = (lat: number) => latToY(lat) * N2;
    const tx0 = Math.floor(lon2x(bbox[0]) / 256);
    const tx1 = Math.floor(lon2x(bbox[2]) / 256);
    const ty0 = Math.floor(lat2y(bbox[3]) / 256);
    const ty1 = Math.floor(lat2y(bbox[1]) / 256);
    if (
      z === undefined &&
      (tx1 - tx0 + 1) * (ty1 - ty0 + 1) > MAX_TILES &&
      Z > 7
    )
      continue;
    const x2lon = (x: number) => xToLon(x / N2);
    const y2lat = (y: number) => yToLat(y / N2);
    const X0 = tx0 * 256;
    const Y0 = ty0 * 256;
    const W = (tx1 - tx0 + 1) * 256;
    const H = (ty1 - ty0 + 1) * 256;
    // ponytail: セル寸法は範囲中央の緯度で固定。広域では南北で数%ずれる
    const cellM =
      (40075016.686 * Math.cos((((bbox[1] + bbox[3]) / 2) * Math.PI) / 180)) /
      N2;
    const ll = (x: number, y: number): LngLat => [x2lon(x), y2lat(y)];
    return {
      Z,
      tx0,
      tx1,
      ty0,
      ty1,
      W,
      H,
      cellM,
      cellKm2: (cellM * cellM) / 1e6,
      at: (x, y) => ll(X0 + x, Y0 + y),
      bbox: [x2lon(X0), y2lat(Y0 + H), x2lon(X0 + W), y2lat(Y0)],
      toCell: (lon, lat) => {
        const x = Math.floor(lon2x(lon) - X0);
        const y = Math.floor(lat2y(lat) - Y0);
        return x < 0 || y < 0 || x >= W || y >= H ? -1 : y * W + x;
      },
      toPixel: (lon, lat) => [lon2x(lon) - X0, lat2y(lat) - Y0],
      lngLat: (c) => ll(X0 + (c % W) + 0.5, Y0 + ((c / W) | 0) + 0.5),
    };
  }
}
