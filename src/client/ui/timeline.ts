import type { DamOnPath } from "../data/karte-stats";
import { type Place, type PlaceEvent, placeName } from "../data/places";
import { WATER_SCORE_MAX, type WaterOnPath, waterScore } from "../data/water";
import type { Path } from "../terrain/trace";
import { el } from "./dom";
import { distance, eta, km } from "./format";
import type { SurveyDot } from "./survey-dots";

/**
 * 市民の調査地点を、その手前の環境省の測定点（anchors は流路の位置）ごとに1つの帯にまとめる。
 * 最初の測定点より上流の地点は、最初の地点の位置にまとめる。雨粒がまだ着いていない地点（k より先）は入れない
 */
/** この数までの帯は、点にせず中身を並べる。少ないのに1つずつ押して読むのは手間なので */
const LIST_MAX = 3;

export function citizenBands(
  dots: SurveyDot[],
  anchors: number[],
  k: number,
): TimelineEvent[] {
  const groups = new Map<number, SurveyDot[]>();
  const reached = dots.filter((d) => d.step <= k);
  for (const d of reached) {
    const at = anchors.findLast((a) => a <= d.step) ?? reached[0].step;
    groups.set(at, [...(groups.get(at) ?? []), d]);
  }
  return [...groups].map(([step, group]) => {
    const listed = group.length <= LIST_MAX;
    return {
      id: `c${step}`,
      step,
      kind: "band" as const,
      title: `市民の調査 ${group.length}地点`,
      sub: listed ? "" : "点を押すと場所と結果",
      dots: group,
      listed,
    };
  });
}

export interface TimelineEvent {
  id: string;
  /** 流路上の位置（Path.pts の添字）。この順に並べる */
  step: number;
  kind: "place" | "river" | "branch" | "dam" | "water" | "band" | "end";
  title: string;
  sub: string;
  /** 市民の調査地点を色の点で並べる帯の点 */
  dots?: SurveyDot[];
  /** 帯の点を、色の点だけでなく中身の1行ずつで並べる（地点が少ないとき） */
  listed?: boolean;
  /** 水のきれいさの点数（1〜WATER_SCORE_MAX）。あればメーターにして出す */
  score?: number;
}

export interface Mouth {
  /** 流れ込んだ海（太平洋・日本海・瀬戸内海・東シナ海・オホーツク海） */
  sea: string | null;
  /** 「利根川河口（千葉県銚子市 川口町一丁目）」 */
  name: string | null;
}

/**
 * 河口の呼び名。「利根川河口（千葉県銚子市 川口町一丁目）」、川がなければ「千葉県銚子市 川口町一丁目の海岸」。
 * 市区町村 at がまだ分からなければ、分かっている部分だけ。
 * 川が市区町村の境で、向こう岸 across があれば「利根川河口（茨城県神栖市・千葉県銚子市）」と並べる
 */
export function mouthName(
  river: string | undefined,
  at: Pick<Place, "pref" | "muni" | "aza"> | null,
  across: Pick<Place, "pref" | "muni">[] = [],
): string | null {
  const where = !at
    ? ""
    : across.length
      ? [at, ...across]
          .map((p, i, all) =>
            i && p.pref === all[i - 1].pref ? p.muni : `${p.pref}${p.muni}`,
          )
          .join("・")
      : placeName(at);
  if (river) return `${river}河口${where ? `（${where}）` : ""}`;
  return where ? `${where}の海岸` : null;
}

/** 雨粒が k まで進んだ時点で出せる時系列の項目。mouth が undefined なら河口はまだ調べ中 */
export function timelineEvents(
  path: Path,
  places: PlaceEvent[],
  origin: Place | null,
  mouth: Mouth | null | undefined,
  k: number,
  dams: DamOnPath[] = [],
  water: WaterOnPath[] = [],
): TimelineEvent[] {
  const n = path.pts.length;
  const at = (step: number) => distance(path.dist[step]);
  const lastRiver = path.rivers.at(-1)?.name;
  const events: TimelineEvent[] = [
    ...path.rivers.map((r, i) => {
      const first = i === 0;
      return {
        id: `r${i}`,
        step: r.step,
        kind: "river" as const,
        title: first
          ? r.step === 0
            ? `${r.name}をくだりはじめる`
            : `${r.name}に出る`
          : `${r.name}に合流`,
        sub: first
          ? at(r.step)
          : `${path.rivers[i - 1].name} → ${r.name}・${at(r.step)}`,
      };
    }),
    ...alongEvents(path.rivers, at, dams, places, origin, water),
  ];
  // 最後の項目は河口の海と地名が分かってから出す
  if (k >= n - 1 && mouth !== undefined)
    events.push({
      id: "end",
      step: n - 1,
      kind: "end",
      title: path.toSea
        ? `${mouth?.sea ?? "海"}へ`
        : "この先は追いきれませんでした",
      sub: path.toSea
        ? [mouth?.name, at(n - 1)].filter(Boolean).join("・")
        : `${lastRiver ? `${lastRiver}をくだって海へ・` : ""}${at(n - 1)}`,
    });
  return events;
}

/** クリック地点から上流の水源へさかのぼる道のり。pts[0] がクリック地点、dist はそこからの流路長 m */
export interface SourcePath extends Pick<Path, "pts" | "dist" | "rivers"> {
  /** 本筋に流れ込む名前のある支流。step は pts の添字 */
  tributaries: { name: string; step: number }[];
  /** 水源の標高 m */
  elev: number;
  /** 計算範囲の端で切れている（本当の水源ではない） */
  cut: boolean;
}

/** さかのぼる時系列。距離は上流側へ、時間はその水が何分・何時間前に降ったか */
export function sourceEvents(
  src: SourcePath,
  places: PlaceEvent[],
  origin: Place | null,
  /** 水源の市区町村（届く前は undefined、分からなければ null。分かれば見出しにする） */
  sourcePlace?: Place | null,
  dams: DamOnPath[] = [],
  water: WaterOnPath[] = [],
): TimelineEvent[] {
  const n = src.pts.length;
  const at = (step: number) => {
    const m = src.dist[step];
    return m > 0 ? `${km(m)}上流・${eta(m)}前` : "ここから";
  };
  const where = sourcePlace && placeName(sourcePlace);
  return [
    ...src.rivers.map((r, i) => ({
      id: `r${i}`,
      step: r.step,
      kind: "river" as const,
      title: `${r.name}をさかのぼる`,
      sub: i
        ? `${src.rivers[i - 1].name} → ${r.name}・${at(r.step)}`
        : at(r.step),
    })),
    ...src.tributaries.map((t) => ({
      id: `t${t.step}${t.name}`,
      step: t.step,
      kind: "branch" as const,
      title: `${t.name}が流れ込む`,
      sub: withRiver(src.rivers, at, t.step),
    })),
    ...alongEvents(src.rivers, at, dams, places, origin, water),
    {
      id: "end",
      step: n - 1,
      kind: "end",
      title: src.cut
        ? "この先は追いきれませんでした"
        : `水源${where ? `（${where}）` : ""}`,
      sub: src.cut
        ? at(n - 1)
        : `標高 ${Math.round(src.elev).toLocaleString()} m・${at(n - 1)}`,
    },
  ];
}

/** その位置の川の名前を添えた距離（「利根川沿い・3.2 km」）。川の上でなければ距離だけ */
function withRiver(
  rivers: Path["rivers"],
  at: (step: number) => string,
  step: number,
  suffix = "",
) {
  const river = rivers.findLast((r) => r.step <= step)?.name;
  return river ? `${river}${suffix}・${at(step)}` : at(step);
}

/**
 * 道のり沿いのダム・水のきれいさ・市区町村（出発点の市区町村は除く）。雨の通り道・水の来た道で共通。
 * 添え書きはその位置の川の名前と、at で書いた距離
 */
function alongEvents(
  rivers: Path["rivers"],
  at: (step: number) => string,
  dams: DamOnPath[],
  places: PlaceEvent[],
  origin: Place | null,
  water: WaterOnPath[],
): TimelineEvent[] {
  return [
    ...water.map((w) => ({
      id: `w${w.step}${w.name}`,
      step: w.step,
      kind: "water" as const,
      title: `水のきれいさ：${w.label}`,
      score: waterScore(w.bod),
      sub: `${w.name}で測定・BOD ${w.bod}（${w.year}年度の平均）・${at(w.step)}`,
    })),
    ...dams.map((d) => ({
      id: `d${d.step}${d.name}`,
      step: d.step,
      kind: "dam" as const,
      title: `${d.name || "ダム"}を通る`,
      sub: withRiver(rivers, at, d.step),
    })),
    ...places
      .filter((p) => p.key !== origin?.key)
      .map((p) => ({
        id: `p${p.key}`,
        step: p.step,
        kind: "place" as const,
        title: placeName(p),
        sub: withRiver(rivers, at, p.step, "沿い"),
      })),
  ];
}

/** 雨粒の到達に合わせて伸びていく時系列 */
export class Timeline {
  private shown = new Map<string, HTMLLIElement>();

  constructor(private readonly list: HTMLOListElement) {}

  clear() {
    this.shown.clear();
    this.list.replaceChildren();
  }

  /**
   * まだ出していない項目を step 順の位置に差し込み、追加した項目を返す。
   * 出してある項目は作り直さず文言だけ更新する（作り直すと表示アニメーションが再生されてちらつく。
   * 河口の地名のように、後から分かって書き足すものがある）
   */
  add(events: TimelineEvent[]): TimelineEvent[] {
    const added: TimelineEvent[] = [];
    for (const ev of events) {
      const li = this.shown.get(ev.id);
      if (li) setText(li, ev);
      else added.push(ev);
    }
    added.sort((a, b) => a.step - b.step || rank(a) - rank(b));
    for (const ev of added) {
      const li = item(ev);
      this.shown.set(ev.id, li);
      const before = [...this.list.children].find(
        (e) => Number((e as HTMLElement).dataset.step) > ev.step,
      );
      this.list.insertBefore(li, before ?? null);
      // 末尾に伸びたときだけ追いかける（遅れて届いた途中の地名で、読んでいる位置を動かさない）
      if (!before) li.scrollIntoView({ block: "nearest" });
    }
    return added;
  }
}

// 同じ地点なら「川に合流」→ ダム → 水のきれいさ → 市民の調査の帯 → 地名の順に
const RANK: TimelineEvent["kind"][] = ["river", "dam", "water", "band"];
const rank = (ev: TimelineEvent) =>
  RANK.includes(ev.kind) ? RANK.indexOf(ev.kind) : RANK.length;

function item(ev: TimelineEvent) {
  const li = el(
    "li",
    { className: `timeline__item timeline__item--${ev.kind}` },
    el("b", { className: "timeline__title", textContent: ev.title }),
    ...(ev.score ? [meter(ev.score)] : []),
    ...(ev.dots ? [bandBody(ev.dots, ev.listed)] : []),
    el("small", { className: "timeline__sub", textContent: ev.sub }),
  );
  li.dataset.step = String(ev.step);
  return li;
}

/**
 * 市民の調査の点の帯。点を押すと、帯の下の添え書きをその地点の中身にし、"survey-dot"（detail はその点）を投げる。
 * 地図の同じ点を目立たせるのに使う
 */
function bandBody(dots: SurveyDot[], listed = false) {
  if (!listed) return dotRow(dots);
  return el(
    "ul",
    { className: "survey-list" },
    ...dots.map((d) => {
      const dot = el("span", { className: "survey-dot", ariaHidden: "true" });
      dot.dataset.tone = String(d.tone);
      return el("li", { title: d.text }, dot, d.short ?? d.text);
    }),
  );
}

function dotRow(dots: SurveyDot[]) {
  const row = el("span", { className: "survey-dots" });
  for (const d of dots) {
    const b = el("button", {
      type: "button",
      className: "survey-dot",
      ariaLabel: d.text,
      title: d.text,
    });
    b.dataset.tone = String(d.tone);
    b.addEventListener("click", () => {
      const sub = b.closest("li")?.querySelector(".timeline__sub");
      if (sub) sub.textContent = d.text;
      for (const o of row.children) o.classList.toggle("is-on", o === b);
      b.dispatchEvent(
        new CustomEvent("survey-dot", { bubbles: true, detail: d }),
      );
    });
    row.append(b);
  }
  return row;
}

/** 小さなメーター。塗った数が点数（スクリーンリーダーには「10段階の7」のように読ませる） */
function meter(score: number) {
  return el(
    "span",
    {
      className: "meter",
      role: "img",
      ariaLabel: `${WATER_SCORE_MAX}段階の${score}`,
    },
    ...Array.from({ length: WATER_SCORE_MAX }, (_, i) =>
      el("i", { className: i < score ? "meter__on" : "" }),
    ),
  );
}

function setText(li: HTMLLIElement, ev: TimelineEvent) {
  const title = li.children[0];
  const sub = li.querySelector(".timeline__sub") as Element;
  if (title.textContent !== ev.title) title.textContent = ev.title;
  if (ev.dots) {
    // 雨粒が進むと帯の点が増える。増えたときだけ作り直し、点を押して出した中身はそのまま残す
    const body = li.querySelector(".survey-dots, .survey-list") as Element;
    if (body.children.length !== ev.dots.length) {
      body.replaceWith(bandBody(ev.dots, ev.listed));
      sub.textContent = ev.sub;
    }
    return;
  }
  if (sub.textContent !== ev.sub) sub.textContent = ev.sub;
}
