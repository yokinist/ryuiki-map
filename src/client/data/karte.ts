// 流域サマリ: ある地点より上流の範囲（集水域）について、面積・標高・土地の使われ方・人口・ダム・降水量をまとめる
import { SOURCES, WIDEST } from "../config";
import type { LngLat } from "../geo";
import { pickBasin, touchesEdge } from "../terrain/basin-edge";
import { basinExtent, widestTiles } from "../terrain/basin-range";
import { widenBasin } from "../terrain/basin-widen";
import { type Grid, grids, loadWidest } from "../terrain/grid";
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

/** 集水域を数えた候補（グリッドとその中の地点） */
interface BasinCandidate {
  g: Grid;
  s: number;
  up: Uint8Array;
  truncated: boolean;
  km2: number;
}

/** グリッド g で地点 p の集水域を数える。from 以外のグリッドでは約150mの範囲だけ吸着させ直す（近くの大きな川に跳ばないように） */
function basinIn(g: Grid, from: { g: Grid; s: number }): BasinCandidate | null {
  const [lon, lat] = from.g.lngLat(from.s);
  const c = g === from.g ? from.s : g.toCell(lon, lat);
  if (c < 0) return null;
  const s =
    g === from.g
      ? c
      : snap(g.acc, g.W, g.H, c, Math.max(1, Math.round(150 / g.cellM)));
  const up = upstream(g.down, g.order, s);
  return { g, s, up, truncated: touchesEdge(g, up), km2: g.acc[s] * g.cellKm2 };
}

/**
 * 雨の流れをたどった地点より上流の範囲を、読み込み済みのグリッドから選ぶ。
 * まず雨をたどったときのグリッドで数え、端に届いてしまうなら広域グリッド（約190km四方）で数え直す。
 * truncated: 集水域が端に届いている（面積は実際より小さく、いちばん遠い水源も範囲の外にありうる）
 */
export function basinLoaded(from: { g: Grid; s: number }) {
  // 候補は pickBasin が必要とした分だけ数える（収まる範囲が見つかったら、残りのグリッドは数えない）
  function* candidates() {
    for (const g of [from.g, ...grids.wides]) {
      const c = basinIn(g, from);
      if (c) yield c;
    }
  }
  return pickBasin(candidates());
}

/** はみ出した集水域を読み直す粗い範囲。集水域の外接矩形から、切れている辺の方向へ広げたタイルの範囲 */
const widestRangeFor = (c: BasinCandidate) => {
  const { bbox, touched } = basinExtent(c.g, c.up);
  return widestTiles(WIDEST.z, bbox, touched);
};

/**
 * 海に着いて着地の動きが終わったら呼ぶ（rain.ts）。集水域が読み込み済みのグリッドに収まらないなら、さかのぼり専用の粗い範囲を裏で読み始める。
 * 「上流へさかのぼる」を押されたときには読み終わっているように。収まる川（大半）では何も読まない
 */
export function prefetchBasin(from: { g: Grid; s: number }) {
  // どの地点でも問い合わせる（収まる川ならすぐ終わる）。前の地点の先読みは、これで読み直しを打ち切る。
  // 失敗しても何もしない（読めなかった・打ち切った結果は覚えないので、押されたときに basinAt が読み直す）
  basinAt(from).catch(() => {});
}

/**
 * 雨の流れをたどった地点より上流の範囲。読み込み済みのグリッドのどれにも収まらなければ、
 * さかのぼり専用の粗い範囲（集水域に合わせた形、最大36枚）を読んで数え直す。それにも収まらなければ truncated のまま返す。
 * 同じ地点への問い合わせ（先読み・「上流へさかのぼる」・流域サマリ）は、1つの結果を使い回す（読み直さない・結果がぶれない）
 */
export function basinAt(
  from: { g: Grid; s: number },
  say?: (text: string) => void,
) {
  const key = from.g.lngLat(from.s).join(",");
  // 進み具合は、いま待っている呼び出し元に出す（先読みの結果を使い回しても、押した側に表示が届くように）
  if (lastBasin?.key === key) {
    if (say) lastBasin.say = say;
    return lastBasin.promise;
  }
  const entry: NonNullable<typeof lastBasin> = {
    key,
    say,
    promise: Promise.resolve(null),
  };
  lastBasin = entry;
  // 読めなかった・途中で打ち切った結果は、次に聞かれたときに読み直せるよう覚えない。
  // 最後まで試して切れたままの結果は、読み直しても同じなので覚えておく（押したとき・サマリで待たせない）
  const forget = () => {
    if (lastBasin === entry) lastBasin = null;
  };
  entry.promise = findBasin(
    from,
    (text) => entry.say?.(text),
    () => lastBasin === entry,
  ).then(
    (r) => {
      if (!r.complete) forget();
      return r.basin;
    },
    (e) => {
      forget();
      throw e;
    },
  );
  return entry.promise;
}
let lastBasin: {
  key: string;
  say?: (text: string) => void;
  promise: Promise<BasinCandidate | null>;
} | null = null;

/** 読み込み済みの範囲で数え、切れていれば、さかのぼり専用の粗い範囲を広げて読み直す（terrain/basin-widen.ts） */
async function findBasin(
  from: { g: Grid; s: number },
  say: (text: string) => void,
  current: () => boolean,
): Promise<{ basin: BasinCandidate | null; complete: boolean }> {
  const loaded = basinLoaded(from);
  if (!loaded?.truncated) return { basin: loaded, complete: true };
  return widenBasin(loaded, {
    current,
    // 読めなければ（通信の失敗など）、そこまでの結果（切れている）で続ける。止めて待たせない
    load: async (best) => {
      const widest = await loadWidest(widestRangeFor(best), say).catch(
        () => null,
      );
      if (!widest) return null;
      // 吸着し直しで別の小さな沢に乗った候補は選ばない（増えないので、そこで止まる）
      return pickBasin([loaded, basinIn(widest, from)].filter((c) => !!c));
    },
  });
}

/** グリッド g のセル s より上流の範囲の流域サマリ（降水量は別に precipitation で問い合わせる） */
export async function karteAt(from: {
  g: Grid;
  s: number;
}): Promise<Karte | null> {
  const basin = await basinAt(from);
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
