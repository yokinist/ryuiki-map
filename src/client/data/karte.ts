// 流域サマリ: ある地点より上流の範囲（集水域）について、面積・標高・土地の使われ方・人口・ダム・降水量をまとめる
import { SOURCES } from "../config";
import type { LngLat } from "../geo";
import { type Grid, grids } from "../terrain/grid";
import { snap, upstream } from "../terrain/hydro";
import {
  type DamRow,
  type KarteIndex,
  type MeshRow,
  meshOf,
} from "./karte-format";
import {
  annualMeanMm,
  type DamOnPath,
  damsNearPath,
  longestFlowKm,
  type MeshSummary,
  pathMeshWeights,
  summarizeMeshes,
  summarizePathLand,
} from "./karte-stats";

export type { DamOnPath };

export interface Karte {
  outlet: LngLat;
  areaKm2: number;
  /** 範囲の中で最も水源から遠い地点から、この地点までの川筋に沿った距離 */
  lengthKm: number;
  /** 計算範囲の端まで届いていて、実際の範囲はもっと広い */
  truncated: boolean;
  elev: { min: number; mean: number; max: number };
  /** 範囲内の川（範囲内で長く流れている順） */
  rivers: string[];
  /** 人口と土地の使われ方。データが読めなければ null */
  meshes: MeshSummary | null;
  dams: { dams: string[]; damCount: number; weirCount: number };
  /** 範囲の中心あたり（降水量を問い合わせる地点） */
  center: LngLat;
}

// ---- 配信場所: /karte/latest.json が今の版を指し、ファイルは /karte/<版>/meshes/ と /karte/<版>/dams/ ----
type Kind = keyof KarteIndex;
let index: Promise<{ url: string; has: Record<Kind, Set<number>> }> | null =
  null;
const files = new Map<string, Promise<unknown[]>>();

function karteIndex() {
  index ??= fetch(`${SOURCES.karte}/latest.json`)
    .then((r) =>
      r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
    )
    .then(async ({ version }: { version: string }) => {
      const url = `${SOURCES.karte}/${version}`;
      const i: KarteIndex = await fetch(`${url}/index.json`).then((r) =>
        r.json(),
      );
      return { url, has: { meshes: new Set(i.meshes), dams: new Set(i.dams) } };
    })
    .catch(() => {
      index = null; // 読めなかったときは覚えずに、次の呼び出しでまた取りに行く
      return {
        url: "",
        has: { meshes: new Set<number>(), dams: new Set<number>() },
      };
    });
  return index;
}

/** 1次メッシュ1つ分のファイル。ないメッシュ（海など）は空 */
function karteFile<T>(kind: Kind, m1: number): Promise<T[]> {
  const key = `${kind}/${m1}`;
  let file = files.get(key);
  if (!file) {
    file = karteIndex().then(async ({ url, has }) => {
      if (!has[kind].has(m1)) return [];
      const res = await fetch(`${url}/${key}.json`);
      return res.ok ? res.json() : [];
    });
    file.catch(() => files.delete(key));
    files.set(key, file);
  }
  return file as Promise<T[]>;
}

/** 範囲が計算グリッドの端に届いているか */
function touchesEdge(g: Grid, up: Uint8Array) {
  const { W, H } = g;
  for (let x = 0; x < W; x++) if (up[x] || up[(H - 1) * W + x]) return true;
  for (let y = 0; y < H; y++) if (up[y * W] || up[y * W + W - 1]) return true;
  return false;
}

/**
 * 雨の流れをたどった地点より上流の範囲。まず雨をたどったときのグリッドで数え、端に届いてしまうなら広域グリッド（約190km四方）で数え直す。
 * 広域では約150mの範囲だけ吸着させ直す（近くの大きな川に跳ばないように）
 */
export function basinAt(from: { g: Grid; s: number }) {
  const [lon, lat] = from.g.lngLat(from.s);
  let best: { g: Grid; s: number; up: Uint8Array; truncated: boolean } | null =
    null;
  for (const g of [from.g, ...grids.wides]) {
    const c = g === from.g ? from.s : g.toCell(lon, lat);
    if (c < 0) continue;
    const s =
      g === from.g
        ? c
        : snap(g.acc, g.W, g.H, c, Math.max(1, Math.round(150 / g.cellM)));
    const up = upstream(g.down, g.order, s);
    const truncated = touchesEdge(g, up);
    if (!truncated) return { g, s, up, truncated };
    best ??= { g, s, up, truncated };
  }
  return best;
}

/** グリッド g のセル s より上流の範囲の流域サマリ（降水量は別に precipitation で問い合わせる） */
export async function karteAt(from: {
  g: Grid;
  s: number;
}): Promise<Karte | null> {
  const basin = basinAt(from);
  if (!basin) return null;
  const { g, s, up, truncated } = basin;
  let cells = 0;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let cx = 0;
  let cy = 0;
  const inMesh = new Map<number, number>(); // 3次メッシュのキー → 範囲に入る面積 km²
  const rivers = new Map<string, number>();
  for (let c = 0; c < up.length; c++) {
    if (!up[c]) continue;
    const e = g.elev[c];
    if (Number.isNaN(e)) continue;
    cells++;
    sum += e;
    if (e < min) min = e;
    if (e > max) max = e;
    const [x, y] = g.lngLat(c);
    cx += x;
    cy += y;
    const { m1, sub } = meshOf(x, y);
    const key = m1 * 10000 + sub;
    inMesh.set(key, (inMesh.get(key) ?? 0) + g.cellKm2);
    if (g.label[c] >= 0) {
      const name = g.rivers[g.label[c]].name;
      rivers.set(name, (rivers.get(name) ?? 0) + 1);
    }
  }
  if (!cells) return null;

  const m1s = [
    ...new Set([...inMesh.keys()].map((k) => Math.floor(k / 10000))),
  ];
  const [meshFiles, damFiles] = await Promise.all([
    Promise.all(m1s.map((m1) => karteFile<MeshRow>("meshes", m1))),
    Promise.all(m1s.map((m1) => karteFile<DamRow>("dams", m1))),
  ]);
  const rows = new Map<number, MeshRow>();
  meshFiles.forEach((list, i) => {
    for (const row of list) rows.set(m1s[i] * 10000 + row[0], row);
  });
  const damRows = damFiles.flat();
  // ダム・堰は、その位置のセルが範囲に入っていれば数える
  const dams = { dams: [] as string[], damCount: 0, weirCount: 0 };
  for (const [x, y, kind, name] of damRows) {
    const c = g.toCell(x, y);
    if (c < 0 || !up[c]) continue;
    if (kind === 0) {
      dams.damCount++;
      if (name && !dams.dams.includes(name)) dams.dams.push(name);
    } else dams.weirCount++;
  }

  return {
    outlet: from.g.lngLat(from.s),
    areaKm2: cells * g.cellKm2,
    lengthKm: longestFlowKm(g.down, g.order, up, g.W, g.cellM, s),
    truncated,
    elev: { min, mean: sum / cells, max },
    rivers: [...rivers].sort((a, b) => b[1] - a[1]).map(([n]) => n),
    meshes: rows.size ? summarizeMeshes(inMesh, rows) : null,
    dams,
    center: [cx / cells, cy / cells],
  };
}

/**
 * 範囲の中心あたりの年間降水量 mm（1991〜2020年の平均）。Open-Meteo の過去の気象データ（ERA5 の再解析、約10〜25km格子）。
 * ponytail: 1地点の値で範囲全体を代表させる。山の多い広い範囲では実際より少なめに出やすい
 */
const rain = new Map<string, Promise<number | null>>();
export function precipitation([lon, lat]: LngLat) {
  const key = `${lon.toFixed(2)},${lat.toFixed(2)}`;
  let v = rain.get(key);
  if (!v) {
    v = fetch(SOURCES.climate(lon, lat))
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      )
      .then((d: { daily: { precipitation_sum: (number | null)[] } }) =>
        annualMeanMm(d.daily.precipitation_sum),
      )
      .catch(() => {
        rain.delete(key);
        return null;
      });
    rain.set(key, v);
  }
  return v;
}

/** 雨の通り道に沿った土地の使われ方（6分類の割合）。データが足りなければ null */
export async function landAlong(pts: LngLat[]): Promise<number[] | null> {
  const weights = pathMeshWeights(pts);
  if (!weights.size) return null;
  const m1s = [
    ...new Set([...weights.keys()].map((k) => Math.floor(k / 10000))),
  ];
  const meshFiles = await Promise.all(
    m1s.map((m1) => karteFile<MeshRow>("meshes", m1)),
  );
  const rows = new Map<number, MeshRow>();
  meshFiles.forEach((list, i) => {
    for (const row of list) rows.set(m1s[i] * 10000 + row[0], row);
  });
  const s = summarizePathLand(weights, rows);
  return s && s.coverage > 0.5 ? s.land : null;
}

/** 雨の通り道（流路）沿いのダム・堰。流路が通る1次メッシュのダムのファイルだけを読む */
export async function damsAlong(pts: LngLat[]): Promise<DamOnPath[]> {
  const m1s = [...new Set(pts.map(([x, y]) => meshOf(x, y).m1))];
  const files = await Promise.all(
    m1s.map((m1) => karteFile<DamRow>("dams", m1)),
  );
  return damsNearPath(pts, files.flat());
}
