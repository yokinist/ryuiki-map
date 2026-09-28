// グリッドづくりを丸ごと引き受ける Web Worker。
// 標高タイルの読み込み・河川タイルの展開・焼き込み・流向計算はどれも数百万セル規模なので、画面が固まらないようここで行う
import { SOURCES } from "../config";
import {
  cachedTiles,
  fetchTile,
  type RiverLine,
  tileKeysFor,
} from "../data/river-format";
import { type RiverProps, rasterize } from "../data/rivers";
import type { BBox } from "../geo";
import { loadDemTile } from "./dem";
import { gridSpec } from "./grid-spec";
import { type Routed, route } from "./hydro";

export interface BuildRequest {
  id: number;
  bbox: BBox;
  z?: number;
}
export interface BuildDone extends Routed {
  id: number;
  type: "done";
  /** 実際に使ったズーム。メインスレッドは gridSpec(bbox, Z) で同じグリッドを作り直す */
  Z: number;
  elev: Float32Array;
  label: Int32Array;
  rivers: RiverProps[];
  /** 処理ごとの経過時間（開発時の計測用） */
  timing: string;
}
export type BuildMessage =
  | { id: number; type: "progress"; text: string }
  | { id: number; type: "error"; message: string }
  | BuildDone;

// 河川タイルは Worker の中でもタイル単位で覚えておく（広域グリッドは同じタイルを何度も使う）
// ponytail: 0.5°タイル1枚は展開後でも1MB前後なので60枚で足りる
const cache = new Map<string, Promise<RiverLine[]>>();
const MAX_CACHED = 60;
async function riversIn(bbox: BBox) {
  const tiles = cachedTiles(cache, tileKeysFor(bbox), MAX_CACHED, (k) =>
    fetchTile(SOURCES.rivers, k),
  );
  return (await Promise.all(tiles)).flat();
}

const post = (m: BuildMessage, transfer: Transferable[] = []) =>
  postMessage(m, { transfer });

self.onmessage = async (e: MessageEvent<BuildRequest>) => {
  const { id, bbox, z } = e.data;
  const t0 = performance.now();
  const lap: string[] = []; // 開発時だけ、処理ごとの時間をコンソールに出す
  const mark = (name: string) =>
    lap.push(`${name} ${Math.round(performance.now() - t0)}ms`);
  try {
    const g = gridSpec(bbox, z);
    post({
      id,
      type: "progress",
      text: "地形を読み込み中…",
    });
    const elev = new Float32Array(g.W * g.H).fill(Number.NaN);
    const dem: Promise<void>[] = [];
    for (let ty = g.ty0; ty <= g.ty1; ty++)
      for (let tx = g.tx0; tx <= g.tx1; tx++)
        dem.push(loadDemTile(g, tx, ty, elev));
    const [lines] = await Promise.all([riversIn(g.bbox), ...dem]);
    mark("load");

    post({
      id,
      type: "progress",
      text: "流れの向きを計算中…",
    });
    const { label, burn } = rasterize(g, lines);
    mark("rasterize");
    const burned = elev.slice(); // 表示用の標高は残し、計算用だけ川沿いを下げる
    for (let c = 0; c < burned.length; c++) burned[c] -= burn[c];
    const r = route(burned, g.W, g.H);
    mark("route");

    post(
      {
        id,
        type: "done",
        Z: g.Z,
        elev,
        label,
        rivers: lines.map(({ name, km }) => ({ name, km })),
        timing: `z${g.Z} ${((g.W * g.H) / 1e6).toFixed(1)}M cells, ${lines.length} rivers: ${lap.join(", ")}`,
        ...r,
      },
      [elev.buffer, label.buffer, r.down.buffer, r.order.buffer, r.acc.buffer],
    );
  } catch (err) {
    post({
      id,
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
