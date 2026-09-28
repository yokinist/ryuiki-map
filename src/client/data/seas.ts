import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import { SOURCES } from "../config";
import type { LngLat } from "../geo";

/** scripts/build-seas.ts が書き出す海域 */
export type SeaFeature = Feature<Polygon | MultiPolygon, { name: string }>;

let seas: Promise<SeaFeature[]> | null = null;

/** 河口の地点がどの海か。海域データがなければ null */
export async function seaAt(p: LngLat): Promise<string | null> {
  seas ??= fetch(SOURCES.seas)
    .then((r) => (r.ok ? r.json() : { features: [] }))
    .then((j) => j.features as SeaFeature[])
    .catch(() => []);
  return findSea(await seas, p);
}

/**
 * p を含む海域の名前。海域の境界は海岸線を粗く引いてあるので、河口のすぐ沖が陸側に外れることがある。
 * そのときは maxKm 以内で一番近い海域を返す
 */
export function findSea(
  features: SeaFeature[],
  p: LngLat,
  maxKm = 20,
): string | null {
  let best: string | null = null;
  let bestKm = maxKm;
  for (const f of features) {
    const polygons =
      f.geometry.type === "Polygon"
        ? [f.geometry.coordinates]
        : f.geometry.coordinates;
    for (const rings of polygons) {
      if (inPolygon(rings, p)) return f.properties.name;
      for (const ring of rings) {
        const d = distanceKm(ring, p);
        if (d < bestKm) {
          bestKm = d;
          best = f.properties.name;
        }
      }
    }
  }
  return best;
}

/** 外周に入っていて、穴（2つ目以降のリング）に入っていない */
function inPolygon(rings: Position[][], p: LngLat) {
  return (
    rings.length > 0 &&
    inRing(rings[0], p) &&
    !rings.slice(1).some((hole) => inRing(hole, p))
  );
}

function inRing(ring: Position[], [x, y]: LngLat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/** リングの辺までの最短距離 km（緯度に応じて経度方向を縮める近似） */
function distanceKm(ring: Position[], [x, y]: LngLat) {
  const kx = 111.32 * Math.cos((y * Math.PI) / 180);
  const ky = 110.57;
  let min = Number.POSITIVE_INFINITY;
  for (let i = 1; i < ring.length; i++) {
    const ax = (ring[i - 1][0] - x) * kx;
    const ay = (ring[i - 1][1] - y) * ky;
    const bx = (ring[i][0] - x) * kx;
    const by = (ring[i][1] - y) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(
      0,
      Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)),
    );
    min = Math.min(min, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return min;
}
