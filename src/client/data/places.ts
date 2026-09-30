// 地名（市区町村）。統計局「市区町村別メッシュ・コード一覧」から作った表（public/munis/）で、地点が入る1kmメッシュの市区町村を引く
import { SOURCES } from "../config";
import type { LngLat } from "../geo";
import type { Path } from "../terrain/trace";
import { meshOf } from "./karte-format";

/** 市区町村。key は市区町村コード */
export interface Place {
  key: string;
  pref: string;
  muni: string;
}

/** 「群馬県沼田市」 */
export const placeName = (p: Pick<Place, "pref" | "muni">) =>
  `${p.pref}${p.muni}`;
export interface PlaceEvent extends Place {
  step: number;
}

/**
 * public/munis/<版>/index.json。<1次メッシュ>.json は { 市区町村コード: [1次メッシュ内の番号, ...] }。
 * 境界をまたぐメッシュは、またがる市区町村すべてに入っている
 */
export interface MuniIndex {
  meshes: number[];
  /** 市区町村コード → [都道府県名, 市区町村名] */
  names: Record<string, [string, string]>;
}

// ---- 配信場所: /munis/latest.json が今の版を指す（流域サマリの /karte/ と同じ形） ----
let index: Promise<{
  url: string;
  has: Set<number>;
  names: MuniIndex["names"];
}> | null = null;
const files = new Map<number, Promise<Map<number, number[]>>>();

function muniIndex() {
  index ??= fetch(`${SOURCES.munis}/latest.json`)
    .then((r) =>
      r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
    )
    .then(async ({ version }: { version: string }) => {
      const url = `${SOURCES.munis}/${version}`;
      const i: MuniIndex = await fetch(`${url}/index.json`).then((r) =>
        r.json(),
      );
      return { url, has: new Set(i.meshes), names: i.names };
    })
    .catch(() => {
      index = null; // 読めなかったときは覚えずに、次の呼び出しでまた取りに行く
      return { url: "", has: new Set<number>(), names: {} };
    });
  return index;
}

/** 1次メッシュ1つ分: 1次メッシュ内の番号 → 市区町村コード。ないメッシュ（海など）は空 */
function muniFile(m1: number): Promise<Map<number, number[]>> {
  let file = files.get(m1);
  if (!file) {
    file = muniIndex().then(async ({ url, has }) => {
      const subs = new Map<number, number[]>();
      if (!has.has(m1)) return subs;
      const res = await fetch(`${url}/${m1}.json`);
      if (!res.ok) throw new Error(String(res.status));
      const byCode: Record<string, number[]> = await res.json();
      for (const [code, list] of Object.entries(byCode))
        for (const sub of list)
          subs.set(sub, [...(subs.get(sub) ?? []), +code]);
      return subs;
    });
    file.catch(() => files.delete(m1)); // 失敗は覚えずに、次の呼び出しでまた取りに行く
    files.set(m1, file);
  }
  return file;
}

/** 各地点が入る1kmメッシュの市区町村コード（境界をまたぐメッシュは複数。表にない海などは空） */
async function codesAt(pts: LngLat[]): Promise<number[][]> {
  const meshes = pts.map(([x, y]) => meshOf(x, y));
  const byM1 = new Map(
    await Promise.all(
      [...new Set(meshes.map((m) => m.m1))].map(
        async (m1) =>
          [
            m1,
            await muniFile(m1).catch(() => new Map<number, number[]>()),
          ] as const,
      ),
    ),
  );
  return meshes.map(({ m1, sub }) => byM1.get(m1)?.get(sub) ?? []);
}

/** 市区町村コード → 地名。一覧のコードは5桁の文字列（北海道〜栃木は頭が0） */
export function placeOf(names: MuniIndex["names"], code: number): Place | null {
  const key = String(code).padStart(5, "0");
  const name = names[key];
  return name ? { key, pref: name[0], muni: name[1] } : null;
}

async function toPlace(code: number | undefined): Promise<Place | null> {
  return code === undefined ? null : placeOf((await muniIndex()).names, code);
}

/** 地点（出発点）の市区町村。表にない地点（海の上など）は null */
export async function place(p: LngLat): Promise<Place | null> {
  const [codes] = await codesAt([p]);
  // ponytail: 境界をまたぐメッシュでは候補の先頭（コードの小さいほう）。境界から1km以内は隣の市区町村になることがある
  return toPlace(codes[0]);
}

/** 道のり沿いで入った市区町村（出発点の市区町村は除く）と、道のりの最後（河口・水源）の市区町村 */
export async function placesAlong(
  path: Pick<Path, "pts" | "dist">,
): Promise<{ places: PlaceEvent[]; last: Place | null }> {
  const { changes, last } = muniChanges(await codesAt(path.pts), path.dist);
  const places = await Promise.all(changes.map((c) => toPlace(c.code)));
  return {
    places: changes.flatMap((c, i) => {
      const p = places[i];
      return p ? [{ ...p, step: c.step }] : [];
    }),
    last: await toPlace(last),
  };
}

/** 新しい市区町村がこの距離（m）続いたら、道のり沿いに出す（境界になっている川で、岸を行き来するたびに出さないように） */
const MIN_RUN_M = 2000;

/**
 * 道のり沿いで市区町村が変わった所。codes[i] は点 i が入る1kmメッシュの市区町村コード（dist[i] はその点までの距離 m）。
 * changes の step は新しい市区町村に入った点。出発点と、一度出した市区町村は出し直さない。
 * last は最後の点の市区町村。河口・水源は境界の川や尾根にあることが多いので、候補が複数ならそれまでいた側にする
 */
export function muniChanges(
  codes: number[][],
  dist: number[],
): { changes: { step: number; code: number }[]; last: number | undefined } {
  const out: { step: number; code: number }[] = [];
  const origin = codes.find((c) => c.length)?.[0] ?? -1;
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
  const end = codes.findLast((c) => c.length);
  return { changes: out, last: end && (end.includes(cur) ? cur : next) };
}
