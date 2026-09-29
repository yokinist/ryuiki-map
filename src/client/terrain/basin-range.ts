import { type BBox, latToY, lonToX, xToLon, yToLat } from "../geo";

/** 集水域が範囲のどの辺に届いているか（北 = y の小さい側） */
export interface Touched {
  n: boolean;
  s: boolean;
  e: boolean;
  w: boolean;
}

/** 集水域（up の 0/1 マスク）の外接矩形（経緯度）と、届いている辺。端のセルは出口なので、1つ内側に届いたら届いた扱い */
export function basinExtent(
  g: { W: number; H: number; at: (x: number, y: number) => [number, number] },
  up: Uint8Array,
): { bbox: BBox; touched: Touched } {
  let x0 = g.W;
  let y0 = g.H;
  let x1 = -1;
  let y1 = -1;
  for (let c = 0; c < up.length; c++) {
    if (!up[c]) continue;
    const x = c % g.W;
    const y = (c / g.W) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const [w, n] = g.at(x0, y0);
  const [e, s] = g.at(x1 + 1, y1 + 1);
  return {
    bbox: [w, s, e, n],
    touched: { n: y0 <= 1, s: y1 >= g.H - 2, w: x0 <= 1, e: x1 >= g.W - 2 },
  };
}

/** 一度に読むタイルの上限（6×6 と同じ）と、1つの軸の上限（南北に長い集水域でも縦長で読めるように） */
const WIDEST_MAX_TILES = 36;
const MAX_PER_AXIS = 8;

export interface TileRange {
  tx0: number;
  tx1: number;
  ty0: number;
  ty1: number;
}

/**
 * はみ出した集水域を読み直すタイルの範囲（ズーム z）。集水域の外接矩形を覆うタイルから、切れている辺の方向へだけ広げる。
 * 広げる幅は、その軸が MAX_PER_AXIS 枚（両方の軸で切れていれば6枚）か、全体が WIDEST_MAX_TILES 枚に収まるまで。
 * 集水域の外接矩形そのものは削らない（読み直す前のグリッドが36枚以下なので、ふつうは収まる）
 */
export function widestTiles(
  z: number,
  bbox: BBox,
  touched: Touched,
): TileRange {
  const n = 2 ** z;
  let tx0 = Math.floor(lonToX(bbox[0]) * n);
  // 東端・南端はセルの右下の角なので、ちょうどタイルの境目にあるときは隣のタイルを数えない
  let tx1 = Math.ceil(lonToX(bbox[2]) * n) - 1;
  let ty0 = Math.floor(latToY(bbox[3]) * n);
  let ty1 = Math.ceil(latToY(bbox[1]) * n) - 1;
  const w = () => tx1 - tx0 + 1;
  const h = () => ty1 - ty0 + 1;
  // 片方の軸だけ切れていれば、その軸を最大 MAX_PER_AXIS 枚まで長く取れる。両方なら正方形（6×6）を目安にする。
  // どちらの場合も、もう一方の軸の長さで割って、全体が WIDEST_MAX_TILES 枚を超えないようにする
  const bothAxes = (touched.n || touched.s) && (touched.e || touched.w);
  const axisMax = bothAxes
    ? Math.floor(Math.sqrt(WIDEST_MAX_TILES))
    : MAX_PER_AXIS;
  const limit = (other: number) =>
    Math.min(axisMax, Math.floor(WIDEST_MAX_TILES / other));
  if (touched.e || touched.w) {
    const grow = Math.max(0, limit(h()) - w());
    const west =
      touched.w && touched.e ? Math.floor(grow / 2) : touched.w ? grow : 0;
    tx0 -= west;
    tx1 += grow - west;
  }
  if (touched.n || touched.s) {
    const grow = Math.max(0, limit(w()) - h());
    const north =
      touched.n && touched.s ? Math.ceil(grow / 2) : touched.n ? grow : 0;
    ty0 -= north;
    ty1 += grow - north;
  }
  return { tx0, tx1, ty0, ty1 };
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
