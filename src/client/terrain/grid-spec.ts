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
  /** セル1辺の長さ m（範囲の中央の緯度での値。目安や閾値に使う） */
  cellM: number;
  cellKm2: number;
  /** 行 y のセル1辺の長さ m。Web メルカトルのセルは緯度 φ で赤道の cos φ 倍になるので、距離や面積はこちらで測る */
  rowM: (y: number) => number;
  /** グリッド左上から (x, y) ピクセルの位置（セルの角）の経緯度 */
  at: (x: number, y: number) => LngLat;
  bbox: BBox;
  /** 範囲外は -1 */
  toCell: (lon: number, lat: number) => number;
  toPixel: (lon: number, lat: number) => [number, number];
  lngLat: (c: number) => LngLat;
}

/** 標高タイルの範囲（タイル番号、両端を含む） */
export interface TileRange {
  tx0: number;
  tx1: number;
  ty0: number;
  ty1: number;
}

/** タイルの範囲を覆う bbox（隣のタイルにはみ出さないよう、ほんの少し内側） */
export function tilesBBox(z: number, t: TileRange): BBox {
  const n = 2 ** z;
  const e = 1e-9;
  return [
    xToLon(t.tx0 / n) + e,
    yToLat((t.ty1 + 1) / n) + e,
    xToLon((t.tx1 + 1) / n) - e,
    yToLat(t.ty0 / n) - e,
  ];
}

/**
 * p を中心に、ズーム z の標高タイルちょうど縦横 tiles 枚を覆う bbox。
 * タイル境界に揃える（中心がタイルの境目からずれると1列余分に読むので）
 */
export function bboxAround([lon, lat]: LngLat, z: number, tiles: number): BBox {
  const n = 2 ** z;
  const tx0 = Math.floor(lonToX(lon) * n) - Math.floor(tiles / 2);
  const ty0 = Math.floor(latToY(lat) * n) - Math.floor(tiles / 2);
  return tilesBBox(z, {
    tx0,
    tx1: tx0 + tiles - 1,
    ty0,
    ty1: ty0 + tiles - 1,
  });
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
    const atLat = (lat: number) =>
      (40075016.686 * Math.cos((lat * Math.PI) / 180)) / N2;
    const cellM = atLat((bbox[1] + bbox[3]) / 2);
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
      rowM: (y) => atLat(y2lat(Y0 + y + 0.5)),
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
