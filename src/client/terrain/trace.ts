import { WIDEST } from "../config";
import { type RiverEvent, riversAlong } from "../data/rivers";
import type { LngLat } from "../geo";
import type { SourcePath } from "../ui/timeline";
import { type Grid, gridAround, insideOf, loadWide } from "./grid";
import { farthestStem, mainStem, snap, tributaries } from "./hydro";
import { isSourceCut } from "./source-cut";
import {
  joinIndex,
  nearM,
  reverseToSource,
  stepM,
  traceDown,
} from "./trace-core";

/** 雨粒がたどる流路。dist[i] は pts[i] までの流路長 m、rivers[].step は pts の添字 */
export interface Path {
  pts: LngLat[];
  dist: number[];
  rivers: RiverEvent[];
  toSea: boolean;
}

/**
 * s から海まで。グリッドの端に出たら、その先を含むグリッドに乗り換えて続きを追う。
 * grow: 乗り換え先がなければ広域グリッドを読み込む。withRivers: 川の名前も調べる
 */
export async function traceToSea(
  g: Grid,
  s: number,
  opts: {
    grow?: boolean;
    withRivers?: boolean;
    say?: (text: string) => void;
  } = {},
): Promise<Path> {
  const { grow = true, withRivers = true } = opts;
  const rivers: RiverEvent[] = [];
  const { pts, dist, toSea } = await traceDown(
    g,
    s,
    async (exit, cur) => {
      const next = gridAround(exit, cur);
      if (next || !grow) return next ?? null;
      opts.say?.("下流の地形を読み込み中…");
      return loadWide(exit);
    },
    (cur, cells, base) => {
      if (!withRivers) return;
      for (const r of riversAlong(cur, cells, base === 0))
        if (rivers.at(-1)?.name !== r.name)
          rivers.push({ ...r, step: base + r.step });
    },
  );
  return { pts, dist, rivers, toSea };
}

/** 支流として出す集水域の広さと、合流点の本筋に対する割合。小さな沢まで並べると本筋が埋もれる */
const MIN_TRIBUTARY_KM2 = 5;
const MIN_TRIBUTARY_SHARE = 0.1;

/**
 * 本筋 cells（クリック地点側が先頭）に流れ込む、名前のある主な支流。step は cells の添字に base を足したもの。
 * 支流の名前は、合流点から1.5kmほど支流側をさかのぼった区間で引く（合流点では本流の名前が近くにあるので）
 */
function namedTributaries(
  g: Grid,
  cells: number[],
  base: number,
  riverAt: (step: number) => string | undefined,
  seen: Set<string>,
): SourcePath["tributaries"] {
  const len = Math.ceil(1500 / g.cellM);
  const named: SourcePath["tributaries"] = [];
  for (const t of tributaries(
    g.down,
    g.acc,
    g.W,
    g.H,
    cells,
    MIN_TRIBUTARY_KM2 / g.cellKm2,
    MIN_TRIBUTARY_SHARE,
  )) {
    const up = mainStem(g.down, g.acc, g.W, g.H, t.cell).slice(0, len);
    const name = riversAlong(g, up, false)[0]?.name;
    const step = base + t.step;
    if (!name || name === riverAt(step) || seen.has(name)) continue;
    seen.add(name);
    named.push({ name, step });
  }
  return named;
}

/**
 * s から、支流の先の先までたどっていちばん遠い水源へさかのぼる（g の中だけ）。
 * truncated: s の集水域が g からはみ出している（端に着いたときと同じく cut）
 */
export function traceToSource(
  g: Grid,
  s: number,
  truncated = false,
): SourcePath {
  const cells = farthestStem(g.down, g.order, g.W, s);
  const dist = [0];
  for (let i = 1; i < cells.length; i++)
    dist.push(dist[i - 1] + stepM(g, cells[i - 1], cells[i]));
  const rivers = riversAlong(g, cells);
  const riverAt = (step: number) =>
    rivers.findLast((r) => r.step <= step)?.name;
  const last = cells[cells.length - 1];
  return {
    pts: cells.map((c) => g.lngLat(c)),
    dist,
    rivers,
    tributaries: namedTributaries(g, cells, 0, riverAt, new Set()),
    elev: g.elev[last],
    cut: isSourceCut(g, last, truncated),
  };
}

/**
 * 水源から下った線がクリック地点のこの距離以内を通ったら着いたとみなす。
 * 粗い範囲と細かい範囲で流れの筋がずれ、川幅の広い川（信濃川など）では細かい範囲でも筋が何本かに分かれる
 */
const JOIN_M = 300;
/** 引き直しは、尾根にある水源そのものではなく、粗い道のりでこのセル数だけ下流の谷の中から始める（尾根では隣の流域に吸着しかねない） */
const TIP_CELLS = 5;
/** 引き直しで乗り換える範囲は、地点をこのセル数以上内側に含むものに限る（広域で約15km） */
const DEEP_CELLS = 128;

/**
 * 粗い範囲で見つけた水源から、今と同じ細かさの範囲（広域約120m、クリック地点の近くは約15m）で下流へたどり直し、
 * 逆向きにして「さかのぼる道」にする。粗い範囲は水源の位置を決めるためだけに使う。
 * クリック地点のそばを通らなければ null（呼び出し側は粗い道のりのまま出す）
 */
export async function refineSource(
  coarse: SourcePath,
  click: { g: Grid; s: number },
  coarseGrid: Grid,
  say?: (text: string) => void,
): Promise<SourcePath | null> {
  if (coarse.cut) return null;
  const target = click.g.lngLat(click.s);
  // 水源を広域グリッドで見つけたなら、同じグリッドの水源のセルから吸着させずに下ればよい（同じ筋をたどる）。
  // さかのぼり専用の粗い範囲で見つけたときだけ、少し下流の谷の中から細かい範囲で下り直す
  const foundInWide = coarseGrid.Z > WIDEST.z; // ズームで比べる（grids.widest は後から差し替わることがある）
  const tip = foundInWide
    ? coarse.pts.length - 1
    : Math.max(0, coarse.pts.length - 1 - TIP_CELLS);
  const from = coarse.pts[tip];
  let g = foundInWide ? coarseGrid : gridAround(from, undefined, DEEP_CELLS);
  if (!g) {
    say?.("水源付近の地形を読み込み中…");
    g = await loadWide(from, say);
  }
  const start = g.toCell(...from);
  if (start < 0) return null;
  const segments: { g: Grid; cells: number[]; base: number }[] = [];
  let walked = 0;
  let prev: LngLat | null = null;
  const giveUpM = coarse.dist[coarse.dist.length - 1] * 1.5 + 5000;
  const down = await traceDown(
    g,
    foundInWide ? start : snap(g.acc, g.W, g.H, start, 1),
    async (exit, cur) => {
      // 境目のすぐ内側に乗り換えると、そこで範囲の端へ流れ出て行ったり来たりするので、十分内側に含む範囲にだけ乗り換える
      const next = gridAround(exit, cur, DEEP_CELLS);
      if (next) return next;
      say?.("水源付近の地形を読み込み中…");
      return loadWide(exit, say);
    },
    (cur, cells, base) => segments.push({ g: cur, cells: [...cells], base }),
    (p, cur) => {
      // 粗い道のりより大きく遠回りしたら、つながらないとみなして打ち切る（読み込みを続けて待たせない）
      walked += prev ? nearM(prev, p) : 0;
      prev = p;
      if (walked > giveUpM) return "abort";
      // 細かい範囲に乗り換えたあとは、数セルまで近づいてから止める（並んで流れる支流の上で止めないように）
      const r =
        cur === click.g
          ? Math.min(JOIN_M, Math.max(60, 3 * click.g.cellM))
          : JOIN_M;
      if (joinIndex([p], target, r) === 0) return "stop";
      // クリック地点の近くは、雨をたどったときと同じ細かい範囲で引く。端の近くは範囲の外へ流れ出やすいので、十分内側に入ってから。
      // 乗り換えた点は粗い筋の上なので、JOIN_M（約300m）の範囲で一番大きい流れ（本流）に乗せ直す
      if (click.g.Z > cur.Z && insideOf(click.g, p, 64))
        return {
          to: click.g,
          r: Math.max(2, Math.round(JOIN_M / click.g.cellM)),
        };
      return null;
    },
  );
  // 止めた点とクリック地点のすき間を埋め、線がクリック地点から始まるようにする
  const line = reverseToSource(down, coarse, tip, target);
  if (!line) return null;

  // 川の名前と支流は、区間ごとに細かい道のりで引き直す。添字 j（下り）は N-1-j（さかのぼり）になる
  const N = down.pts.length;
  const rivers: RiverEvent[] = [];
  const parts = segments
    .map(({ g, cells, base }) => ({
      g,
      cells: [...cells].reverse(),
      base: N - base - cells.length + line.offset,
    }))
    .reverse();
  // 出発点の川（短くても残す）は、並びの先頭の区間で見る（先頭にクリック地点を足したので base は 0 にならない）
  for (const [i, { g, cells, base }] of parts.entries())
    for (const r of riversAlong(g, cells, i === 0))
      if (rivers.at(-1)?.name !== r.name)
        rivers.push({ ...r, step: base + r.step });
  const riverAt = (step: number) =>
    rivers.findLast((r) => r.step <= step)?.name;
  const seen = new Set<string>();
  const named = parts.flatMap(({ g, cells, base }) =>
    namedTributaries(g, cells, base, riverAt, seen),
  );
  return {
    pts: line.pts,
    dist: line.dist,
    rivers,
    tributaries: named,
    elev: coarse.elev,
    cut: false,
  };
}
