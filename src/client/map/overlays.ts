import type { FeatureCollection, Geometry } from "geojson";
import type {
  ExpressionSpecification,
  GeoJSONSource,
  ImageSource,
  Map as MlMap,
} from "maplibre-gl";
import { ATTRIBUTION } from "../config";
import type { LngLat } from "../geo";
import type { GridSpec } from "../terrain/grid";
import { reducedMotion } from "../ui/motion";
import { rgba, token, tokenMs } from "./theme";

/** グリッドを画像にして重ねるレイヤー（下から順） */
const IMAGE_LAYERS = ["basin", "dem-rivers"] as const;
const DATA_LAYERS = [
  "rivers",
  "hover",
  "upstream",
  "downstream",
  "confluences",
] as const;
type ImageLayer = (typeof IMAGE_LAYERS)[number];
type DataLayer = (typeof DATA_LAYERS)[number];

const EMPTY_FC: FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};
const WORLD: [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
] = [
  [-179, 85],
  [179, 85],
  [179, -85],
  [-179, -85],
];
let emptyImage = "";

/** 長い川だけ線を少し太くする（閾値を上げ、極端に太い本流が増えないようにする） */
const BIG_RIVER_KM = 120;

/** 重ね描き用のソースとレイヤーを追加する */
export function addOverlays(map: MlMap) {
  emptyImage = Object.assign(document.createElement("canvas"), {
    width: 1,
    height: 1,
  }).toDataURL();
  const water = token("--color-water");
  const waterStrong = token("--color-water-strong");
  const drop = "#e03131";
  const halo = token("--color-map-halo");
  const big: ExpressionSpecification = [">=", ["get", "km"], BIG_RIVER_KM];

  for (const id of IMAGE_LAYERS) {
    map.addSource(id, { type: "image", coordinates: WORLD, url: emptyImage });
    map.addLayer({
      id,
      type: "raster",
      source: id,
      paint: { "raster-fade-duration": 0 },
    });
  }
  for (const id of DATA_LAYERS)
    map.addSource(id, {
      type: "geojson",
      data: EMPTY_FC,
      ...(id === "rivers" ? { attribution: ATTRIBUTION.rivers } : {}),
      ...(id === "downstream" ? { lineMetrics: true } : {}), // line-gradient に必要
    });

  map.addLayer({
    id: "rivers",
    type: "line",
    source: "rivers",
    paint: {
      "line-color": water,
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        6,
        ["case", big, 0.65, 0.25],
        11,
        ["case", big, 1.4, 0.9],
        14,
        ["case", big, 2.2, 1.35],
      ],
      "line-opacity": ["case", big, 0.82, 0.38],
    },
  });
  map.addLayer({
    id: "hover",
    type: "line",
    source: "hover",
    paint: {
      "line-color": drop,
      "line-width": 2,
      "line-opacity": 0.5,
      "line-dasharray": [2, 1.5],
    },
  });
  // 雨粒の通り道。白いふちで地図から浮かせ、出発側を淡く・雨粒側を濃くして流れる向きを示す
  const round = { "line-cap": "round", "line-join": "round" } as const;
  // 水源からクリック地点までの、さかのぼった道のり。雨の通り道（雨粒の色）と見分けられるよう川の濃い色で
  map.addLayer({
    id: "upstream-casing",
    type: "line",
    source: "upstream",
    paint: { "line-color": halo, "line-width": 7, "line-opacity": 0.92 },
    layout: round,
  });
  map.addLayer({
    id: "upstream",
    type: "line",
    source: "upstream",
    paint: { "line-color": waterStrong, "line-width": 3.5 },
    layout: round,
  });
  map.addLayer({
    id: "downstream-casing",
    type: "line",
    source: "downstream",
    paint: { "line-color": halo, "line-width": 8, "line-opacity": 0.92 },
    layout: round,
  });
  map.addLayer({
    id: "downstream",
    type: "line",
    source: "downstream",
    paint: {
      "line-width": 4,
      "line-gradient": [
        "interpolate",
        ["linear"],
        ["line-progress"],
        0,
        rgba("--color-drop", 0.28),
        0.55,
        rgba("--color-drop", 0.78),
        1,
        drop,
      ],
    },
    layout: round,
  });
  map.addLayer({
    id: "rivers-label",
    type: "symbol",
    source: "rivers",
    minzoom: 10,
    layout: {
      "symbol-placement": "line",
      "text-field": ["get", "name"],
      "text-font": ["Open Sans Semibold"],
      "text-size": ["case", big, 12, 11],
    },
    paint: {
      "text-color": waterStrong,
      "text-halo-color": halo,
      "text-halo-width": 1.5,
    },
  });
  // 合流点・支流の合流・ダムを種類ごとに見分けられるようにする。
  // 支流は本筋ほど目立たせない輪、ダムは小さく濃い色。雨の通り道・水の来た道のどちらでも同じ印を使う
  const kind: ExpressionSpecification = ["get", "kind"];
  const isBranch: ExpressionSpecification = ["==", kind, "branch"];
  map.addLayer({
    id: "confluences",
    type: "circle",
    source: "confluences",
    paint: {
      "circle-radius": ["match", kind, "dam", 5, "branch", 4.5, 6],
      "circle-color": [
        "match",
        kind,
        "dam",
        waterStrong,
        "branch",
        halo,
        water,
      ],
      "circle-stroke-color": ["case", isBranch, water, halo],
      "circle-stroke-width": ["case", isBranch, 2, 2.5],
    },
  });
  map.addLayer({
    id: "confluences-label",
    type: "symbol",
    source: "confluences",
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Open Sans Semibold"],
      "text-size": ["case", isBranch, 12, 13],
      // 引いた地図では名前どうしが重なるので、入りきらない名前は隠す（印は残し、寄れば出る）。
      // 置けるなら右・左・上・下の順に試し、重なったら合流点・支流・ダムの順で優先する
      "text-variable-anchor": ["left", "right", "top", "bottom"],
      "text-radial-offset": 0.9,
      "symbol-sort-key": ["match", kind, "dam", 2, "branch", 1, 0],
    },
    paint: {
      "text-color": waterStrong,
      "text-halo-color": halo,
      "text-halo-width": 2,
    },
  });
}

/** 地図に重ねる画像と、その四隅の経緯度 */
export interface Overlay {
  url: string;
  coordinates: [LngLat, LngLat, LngLat, LngLat];
}
/** 画像にするグリッド上の範囲 [x0, y0, x1, y1)（ピクセル） */
export type Rect = [x0: number, y0: number, x1: number, y1: number];

const current = new Map<ImageLayer, string>(); // 表示中の Blob URL（差し替え時に解放する）

/** 画像を重ねる。overlay を省くと消す。fade なら透明から浮かび上がらせる */
export function setImage(
  map: MlMap,
  id: ImageLayer,
  overlay?: Overlay,
  opts: { fade?: boolean } = {},
) {
  const prev = current.get(id);
  if (prev) URL.revokeObjectURL(prev);
  if (overlay) current.set(id, overlay.url);
  else current.delete(id);
  if (opts.fade) {
    // いったん瞬時に透明にしてから、トランジション付きで不透明に戻す
    map.setPaintProperty(id, "raster-opacity-transition", { duration: 0 });
    map.setPaintProperty(id, "raster-opacity", 0);
  }
  map
    .getSource<ImageSource>(id)
    ?.updateImage(overlay ?? { url: emptyImage, coordinates: WORLD });
  if (opts.fade)
    requestAnimationFrame(() => {
      map.setPaintProperty(id, "raster-opacity-transition", {
        duration: reducedMotion() ? 0 : tokenMs("--duration-slow"),
      });
      map.setPaintProperty(id, "raster-opacity", 1);
    });
}

export function setData(
  map: MlMap,
  id: DataLayer,
  data: FeatureCollection | Geometry = EMPTY_FC,
) {
  map.getSource<GeoJSONSource>(id)?.setData(data);
}

/**
 * セルごとの色（Uint32 ABGR、0 は透明）から画像を作る。rect を渡すとその範囲だけ切り出す。
 * base64 の data URL ではなく Blob URL にする（大きな画像で数百ms かかる変換を省く）
 */
export async function paint(
  g: GridSpec,
  color: (c: number) => number,
  rect: Rect = [0, 0, g.W, g.H],
): Promise<Overlay> {
  const [x0, y0, x1, y1] = rect;
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const cv = new OffscreenCanvas(w, h);
  const ctx = cv.getContext("2d");
  if (!ctx) throw new Error("OffscreenCanvas 2d context is unavailable");
  const img = ctx.createImageData(w, h);
  const px = new Uint32Array(img.data.buffer);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      px[(y - y0) * w + (x - x0)] = color(y * g.W + x);
  ctx.putImageData(img, 0, 0);
  const url = URL.createObjectURL(
    await cv.convertToBlob({ type: "image/png" }),
  );
  return {
    url,
    coordinates: [g.at(x0, y0), g.at(x1, y0), g.at(x1, y1), g.at(x0, y1)],
  };
}

/** マスクが 1 のセルを囲む範囲（margin ピクセル広げる）。なければ null */
export function maskRect(
  g: GridSpec,
  mask: Uint8Array,
  margin = 1,
): Rect | null {
  let x0 = g.W;
  let y0 = g.H;
  let x1 = -1;
  let y1 = -1;
  for (let c = 0; c < mask.length; c++) {
    if (!mask[c]) continue;
    const x = c % g.W;
    const y = (c / g.W) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  return [
    Math.max(0, x0 - margin),
    Math.max(0, y0 - margin),
    Math.min(g.W, x1 + 1 + margin),
    Math.min(g.H, y1 + 1 + margin),
  ];
}
