import type { DamOnPath } from "../data/karte-stats";
import { type Place, type PlaceEvent, placeName } from "../data/places";
import {
  trendNote,
  WATER_SCORE_MAX,
  type WaterOnPath,
  waterScore,
} from "../data/water";
import type { Path } from "../terrain/trace";
import { el } from "./dom";
import { distance, eta, km } from "./format";
import type { SurveyDot } from "./survey-dots";

/**
 * 市民の調査地点を、その手前の環境省の測定点（anchors は流路の位置）ごとに1つの帯にまとめる。
 * 最初の測定点より上流の地点は、最初の地点の位置にまとめる。雨粒がまだ着いていない地点（k より先）は入れない
 */
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
  return [...groups].map(([step, group]) => ({
    id: `c${step}`,
    step,
    kind: "band" as const,
    title: `市民の調査 ${group.length}地点`,
    sub: "点を押すと場所と結果",
    dots: group,
  }));
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
  /** 水のきれいさの点数（1〜WATER_SCORE_MAX）。あればメーターにして出す */
  score?: number;
  /** 水のきれいさの推移の一言（「1994年度より よくなった」と「BOD 9.3 → 3.4」）。比べる年度がなければ undefined */
  note?: { text: string; values: string };
  /** 水のきれいさの推移。年度ごとの BOD（古い順）。小さな折れ線にする */
  history?: { year: number; bod: number }[];
}

export interface Mouth {
  /** 流れ込んだ海（太平洋・日本海・瀬戸内海・東シナ海・オホーツク海） */
  sea: string | null;
  /** 「利根川河口（千葉県銚子市 川口町一丁目）」 */
  name: string | null;
}

/**
 * 河口の呼び名。「利根川河口（千葉県銚子市 川口町一丁目）」、川がなければ「千葉県銚子市 川口町一丁目の海岸」。
 * 市区町村 at がまだ分からなければ、分かっている部分だけ
 */
export function mouthName(
  river: string | undefined,
  at: Pick<Place, "pref" | "muni" | "aza"> | null,
): string | null {
  const where = at ? placeName(at) : "";
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
      note: trendNote(w.history),
      history: w.history,
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
    ...(ev.dots ? [dotRow(ev.dots)] : []),
    el("small", { className: "timeline__sub", textContent: ev.sub }),
    ...(ev.note && ev.history
      ? [
          el(
            "small",
            { className: "timeline__trend" },
            sparkline(ev.history),
            el(
              "span",
              { className: "timeline__trend-text" },
              el("b", { textContent: ev.note.text }),
              el("span", {
                className: "timeline__trend-values",
                textContent: ev.note.values,
              }),
            ),
          ),
        ]
      : []),
  );
  li.dataset.step = String(ev.step);
  return li;
}

/**
 * 市民の調査の点の帯。点を押すと、帯の下の添え書きをその地点の中身にし、"survey-dot"（detail はその点）を投げる。
 * 地図の同じ点を目立たせるのに使う
 */
function dotRow(dots: SurveyDot[]) {
  const row = el("span", { className: "timeline__dots" });
  for (const d of dots) {
    const b = el("button", {
      type: "button",
      className: "timeline__dot",
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

/**
 * 推移の小さな折れ線。横は年度、縦はきれいさの点数（上ほどきれい。メーターと同じ向き）。
 * 値は横の一言で読めるので、図は読み上げない
 */
function sparkline(history: { year: number; bod: number }[]) {
  const W = 56;
  const H = 16;
  const y0 = history[0].year;
  const span = history[history.length - 1].year - y0 || 1;
  const xy = history.map(({ year, bod }) => [
    ((year - y0) / span) * (W - 4) + 2,
    H - 2 - ((waterScore(bod) - 1) / (WATER_SCORE_MAX - 1)) * (H - 4),
  ]);
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "sparkline");
  svg.setAttribute("aria-hidden", "true");
  const line = document.createElementNS(NS, "polyline");
  line.setAttribute("points", xy.map((p) => p.join(",")).join(" "));
  svg.append(line);
  // 両端に点を置き、いつからいつまでの線かを分かりやすくする（最新の側を塗り、古い側は輪にする）
  for (const [i, [cx, cy]] of [xy[0], xy[xy.length - 1]].entries()) {
    const dot = document.createElementNS(NS, "circle");
    dot.setAttribute("cx", String(cx));
    dot.setAttribute("cy", String(cy));
    dot.setAttribute("r", "2.5");
    dot.setAttribute("class", i ? "sparkline__now" : "sparkline__then");
    svg.append(dot);
  }
  return svg;
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
    // 雨粒が進むと帯の点が増える。点を押して出した中身はそのまま残す
    const row = li.querySelector(".timeline__dots") as Element;
    if (row.children.length !== ev.dots.length) {
      row.replaceWith(dotRow(ev.dots));
      title.textContent = ev.title;
    }
    return;
  }
  if (sub.textContent !== ev.sub) sub.textContent = ev.sub;
}
