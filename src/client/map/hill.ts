import maplibregl from "maplibre-gl";
import { SOURCES } from "../config";
import missing from "./hill-missing.json";
import { isMissingTile } from "./sea-tiles";

/** 陰影起伏図のタイル URL。hill://{z}/{x}/{y} を下の addHillProtocol が地理院のタイルに振り替える */
export const HILL_TILES = "hill://{z}/{x}/{y}";

const MISSING = new Set(missing);
// 1×1 の透明 PNG。海だけのタイルの代わりに返す
const EMPTY = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
).buffer;

/**
 * 地理院の陰影起伏図は海だけのタイルが 404 になり、ブラウザのコンソールにエラーが並ぶ。
 * 無いと分かっているタイルは問い合わせず、透明な画像で埋める
 */
export function addHillProtocol() {
  maplibregl.addProtocol("hill", async ({ url }, abort) => {
    const [z, x, y] = url.slice("hill://".length).split("/").map(Number);
    if (isMissingTile(MISSING, z, x, y)) return { data: EMPTY.slice(0) };
    const res = await fetch(
      SOURCES.hillshade
        .replace("{z}", `${z}`)
        .replace("{x}", `${x}`)
        .replace("{y}", `${y}`),
      { signal: abort.signal },
    );
    // 一覧より細かいズームの海岸沿いは、問い合わせて初めて無いと分かる
    return { data: res.ok ? await res.arrayBuffer() : EMPTY.slice(0) };
  });
}
