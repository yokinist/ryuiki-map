// 地名。e-Stat の町丁・字等別境界データから作った格子（public/places/。約56m×46m のマス）で、地点が入る町丁・字等を引く。
// 道のり沿いは市区町村まで、出発点・河口・水源は町丁・字等まで出す
import { SOURCES } from "../config";
import type { LngLat } from "../geo";
import type { Path } from "../terrain/trace";
import { areasNear, cellOf, nearestArea } from "./place-grid";

/** 市区町村。key は市区町村コード。aza は町丁・字等（出発点・河口・水源だけ。分からなければ省く） */
export interface Place {
  key: string;
  pref: string;
  muni: string;
  aza?: string;
}

/** 「群馬県沼田市」。町丁・字等が分かれば「群馬県沼田市 岩本町」 */
export const placeName = (p: Pick<Place, "pref" | "muni" | "aza">) =>
  `${p.pref}${p.muni}${p.aza ? ` ${p.aza}` : ""}`;
export interface PlaceEvent extends Place {
  step: number;
}

/** public/places/<版>/index.json */
export interface PlaceIndex {
  /** 1次メッシュを縦横に割る数 */
  grid: number;
  /** ファイルがある1次メッシュ */
  meshes: number[];
  /** 市区町村コード（5桁の文字列） → [都道府県名, 市区町村名] */
  cities: Record<string, [string, string]>;
}

/** public/places/<版>/<1次メッシュ>.json */
export interface PlaceFile {
  /** 町丁・字等 [市区町村コード, 名前（水面調査区などは空）] */
  areas: [number, string][];
  /** 南の行から順に、西から [areas の番号（1から。0 はどこにも入らない）, 続くマスの数, …] */
  rows: number[][];
}

// ---- 配信場所: /places/latest.json が今の版を指す（流域サマリの /karte/ と同じ形） ----
let index: Promise<{ url: string; has: Set<number> } & PlaceIndex> | null =
  null;
const files = new Map<number, Promise<PlaceFile | null>>();

function placeIndex() {
  index ??= fetch(`${SOURCES.places}/latest.json`)
    .then((r) =>
      r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
    )
    .then(async ({ version }: { version: string }) => {
      const url = `${SOURCES.places}/${version}`;
      const i: PlaceIndex = await fetch(`${url}/index.json`).then((r) =>
        r.json(),
      );
      return { ...i, url, has: new Set(i.meshes) };
    })
    .catch(() => {
      index = null; // 読めなかったときは覚えずに、次の呼び出しでまた取りに行く
      return {
        url: "",
        has: new Set<number>(),
        grid: 1,
        meshes: [],
        cities: {},
      };
    });
  return index;
}

/** 1次メッシュ1つ分の格子。ないメッシュ（海など）は null */
function placeFile(m1: number): Promise<PlaceFile | null> {
  let file = files.get(m1);
  if (!file) {
    file = placeIndex().then(async ({ url, has }) => {
      if (!has.has(m1)) return null;
      const res = await fetch(`${url}/${m1}.json`);
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    });
    file.catch(() => files.delete(m1)); // 失敗は覚えずに、次の呼び出しでまた取りに行く
    files.set(m1, file);
  }
  return file;
}

/** 道のり沿いでは、この数のマス（約200m）以内にある市区町村をみな候補にする（境界の川で岸を行き来するたびに変えないように） */
const NEAR_CELLS = 4;
/** 河口・水源の町丁・字等は、最後の点からこの数のマス（約1km）まで探す（河口は広い水面の上で終わることがある） */
const END_CELLS = 20;

/** 広げた行（ファイルごとに、使った行だけ覚えておく） */
const expanded = new WeakMap<PlaceFile, Map<number, Uint16Array>>();
function rowOf(file: PlaceFile, grid: number, j: number) {
  let rows = expanded.get(file);
  if (!rows) {
    rows = new Map();
    expanded.set(file, rows);
  }
  let row = rows.get(j);
  if (!row && file.rows[j]) {
    const runs = file.rows[j];
    row = new Uint16Array(grid);
    for (let k = 0, x = 0; k < runs.length; x += runs[k + 1], k += 2)
      row.fill(runs[k], x, x + runs[k + 1]);
    rows.set(j, row);
  }
  return row;
}

/**
 * 各地点から r マス以内にある町丁・字等の市区町村コード（小さい順。どこにも入らない海などは空）。r=0 ならその地点のマスだけ
 */
async function codesAt(pts: LngLat[], r: number): Promise<number[][]> {
  // ponytail: 1次メッシュの境をまたいだ先のマスは見ない（境に沿って流れる川では、候補の幅が片側だけになる）。要るなら隣のファイルも読む
  const { grid } = await placeIndex();
  const cells = pts.map(([x, y]) => cellOf(x, y, grid));
  const byM1 = new Map(
    await Promise.all(
      [...new Set(cells.map((c) => c.m1))].map(
        async (m1) => [m1, await placeFile(m1).catch(() => null)] as const,
      ),
    ),
  );
  return cells.map(({ m1, i, j }) => {
    const file = byM1.get(m1);
    if (!file) return [];
    const codes = areasNear((y) => rowOf(file, grid, y), i, j, r, grid).map(
      (k) => file.areas[k - 1][0],
    );
    return [...new Set(codes)].sort((a, b) => a - b);
  });
}

/** 町丁・字等の名前を地名に添える形にする。頭の「大字」は外す（丁目・字・括弧の中の地区名はそのまま） */
export const azaName = (name: string) => name.replace(/^大字/, "");

/** 市区町村コード → 地名 */
export function placeOf(
  cities: PlaceIndex["cities"],
  code: number,
): Place | null {
  const key = String(code).padStart(5, "0");
  const name = cities[key];
  return name ? { key, pref: name[0], muni: name[1] } : null;
}

/** 市区町村コードと町丁・字等の名前（あれば）→ 地名 */
async function toPlace(
  code: number | undefined,
  name = "",
): Promise<Place | null> {
  if (code === undefined) return null;
  const p = placeOf((await placeIndex()).cities, code);
  const aza = azaName(name);
  return p && aza ? { ...p, aza } : p;
}

/** 地点を囲む輪を近い方から（r マスまで）広げ、accept に合う町丁・字等 [市区町村コード, 名前]。なければ null */
async function areaNear(
  [x, y]: LngLat,
  r: number,
  accept: (area: [number, string]) => boolean,
): Promise<[number, string] | null> {
  // ponytail: codesAt と同じく、1次メッシュの境をまたいだ先は探さない。要るなら隣のファイルも読む
  const { grid } = await placeIndex();
  const { m1, i, j } = cellOf(x, y, grid);
  const file = await placeFile(m1).catch(() => null);
  if (!file) return null;
  const k = nearestArea(
    (row) => rowOf(file, grid, row),
    i,
    j,
    r,
    grid,
    (k) => accept(file.areas[k - 1]),
  );
  return k ? file.areas[k - 1] : null;
}

/** 地点（出発点）の市区町村と町丁・字等。どこにも入らない地点（海の上など）は null */
export async function place(p: LngLat): Promise<Place | null> {
  const area = await areaNear(p, 0, () => true);
  return area && toPlace(...area);
}

/**
 * 道のり沿いで入った市区町村（出発点の市区町村は除く）と、道のりの最後（河口・水源）の市区町村と町丁・字等。
 * 河口・水源の町丁・字等は、最後の点を囲む輪を近い方から広げ、選んだ市区町村のものを探す（境界の川や尾根の上でも、流れてきた側）
 */
export async function placesAlong(
  path: Pick<Path, "pts" | "dist">,
): Promise<{ places: PlaceEvent[]; last: Place | null }> {
  // 出発点は表示（place）と同じく、そのマスだけで引く
  const [codes, [here]] = await Promise.all([
    codesAt(path.pts, NEAR_CELLS),
    codesAt(path.pts.slice(0, 1), 0),
  ]);
  const { changes, last, lastStep } = muniChanges(codes, path.dist, here[0]);
  const places = await Promise.all(changes.map((c) => toPlace(c.code)));
  const end =
    last === undefined
      ? null
      : // 河口は水面（名前のない水面調査区）に入りやすいので、名前のある町丁・字等を探す
        await areaNear(
          path.pts[lastStep],
          END_CELLS,
          ([c, name]) => c === last && name !== "",
        );
  return {
    places: changes.flatMap((c, i) => {
      const p = places[i];
      return p ? [{ ...p, step: c.step }] : [];
    }),
    last: await toPlace(last, end?.[1]),
  };
}

/** 新しい市区町村がこの距離（m）続いたら、道のり沿いに出す（境界になっている川で、岸を行き来するたびに出さないように） */
const MIN_RUN_M = 2000;

/**
 * 道のり沿いで市区町村が変わった所。codes[i] は点 i の市区町村コードの候補（どこにも入らない点は空。dist[i] はその点までの距離 m）。
 * changes の step は新しい市区町村に入った点。出発点と、一度出した市区町村は出し直さない。
 * last は最後の点の市区町村。河口・水源は境界の川や尾根にあることが多いので、候補が複数ならそれまでいた側にする。
 * lastStep はその点（どこかに入る最後の点。なければ -1）。
 * origin は出発点の市区町村（表示と同じく、出発点のマスだけで引いたもの）。省くと最初に見つかった候補
 */
export function muniChanges(
  codes: number[][],
  dist: number[],
  origin = codes.find((c) => c.length)?.[0] ?? -1,
): {
  changes: { step: number; code: number }[];
  last: number | undefined;
  lastStep: number;
} {
  const out: { step: number; code: number }[] = [];
  let cur = origin;
  // 入りかけの市区町村と、入った点
  let next = cur;
  let start = -1;
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (!c.length) continue;
    if (c.includes(cur)) {
      start = -1;
      continue;
    }
    if (start < 0 || !c.includes(next)) {
      next = c[0];
      start = i;
    }
    if (dist[i] - dist[start] >= MIN_RUN_M) {
      cur = next;
      if (cur !== origin && !out.some((o) => o.code === cur))
        out.push({ step: start, code: cur });
      start = -1;
    }
  }
  const lastStep = codes.findLastIndex((c) => c.length);
  const end = codes[lastStep];
  return {
    changes: out,
    last: end && (end.includes(cur) ? cur : next),
    lastStep,
  };
}
