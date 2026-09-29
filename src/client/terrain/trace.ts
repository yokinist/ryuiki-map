import { type RiverEvent, riversAlong } from "../data/rivers";
import type { LngLat } from "../geo";
import type { SourcePath } from "../ui/timeline";
import { type Grid, gridAround, loadWide } from "./grid";
import { farthestStem, mainStem, snap, tributaries } from "./hydro";
import { isSourceCut } from "./source-cut";

/** 雨粒がたどる流路。dist[i] は pts[i] までの流路長 m、rivers[].step は pts の添字 */
export interface Path {
  pts: LngLat[];
  dist: number[];
  rivers: RiverEvent[];
  toSea: boolean;
}

/** 隣り合うセル p, q の間の距離 m */
function stepM(g: Grid, p: number, q: number) {
  const diagonal = q % g.W !== p % g.W && ((q / g.W) | 0) !== ((p / g.W) | 0);
  return diagonal ? g.cellM * Math.SQRT2 : g.cellM;
}

/** 1つのグリッド内で s から海（または範囲の端）まで */
function traceIn(g: Grid, s: number) {
  const cells = [s];
  const dist = [0];
  let p = s;
  let len = 0;
  let toSea = false;
  while (g.down[p] >= 0) {
    const q = g.down[p];
    len += stepM(g, p, q);
    p = q;
    cells.push(p);
    dist.push(len);
    if (Number.isNaN(g.elev[p])) {
      toSea = true;
      break;
    }
  }
  return { cells, dist, toSea };
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
  const path: Path = { pts: [], dist: [], rivers: [], toSea: false };
  let off = 0;
  for (let hop = 0; hop < 8; hop++) {
    const tr = traceIn(g, s);
    const base = path.pts.length;
    if (withRivers)
      for (const r of riversAlong(g, tr.cells, base === 0))
        if (path.rivers.at(-1)?.name !== r.name)
          path.rivers.push({ ...r, step: base + r.step });
    tr.cells.forEach((c, i) => {
      path.pts.push(g.lngLat(c));
      path.dist.push(off + tr.dist[i]);
    });
    off = path.dist[path.dist.length - 1];
    if (tr.toSea) {
      path.toSea = true;
      break;
    }
    const exit = path.pts[path.pts.length - 1];
    let next = gridAround(exit, g);
    if (!next && grow) {
      opts.say?.("下流の地形を読み込み中…");
      next = await loadWide(exit);
    }
    if (!next) break;
    g = next;
    s = snap(g.acc, g.W, g.H, g.toCell(...exit), 2);
    if (Number.isNaN(g.elev[s])) {
      path.toSea = true;
      break;
    }
  }
  return path;
}

/** 支流として出す集水域の広さと、合流点の本筋に対する割合。小さな沢まで並べると本筋が埋もれる */
const MIN_TRIBUTARY_KM2 = 5;
const MIN_TRIBUTARY_SHARE = 0.1;

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
  // 支流の名前は、合流点から1.5kmほど支流側をさかのぼった区間で引く（合流点では本流の名前が近くにあるので）
  const len = Math.ceil(1500 / g.cellM);
  const seen = new Set<string>();
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
    if (!name || name === riverAt(t.step) || seen.has(name)) continue;
    seen.add(name);
    named.push({ name, step: t.step });
  }
  const last = cells[cells.length - 1];
  return {
    pts: cells.map((c) => g.lngLat(c)),
    dist,
    rivers,
    tributaries: named,
    elev: g.elev[last],
    cut: isSourceCut(g, last, truncated),
  };
}
