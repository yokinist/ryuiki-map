// 流域サマリの画面。雨の流れをたどった地点について、海までと上流を1枚にまとめる
import { type Karte, karteAt, landAlong, precipitation } from "../data/karte";
import { CENSUS_YEARS, LAND } from "../data/karte-format";
import { type Place, placeName } from "../data/places";
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
  pts: LngLat[],
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
  };
  const e = entry;

  place.then((p) => {
    if (!entry || entry !== e || !p) return;
    e.place = placeName(p);
    if (!river) e.title = p.aza || p.muni;
    render();
  });

  // 数値は全部そろってから一度に出す（途中は全行を読み込み中の帯にする）
  Promise.all([karteAt(from), landAlong(pts)]).then(async ([k, along]) => {
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
  "この地点より上流で、降った雨がここへ流れ込む森や斜面の広さです。標高タイル（約10〜120mメッシュ）から計算した流れの向きをもとに数えています。";
const LENGTH_HELP =
  "この地点から河口まで、雨の通り道に沿った距離です。標高から計算した目安です。";
const LAND_PATH_HELP =
  "この地点から河口まで、雨の通り道が通る1kmメッシュごとの土地の使われ方（ESA WorldCover）を、通過距離の長さで加重平均した目安です。";

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
