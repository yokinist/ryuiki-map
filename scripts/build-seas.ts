// 河口がどの海かを判定するための海域データを作る。
// 出典: Flanders Marine Institute (2018). IHO Sea Areas, version 3（Marine Regions、CC BY 4.0）
//   https://www.marineregions.org/ https://doi.org/10.14284/323
//
//   pnpm build:seas     日本周辺の海域を取得し、切り抜き・間引いて public/seas.json に書き出す（1回きりでよい）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { SeaFeature } from "../src/client/data/seas.ts";

type Position = [number, number];
type Ring = Position[];

const root = join(import.meta.dirname, "..");
const cacheFile = join(root, ".cache", "iho.json");
const out = join(root, "public", "seas.json");
/** 日本の河口が入りうる範囲 [西, 南, 東, 北] */
const JAPAN: [number, number, number, number] = [122, 20, 154, 46];
/** 間引きの許容誤差（度）。約1km */
const SIMPLIFY_DEG = 0.01;

// IHO の海域名 → 表示名。関東以西の太平洋側は IHO ではフィリピン海だが、一般には太平洋と呼ぶ
const NAMES: Record<string, string> = {
  "Japan Sea": "日本海",
  "Seto Naikai or Inland Sea": "瀬戸内海",
  "Eastern China Sea": "東シナ海",
  "Philippine Sea": "太平洋",
  "North Pacific Ocean": "太平洋",
  "Sea of Okhotsk": "オホーツク海",
};

async function download() {
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, "utf8"));
  const url = `https://geo.vliz.be/geoserver/MarineRegions/wfs?service=WFS&version=1.0.0&request=GetFeature&typeName=MarineRegions:iho&outputFormat=application/json&bbox=${JAPAN.join(",")}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "ryuiki-map/0.1 (personal non-commercial map)",
    },
  });
  if (!res.ok) throw new Error(`marineregions: ${res.status}`);
  const text = await res.text();
  mkdirSync(join(root, ".cache"), { recursive: true });
  writeFileSync(cacheFile, text);
  return JSON.parse(text);
}

/** Sutherland–Hodgman で矩形に切り抜く */
function clip(ring: Ring, [w, s, e, n]: typeof JAPAN): Ring {
  const edges: [
    (p: Position) => boolean,
    (a: Position, b: Position) => Position,
  ][] = [
    [
      (p) => p[0] >= w,
      (a, b) => [w, a[1] + ((b[1] - a[1]) * (w - a[0])) / (b[0] - a[0])],
    ],
    [
      (p) => p[0] <= e,
      (a, b) => [e, a[1] + ((b[1] - a[1]) * (e - a[0])) / (b[0] - a[0])],
    ],
    [
      (p) => p[1] >= s,
      (a, b) => [a[0] + ((b[0] - a[0]) * (s - a[1])) / (b[1] - a[1]), s],
    ],
    [
      (p) => p[1] <= n,
      (a, b) => [a[0] + ((b[0] - a[0]) * (n - a[1])) / (b[1] - a[1]), n],
    ],
  ];
  let pts = ring;
  for (const [inside, cross] of edges) {
    const next: Ring = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      if (inside(b)) {
        if (!inside(a)) next.push(cross(a, b));
        next.push(b);
      } else if (inside(a)) next.push(cross(a, b));
    }
    pts = next;
    if (!pts.length) break;
  }
  return pts;
}

/** Douglas–Peucker（閉じたリングは始点=終点のまま） */
function simplify(pts: Ring, tol: number): Ring {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1e-12;
    let far = -1;
    let farD = tol;
    for (let i = a + 1; i < b; i++) {
      const d =
        len > 1e-9
          ? Math.abs(
              (by - ay) * (pts[i][0] - ax) - (bx - ax) * (pts[i][1] - ay),
            ) / len
          : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
      if (d > farD) {
        far = i;
        farD = d;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const round = ([x, y]: Position): Position => [+x.toFixed(3), +y.toFixed(3)];

const src: { features: Feature<Polygon | MultiPolygon, { name: string }>[] } =
  await download();
const features: SeaFeature[] = [];
for (const f of src.features) {
  const name = NAMES[f.properties.name];
  if (!name) continue;
  const polygons =
    f.geometry.type === "Polygon"
      ? [f.geometry.coordinates]
      : f.geometry.coordinates;
  const kept: Position[][][] = [];
  for (const rings of polygons) {
    const out = rings
      .map((r) => clip(r as Ring, JAPAN))
      .filter((r) => r.length >= 3)
      .map((r) => simplify([...r, r[0]], SIMPLIFY_DEG).map(round))
      .filter((r) => r.length >= 4);
    if (out.length) kept.push(out);
  }
  if (kept.length)
    features.push({
      type: "Feature",
      properties: { name },
      geometry: { type: "MultiPolygon", coordinates: kept },
    });
}
writeFileSync(out, JSON.stringify({ type: "FeatureCollection", features }));
const points = features.reduce(
  (n, f) => n + JSON.stringify(f.geometry).length,
  0,
);
console.log(
  `${features.length} seas (${features.map((f) => f.properties.name).join("・")}), ${(points / 1024).toFixed(0)} KB → ${out}`,
);
