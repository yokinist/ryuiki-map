// 流域サマリの画面。雨の流れをたどった地点について、海までと上流を1枚にまとめる
import { type Karte, karteAt, landAlong, precipitation } from "../data/karte";
import { CENSUS_YEARS, LAND } from "../data/karte-format";
import { type Place, placeName } from "../data/places";
import {
  nearestStation,
  stationsAlong,
  trendNote,
  WATER_SCORE_MAX,
  type WaterOnPath,
  waterScore,
} from "../data/water";
import type { LngLat } from "../geo";
import { tokenMs } from "../map/theme";
import type { Grid } from "../terrain/grid";
import { $, el, helpButtonAndText } from "./dom";
import {
  areaDome,
  areaSize,
  change,
  km,
  people,
  volumeDome,
  volumeSize,
} from "./format";

/** 雨の通り道のうち、この地点から先（下流）の長さ */
export interface Downstream {
  /** m */
  m: number;
  /** 海まで追えたか（追えなければ計算範囲の端まで） */
  toSea: boolean;
}

interface Entry {
  outlet: LngLat;
  title: string;
  place: string;
  down: Downstream;
  /** 計算中は undefined、計算できなければ null */
  karte?: Karte | null;
  /** 通り道の土地。計算中は undefined */
  along?: number[] | null;
  /** 年間降水量 mm。問い合わせ中は undefined、取れなければ null */
  rain?: number | null;
  /** すぐ下流の水質の測定点と、そこまでの流路長 m。読み込み中は undefined、近くになければ null */
  water?: { station: WaterOnPath; m: number } | null;
}

let entry: Entry | null = null;
const dialog = () => $<HTMLDialogElement>("karte");

const sameOutlet = (a: LngLat, b: LngLat) =>
  Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

/** サマリの画面を用意する（閉じるボタン・背景・Esc） */
export function setupKarte() {
  const d = dialog();
  $("karte-close").addEventListener("click", closeKarte);
  d.addEventListener("click", (e) => {
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    const inside =
      e.clientX >= r.left &&
      e.clientX <= r.right &&
      e.clientY >= r.top &&
      e.clientY <= r.bottom;
    if (!inside) closeKarte();
  });
  d.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeKarte();
  });
}

function closeKarte() {
  const d = dialog();
  if (!d.open || d.dataset.closing !== undefined) return;
  d.dataset.closing = "";
  const done = () => {
    clearTimeout(timer);
    d.removeEventListener("animationend", onEnd);
    delete d.dataset.closing;
    d.close();
  };
  const onEnd = (e: AnimationEvent) => {
    if (e.target === d) done();
  };
  d.addEventListener("animationend", onEnd);
  const timer = setTimeout(done, tokenMs("--duration-base") + 100);
}

/**
 * outlet より上流のサマリを開く。river はその地点を流れる川の名前（あれば見出しにする）
 */
export async function openKarte(
  from: { g: Grid; s: number },
  river: string | undefined,
  place: Promise<Place | null>,
  down: Downstream,
  path: {
    pts: LngLat[];
    dist: number[];
    rivers: { name: string; step: number }[];
  },
) {
  const outlet = from.g.lngLat(from.s);
  if (entry && sameOutlet(entry.outlet, outlet)) {
    render();
    if (!dialog().open) dialog().showModal();
    return;
  }

  entry = {
    outlet,
    title: river ?? "この地点",
    place: "",
    down,
    karte: undefined,
    along: undefined,
    rain: undefined,
    water: undefined,
  };
  const e = entry;

  stationsAlong(path)
    .then((list) => nearestStation(list, path.dist))
    .catch(() => null)
    .then((station) => {
      if (!entry || entry !== e) return;
      e.water = station && { station, m: path.dist[station.step] };
      render();
    });

  place.then((p) => {
    if (!entry || entry !== e || !p) return;
    e.place = placeName(p);
    if (!river) e.title = p.aza || p.muni;
    render();
  });

  // 数値は全部そろってから一度に出す（途中は全行を読み込み中の帯にする）
  Promise.all([karteAt(from), landAlong(path.pts)]).then(async ([k, along]) => {
    if (!entry || entry !== e) return;
    e.karte = k;
    e.along = along;
    e.rain = k ? await precipitation(k.center) : null;
    if (!entry || entry !== e) return;
    render();
  });

  if (!dialog().open) dialog().showModal();
  render();
}

function render() {
  const body = $("karte-body");
  body.replaceChildren(...(entry ? [card(entry)] : []));
}

const row = (label: string, ...value: (Node | string)[]) =>
  el(
    "section",
    { className: "karte-row" },
    el("h4", { className: "karte-row__label", textContent: label }),
    el("div", { className: "karte-row__value" }, ...value),
  );

function helpRow(label: string, help: string, ...value: (Node | string)[]) {
  const [btn, text] = helpButtonAndText(label, help);
  return el(
    "section",
    { className: "karte-row" },
    el("h4", { className: "karte-row__label" }, label, btn),
    el("div", { className: "karte-row__value" }, ...value, text),
  );
}

const POPULATION_HELP =
  "国勢調査の1kmメッシュ（約1km四方）ごとの人口を、そのメッシュのうち範囲に入る面積の割合で分けて足し合わせた推計です。メッシュの中では均等に住んでいると仮定しているので、範囲が小さいほど実際とずれます。1km²より小さい範囲では推計しません。";
const AREA_HELP =
  "この地点より上流で、降った雨がここへ流れ込む森や斜面の広さです。標高タイル（約10〜240mメッシュ）から計算した流れの向きをもとに数えています。";
const LENGTH_HELP =
  "この地点から河口まで、雨の通り道に沿った距離です。標高から計算した目安です。";
const LAND_PATH_HELP =
  "この地点から河口まで、雨の通り道が通る1kmメッシュごとの土地の使われ方（ESA WorldCover）を、通過距離の長さで加重平均した目安です。";

const WATER_HELP =
  "環境省の公共用水域水質測定結果のうち、水のよごれの目安（BOD、小さいほどきれい）の年平均です。言葉は河川の環境基準の類型に合わせ、メーターと図は BOD を10段に分けたものです（上・多いほどきれい）。この地点から下流へ20km 以内で、いちばん近い測定点の値です。国が基準を満たしたかの判定は年平均ではなく75%値を使うので、ここでの言葉は国の判定より甘めになることがあります。";

function waterRow(e: Entry) {
  if (e.water === undefined) return loadingRow("水のきれいさ");
  if (e.water === null)
    return row("水のきれいさ", sub("下流20km 以内に測定点がありません"));
  const { station: w, m } = e.water;
  const where = m < 100 ? "すぐそば" : `${km(m)}下流`;
  const note = trendNote(w.history);
  return helpRow(
    "水のきれいさ",
    WATER_HELP,
    big(w.label),
    sub(`${where}の${w.name}で測定・BOD ${w.bod}（${w.year}年度の平均）`),
    ...(note
      ? [trendChart(w.history), sub(`${note.text}（${note.values}）`)]
      : []),
  );
}

/**
 * BOD の推移の折れ線。横は年度、縦はきれいさ（メーターと同じ10段。上ほどきれい）。
 * 値は最初と最新の点だけに添え、ほかは点にカーソルを当てると出る
 */
function trendChart(history: WaterOnPath["history"]) {
  const W = 280;
  const H = 112;
  const pad = { l: 40, r: 16, t: 18, b: 20 };
  const y0 = history[0].year;
  const span = history[history.length - 1].year - y0 || 1;
  const x = (year: number) =>
    pad.l + ((year - y0) / span) * (W - pad.l - pad.r);
  const y = (bod: number) =>
    pad.t +
    (1 - (waterScore(bod) - 1) / (WATER_SCORE_MAX - 1)) * (H - pad.t - pad.b);
  const NS = "http://www.w3.org/2000/svg";
  const make = (
    tag: string,
    attrs: Record<string, string | number>,
    text?: string,
  ) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (text) node.textContent = text;
    return node;
  };
  const svg = make("svg", {
    viewBox: `0 0 ${W} ${H}`,
    class: "trend-chart",
    role: "img",
    "aria-label": `BOD の推移: ${history.map((h) => `${h.year}年度 ${h.bod}`).join("、")}`,
  });
  // 縦の向きを言葉で示す（上がきれい）。目盛りの数字は10段の番号で意味が薄いので出さない
  const top = y(0);
  const bottom = pad.t + (H - pad.t - pad.b);
  svg.append(
    make("line", {
      x1: pad.l,
      x2: W - pad.r,
      y1: top,
      y2: top,
      class: "trend-chart__grid",
    }),
    make("line", {
      x1: pad.l,
      x2: W - pad.r,
      y1: bottom,
      y2: bottom,
      class: "trend-chart__grid",
    }),
    make("text", { x: 0, y: top + 4, class: "trend-chart__axis" }, "きれい"),
    make("text", { x: 0, y: bottom + 4, class: "trend-chart__axis" }, "よごれ"),
    make("polyline", {
      points: history.map((h) => `${x(h.year)},${y(h.bod)}`).join(" "),
      class: "trend-chart__line",
    }),
  );
  history.forEach((h, i) => {
    const dot = make("circle", {
      cx: x(h.year),
      cy: y(h.bod),
      r: 4,
      class: "trend-chart__dot",
    });
    dot.append(make("title", {}, `${h.year}年度 BOD ${h.bod}`));
    svg.append(
      dot,
      make(
        "text",
        { x: x(h.year), y: H - 4, class: "trend-chart__year" },
        String(h.year),
      ),
    );
    if (i === 0 || i === history.length - 1)
      svg.append(
        make(
          "text",
          { x: x(h.year), y: y(h.bod) - 8, class: "trend-chart__value" },
          String(h.bod),
        ),
      );
  });
  return svg;
}

const big = (text: string) =>
  el("b", { className: "karte-big", textContent: text });
const sub = (text: string) =>
  el("span", { className: "karte-sub", textContent: text });

const group = (title: string, ...rows: Node[]) =>
  el(
    "section",
    { className: "karte-group" },
    el("h3", { className: "karte-group__title", textContent: title }),
    ...rows,
  );

// 読み込み中は値の位置に薄い帯を出す。読み上げ向けにはカード見出しの「読み込んでいます」で伝える
const loadingRow = (label: string) =>
  row(label, el("span", { className: "karte-skel", ariaHidden: "true" }));

function mouthLengthRow(e: Entry) {
  return helpRow(
    "河口までの長さ",
    LENGTH_HELP,
    big(`約${km(e.down.m)}`),
    ...(e.down.toSea ? [] : [sub("河口まで追いきれず、途中までの距離です")]),
  );
}

function pathLandRow(e: Entry) {
  if (e.along === undefined) return loadingRow("通り道の土地");
  if (!e.along) return row("通り道の土地", sub("データの範囲外です"));
  return landRow("通り道の土地", e.along, LAND_PATH_HELP);
}

function upstreamRows(e: Entry): Node[] {
  const k = e.karte;
  if (k === undefined)
    return [
      loadingRow("集水域"),
      loadingRow("標高"),
      loadingRow("人口"),
      loadingRow("年間降水量"),
      loadingRow("ダム・堰"),
      loadingRow("川"),
    ];
  if (k === null)
    return [
      row("集水域", sub("—")),
      row("標高", sub("—")),
      row("人口", sub("—")),
      row("年間降水量", sub("—")),
      row("ダム・堰", sub("—")),
      row("川", sub("—")),
    ];

  const m = k.meshes;
  const pop = m?.population;
  const now = pop?.[pop.length - 1] ?? 0;
  const years = CENSUS_YEARS;
  const rivers = k.rivers.slice(0, 5).join("・");
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return [
    helpRow(
      "集水域",
      AREA_HELP,
      big(areaSize(k.areaKm2)),
      ...(m && m.coverage > 0.5
        ? [sub(`${areaDome(k.areaKm2)}・森林${pct(m.land[0])}`)]
        : []),
      sub(`いちばん遠い水源から 約${km(k.lengthKm * 1000)}`),
      ...(k.truncated
        ? [sub("途中で切れています。実際はもっと広い範囲です")]
        : []),
    ),
    row(
      "標高",
      big(
        `${Math.round(k.elev.min).toLocaleString()}〜${Math.round(k.elev.max).toLocaleString()} m`,
      ),
      sub(`平均 ${Math.round(k.elev.mean).toLocaleString()} m`),
    ),
    !pop || !m || m.coverage <= 0.5
      ? row("人口", sub("データの範囲外です"))
      : k.areaKm2 < 1
        ? helpRow(
            "人口",
            POPULATION_HELP,
            sub("範囲が1km²より小さいので推計しません"),
          )
        : pop.some(Boolean)
          ? helpRow(
              "人口",
              POPULATION_HELP,
              big(now < 10_000 ? `約${people(now)}` : people(now)),
              sub(
                `${years[0]}年から ${change(pop[0], now)}（${people(pop[0])}→${people(now)}）`,
              ),
            )
          : helpRow(
              "人口",
              POPULATION_HELP,
              big("0人"),
              sub(
                `${years[0]}〜${years[years.length - 1]}年とも、住んでいる人はいません`,
              ),
            ),
    e.rain === undefined
      ? loadingRow("年間降水量")
      : e.rain === null
        ? row("年間降水量", sub("取得できませんでした"))
        : row(
            "年間降水量",
            big(`約${Math.round(e.rain).toLocaleString()} mm`),
            sub(`1年で${volumeSize(e.rain * k.areaKm2 * 1000)}`),
            sub(volumeDome(e.rain * k.areaKm2 * 1000)),
          ),
    row(
      "ダム・堰",
      big(`ダム ${k.dams.damCount}・堰 ${k.dams.weirCount}`),
      ...(k.dams.dams.length ? [sub(k.dams.dams.slice(0, 4).join("・"))] : []),
    ),
    row(
      "川",
      rivers
        ? sub(
            k.rivers.length > 5
              ? `${rivers} ほか${k.rivers.length - 5}`
              : rivers,
          )
        : sub("名前のある川はありません"),
    ),
  ];
}

function card(e: Entry) {
  const header = el(
    "header",
    { className: "karte-card__header" },
    el("h3", { className: "karte-card__title", textContent: e.title }),
    ...(e.place
      ? [el("p", { className: "karte-card__place", textContent: e.place })]
      : []),
    ...(e.karte === undefined
      ? [
          el("p", {
            className: "karte-card__busy",
            textContent: "集水域と通り道の土地を読み込み中…",
          }),
        ]
      : []),
  );

  return el(
    "article",
    { className: "karte-card" },
    header,
    group(
      "海まで",
      e.karte === undefined ? loadingRow("河口までの長さ") : mouthLengthRow(e),
      pathLandRow(e),
    ),
    group("この地点の水", waterRow(e)),
    group("この地点より上流", ...upstreamRows(e)),
  );
}

function landRow(label: string, land: number[], help: string) {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const shown = LAND.map((name, i) => ({ name, i, v: land[i] })).filter(
    (x) => x.v >= 0.005,
  );
  const bar = el(
    "div",
    { className: "land-bar", ariaHidden: "true" },
    ...shown.map(({ i, v }) => {
      const seg = el("span", { className: `land land--${i}` });
      seg.style.flexBasis = `${v * 100}%`;
      return seg;
    }),
  );
  const legend = el(
    "ul",
    { className: "land-legend", ariaLabel: "土地の使われ方の内訳" },
    ...shown.map(({ name, i, v }) =>
      el(
        "li",
        {},
        el("span", { className: `land land--${i}`, ariaHidden: "true" }),
        `${name} ${pct(v)}`,
      ),
    ),
  );
  return helpRow(label, help, bar, legend);
}
