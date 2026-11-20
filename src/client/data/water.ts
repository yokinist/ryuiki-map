// 水のきれいさ。環境省「公共用水域水質測定結果」の河川の BOD 年平均から作った表（public/water/）で、通り道のそばの測定点を引く
import { SOURCES } from "../config";
import type { LngLat } from "../geo";
import { meshOf } from "./karte-format";
import { nearestOnPath } from "./karte-stats";
import {
  WATER_PAST_YEARS,
  type WaterIndex,
  type WaterRow,
} from "./water-format";

export type { WaterRow };

// 河川の BOD の環境基準（mg/L 以下）と、その類型の水が向く生きもの・使いみち。level は小さいほどきれい
const GRADES = [
  [1, "自然の清流なみ"], // AA（自然環境保全）。A と分けないと、大きな川は上流から河口まで同じ段になって変化が見えない
  [2, "ヤマメ・イワナが棲めるくらい"], // A（水産1級）
  [3, "アユが棲めるくらい"], // B（水産2級）
  [5, "コイ・フナが棲めるくらい"], // C（水産3級）
  [8, "田畑の水に使えるくらい"], // D（農業用水）
] as const;

// メーターの段の上限 BOD mg/L。言葉の段階より細かくして、同じ言葉が続く大きな川でも変化が見えるようにする。
// 環境基準の境目（1・2・3・5・8・10）は必ず段の境目にし、言葉の段階と食い違わないようにする
const SCORE_STEPS = [0.5, 1, 1.5, 2, 3, 4, 5, 8, 10];

/** メーターの段数 */
export const WATER_SCORE_MAX = SCORE_STEPS.length + 1;

/** BOD → きれいさの点数（1〜10。きれいなほど大きい）。言葉だけでは、どちらがきれいか分かりにくいのでメーターにする */
export function waterScore(bod: number): number {
  const i = SCORE_STEPS.findIndex((max) => bod <= max);
  return WATER_SCORE_MAX - (i < 0 ? SCORE_STEPS.length : i);
}

export interface WaterOnPath {
  /** 流路上の位置（いちばん近い点の添字） */
  step: number;
  /** 測定点の名前（たいていは橋） */
  name: string;
  bod: number;
  year: number;
  level: number;
  label: string;
  /** 推移。測った年度の BOD を古い順に（最後が最新の年度） */
  history: { year: number; bod: number }[];
}

type PathLike = {
  pts: LngLat[];
  dist?: number[];
  rivers?: { name: string; step: number }[];
};

/**
 * 流路 pts から maxM 以内の測定点を、流路の順に全部返す（流域サマリでいちばん近い測定点を選ぶのに使う）。
 * そばを流れる川の名前が分かる測定点は、流路のその位置の川と同じものだけ拾う。近くを流れる支流の測定点を除くため
 * ponytail: 川の変わり目（合流点）の前後100m ほどでは、測定点の川の名前がどちらにも取れるので、拾い落とすことがある
 */
export function stationsNearPath(
  { pts, rivers = [] }: PathLike,
  rows: WaterRow[],
  maxM = 250,
): WaterOnPath[] {
  const { step } = nearestOnPath(pts, maxM);
  const riverAt = (s: number) => rivers.findLast((r) => r.step <= s)?.name;
  return rows
    .map(([x, y, bod, name, year, river, past]) => ({
      step: step(x, y),
      name,
      bod,
      year,
      river,
      ...waterGrade(bod),
      history: [
        ...WATER_PAST_YEARS.flatMap((y, i) =>
          past[i] == null ? [] : [{ year: y, bod: past[i] }],
        ),
        { year, bod },
      ],
    }))
    .filter((w) => w.step >= 0 && (!w.river || w.river === riverAt(w.step)))
    .sort((a, b) => a.step - b.step)
    .map(({ river: _, ...w }) => w);
}

/** 同じ段階が続いても、前に出した点からこれだけ進んだらまた出す m。長い川で、きれいなままなのが分かるように */
const REPEAT_M = 50_000;

/**
 * 段階が変わったとみなすには、BOD が境目の値をこの割合より越える必要がある。
 * 境目のすぐ近くを行き来する値（利根川上流の 1.0〜1.1 など）で、言葉が入れ替わり続けないように
 */
const MARGIN = 0.2;

/** 前に出した段階 from から、bod ははっきり別の段階に変わったか（境目の MARGIN 以内なら変わっていない） */
const changed = (from: number, bod: number) =>
  waterGrade(bod / (1 + MARGIN)).level > from ||
  waterGrade(bod * (1 + MARGIN)).level < from;

/**
 * stationsNearPath の測定点のうち、時系列に出すものだけ返す。
 * 大きな川は測定点が多く、全部出すと時系列が埋まるので、最初の点と、次のどれかに当たる点だけにする:
 * きれいさの段階がはっきり変わった（MARGIN）・流路の川（rivers）が変わった・前に出した点から REPEAT_M 以上進んだ（dist は各点までの流路長 m）
 */
export function waterNearPath(
  path: PathLike,
  rows: WaterRow[],
  maxM = 250,
): WaterOnPath[] {
  const { dist, rivers = [] } = path;
  const riverAt = (s: number) => rivers.findLast((r) => r.step <= s)?.name;
  const near = stationsNearPath(path, rows, maxM);
  const shown: WaterOnPath[] = [];
  for (const w of near) {
    const last = shown.at(-1);
    if (
      !last ||
      changed(last.level, w.bod) ||
      riverAt(w.step) !== riverAt(last.step) ||
      (dist && dist[w.step] - dist[last.step] >= REPEAT_M)
    )
      shown.push(w);
  }
  return shown;
}

/** 流域サマリで推移を見せる測定点を探す、クリック地点からの距離 m。これより下流は「この地点の水」とは言いにくい */
const NEAREST_MAX_M = 20_000;

/**
 * 流域サマリに出す測定点。stations（流路の順）のうち、クリック地点から NEAREST_MAX_M 以内で推移のある最初の点。
 * 推移のある点がなければ、推移のない最初の点。どれもなければ null（dist は各点までの流路長 m）
 */
export function nearestStation(
  stations: WaterOnPath[],
  dist: number[],
): WaterOnPath | null {
  const near = stations.filter((w) => dist[w.step] <= NEAREST_MAX_M);
  return near.find((w) => w.history.length >= 2) ?? near[0] ?? null;
}

export interface WaterTrend {
  from: { year: number; bod: number; label: string };
  to: { year: number; bod: number; label: string };
  change: "よくなった" | "わるくなった" | "ほぼ同じ";
}

/**
 * 推移のいちばん古い年度と最新の年度を比べる。きれいさの点数（10段）が2以上動いたら、よく・わるくなったとする。
 * 比べる年度が1つしかなければ null
 */
export function waterTrend(
  history: { year: number; bod: number }[],
): WaterTrend | null {
  if (history.length < 2) return null;
  const a = history[0];
  const b = history[history.length - 1];
  const diff = waterScore(b.bod) - waterScore(a.bod);
  return {
    from: { ...a, label: waterGrade(a.bod).label },
    to: { ...b, label: waterGrade(b.bod).label },
    change: diff >= 2 ? "よくなった" : diff <= -2 ? "わるくなった" : "ほぼ同じ",
  };
}

/**
 * 推移の一言。text は「1994年度より よくなった」、values は「BOD 9.3 → 3.4」。
 * 狭い欄で値の途中で折り返さないよう、分けて返す。比べる年度がなければ undefined
 */
export function trendNote(history: WaterOnPath["history"]) {
  const t = waterTrend(history);
  if (!t) return undefined;
  const how = t.change === "ほぼ同じ" ? "と ほぼ同じ" : `より ${t.change}`;
  return {
    text: `${t.from.year}年度${how}`,
    values: `BOD ${t.from.bod} → ${t.to.bod}`,
  };
}

/** BOD 年平均 mg/L → 水のきれいさの段階と言葉 */
export function waterGrade(bod: number): { level: number; label: string } {
  const level = GRADES.findIndex(([max]) => bod <= max);
  return level < 0
    ? { level: GRADES.length, label: "よごれが目立つ" }
    : { level, label: GRADES[level][1] };
}

// ---- 配信場所: /water/latest.json が今の版を指す（地名の /munis/ と同じ形） ----
let index: Promise<{ url: string; has: Set<number> }> | null = null;
const files = new Map<number, Promise<WaterRow[]>>();

function waterIndex() {
  index ??= fetch(`${SOURCES.water}/latest.json`)
    .then((r) =>
      r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
    )
    .then(async ({ version }: { version: string }) => {
      const url = `${SOURCES.water}/${version}`;
      const i: WaterIndex = await fetch(`${url}/index.json`).then((r) =>
        r.json(),
      );
      return { url, has: new Set(i.meshes) };
    })
    .catch(() => {
      index = null; // 読めなかったときは覚えずに、次の呼び出しでまた取りに行く
      return { url: "", has: new Set<number>() };
    });
  return index;
}

/** 1次メッシュ1つ分の測定点。ないメッシュ（海・測定点のない山地など）は空 */
function waterFile(m1: number): Promise<WaterRow[]> {
  let file = files.get(m1);
  if (!file) {
    file = waterIndex().then(async ({ url, has }) => {
      if (!has.has(m1)) return [];
      const res = await fetch(`${url}/${m1}.json`);
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    });
    file.catch(() => files.delete(m1)); // 失敗は覚えずに、次の呼び出しでまた取りに行く
    files.set(m1, file);
  }
  return file;
}

/** 道のり沿いの測定点を、間引かずに全部（流域サマリ用）。道のりが通る1次メッシュのファイルだけを読む */
export async function stationsAlong(
  path: Parameters<typeof stationsNearPath>[0],
): Promise<WaterOnPath[]> {
  const m1s = [...new Set(path.pts.map(([x, y]) => meshOf(x, y).m1))];
  const rows = await Promise.all(m1s.map(waterFile));
  return stationsNearPath(path, rows.flat());
}

/** 道のり沿いの水のきれいさ。道のりが通る1次メッシュのファイルだけを読む */
export async function waterAlong(
  path: Parameters<typeof waterNearPath>[0],
): Promise<WaterOnPath[]> {
  const m1s = [...new Set(path.pts.map(([x, y]) => meshOf(x, y).m1))];
  const rows = await Promise.all(m1s.map(waterFile));
  return waterNearPath(path, rows.flat());
}
