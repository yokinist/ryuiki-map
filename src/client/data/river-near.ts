// 地点にいちばん近い河川線の名前。scripts/build-water.ts が、水質の測定点がどの川にあるかを調べるのに使う
// （node から直接読むので、拡張子なしの import は置かない）
import type { RiverLine } from "./river-format.ts";

/**
 * 地点 (lon, lat) からいちばん近い河川線の名前。maxM 以内に線がなければ null。
 * 線分（頂点と頂点の間）までの距離で測る。経度は緯度で縮むので、地点の緯度で m に直す
 */
export function nearestRiverName(
  lines: RiverLine[],
  lon: number,
  lat: number,
  maxM: number,
): string | null {
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110_574;
  let best: string | null = null;
  let bestD = maxM * maxM;
  for (const { name, pts } of lines) {
    for (let i = 0; i + 3 < pts.length; i += 2) {
      // 地点を原点にした線分 (ax, ay)-(bx, by) までの距離の2乗
      const ax = (pts[i] - lon) * kx;
      const ay = (pts[i + 1] - lat) * ky;
      const bx = (pts[i + 2] - lon) * kx;
      const by = (pts[i + 3] - lat) * ky;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2
        ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2))
        : 0;
      const d = (ax + t * dx) ** 2 + (ay + t * dy) ** 2;
      if (d <= bestD) {
        bestD = d;
        best = name;
      }
    }
  }
  return best;
}

/**
 * 公共用水域の水域名（「利根川上流（３）」「多摩川（三沢川）」など）から、測った川の名前を取り出す。
 * 河川線から名前を引けない測定点（細い川が河川データにない）の代わりに使う。川の名前にならなければ null
 */
export function riverOfWaterArea(water: string): string | null {
  // 括弧の中が川の名前なら、本流の水域に含めた支流を測っている（「河川」は名前ではない）
  const inner = water.match(/（([^（）]+川)）/)?.[1];
  if (inner && inner !== "河川") return inner;
  const name = water
    .replace(/（[^（）]*）/g, "")
    .replace(/水域$/, "")
    .replace(/(上|中|下|中・下|上・中)流$/, "");
  return name.endsWith("川") ? name : null;
}
