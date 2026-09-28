import "maplibre-gl/dist/maplibre-gl.css";
import "./styles/tokens.css";
import "./styles/app.css";
import maplibregl from "maplibre-gl";
import {
  ATTRIBUTION,
  AUTO_COMPUTE_ZOOM,
  CLICK_GRID,
  CLICK_ZOOM,
  DEM_RIVER_KM2,
  JAPAN_BBOX,
  SHOW_RIVERS_ZOOM,
  SOURCES,
  START_BOUNDS,
} from "./config";
import { onRiversChange, showRivers } from "./data/rivers";
import { type BBox, covers, inBBox, type LngLat } from "./geo";
import { addHillProtocol, HILL_TILES } from "./map/hill";
import { addOverlays, paint, setData, setImage } from "./map/overlays";
import { pixel, token } from "./map/theme";
import {
  addWide,
  buildAround,
  buildGrid,
  type Grid,
  gridAround,
  gridAt,
  grids,
  loadWide,
} from "./terrain/grid";
import { gridSpec } from "./terrain/grid-spec";
import { snap } from "./terrain/hydro";
import { traceToSea } from "./terrain/trace";
import { freeCenter, paddingAround } from "./ui/camera";
import { $, helpButtonAndText } from "./ui/dom";
import { setupKarte } from "./ui/karte";
import { reducedMotion } from "./ui/motion";
import { Rain } from "./ui/rain";

// タッチ端末にはカーソルがなく、流れの先読みは出ないので案内しない
const STATUS_IDLE_IN = matchMedia("(hover: hover)").matches
  ? "拡大すると川が表示され、カーソルをのせるとそこからの流れが見えます。"
  : "拡大すると川が表示されます。";
const STATUS_IDLE_OUT = "日本に地図を移してからクリックしてください。";

/**
 * 共有URLの ?p=経度,緯度。開くとその地点の水の流れを再生する。
 * &dir=up が付いていれば、下る動きは見せずに水源へさかのぼる（水の来た道を見ていたときの共有）
 */
const params = new URLSearchParams(location.search);
const shared = ((): LngLat | null => {
  const v = params.get("p")?.split(",").map(Number);
  return v?.length === 2 && v.every(Number.isFinite) ? [v[0], v[1]] : null;
})();
const sharedUp = params.get("dir") === "up";

/** 共有用に URL の検索部分を書き換える（地図の位置は # に MapLibre が入れる） */
function setParam(key: string, value: string | null) {
  const url = new URL(location.href);
  if (value === null) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  history.replaceState(history.state, "", url);
}

addHillProtocol();
const map = new maplibregl.Map({
  container: "map",
  hash: true,
  // 地図まわりの読み上げラベル・ボタン名を日本語に
  locale: {
    "Map.Title": "地図",
    "Marker.Title": "地図上の印",
    "NavigationControl.ZoomIn": "拡大",
    "NavigationControl.ZoomOut": "縮小",
    "NavigationControl.ResetBearing": "北を上にする",
    "AttributionControl.ToggleAttribution": "出典の表示を切り替える",
    "ScaleControl.Meters": "m",
    "ScaleControl.Kilometers": "km",
  },
  ...(location.hash
    ? {}
    : shared
      ? { center: shared, zoom: 11.5 }
      : { bounds: START_BOUNDS }),
  // 日本の外へ離れすぎないよう、少し余白を付けてパンを制限する
  maxBounds: [
    [JAPAN_BBOX[0] - 4, JAPAN_BBOX[1] - 4],
    [JAPAN_BBOX[2] + 4, JAPAN_BBOX[3] + 4],
  ],
  style: {
    version: 8,
    glyphs: SOURCES.glyphs,
    sources: {
      // 地理院タイルは種類ごとに提供するズームが違い、範囲外は 404 になる（白地図 5〜14・淡色 2〜18・陰影 2〜16）
      land: {
        type: "raster",
        tiles: [SOURCES.blank],
        tileSize: 256,
        minzoom: 5,
        maxzoom: 14,
        attribution: ATTRIBUTION.gsi,
      },
      tint: {
        type: "raster",
        tiles: [SOURCES.pale],
        tileSize: 256,
        minzoom: 2,
        maxzoom: 18,
      },
      // 陰影は1枚が重い（淡色の2〜3倍）わりに薄く重ねるだけなので、寄ったときはズーム11のタイルを引き伸ばして使う
      hill: {
        type: "raster",
        tiles: [HILL_TILES],
        tileSize: 256,
        minzoom: 2,
        maxzoom: 11,
      },
    },
    layers: [
      // タイルの境目・海の外・高ズームの空白を、白より地図になじむ色で埋める
      {
        id: "bg",
        type: "background",
        paint: { "background-color": token("--color-map-bg") },
      },
      // 白地図 → 陰影 → 淡色地図（地名は淡色タイルに含まれるので、陰影の上に載せる）
      {
        id: "land",
        type: "raster",
        source: "land",
        // 引いたときは白地図を弱め、淡色地図の海・陸の色が出るようにする
        paint: {
          "raster-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            0.2,
            9,
            0.55,
            12,
            0.85,
            14,
            1,
          ],
        },
      },
      {
        id: "hill",
        type: "raster",
        source: "hill",
        paint: {
          "raster-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            0.42,
            12,
            0.24,
            14,
            0.16,
          ],
          "raster-contrast": [
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            0.26,
            14,
            0.18,
          ],
        },
      },
      {
        id: "tint",
        type: "raster",
        source: "tint",
        paint: {
          // 広域は彩度を残して海・陸・山を区別。中域から道路の色線を弱め、拡大で地名を濃く
          "raster-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            0.72,
            9,
            0.62,
            12,
            0.78,
            14,
            0.94,
          ],
          "raster-saturation": [
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            -0.05,
            9,
            -0.28,
            14,
            0.06,
          ],
          "raster-contrast": [
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            0.1,
            14,
            0.14,
          ],
        },
      },
    ],
  },
});
map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(new maplibregl.ScaleControl(), "bottom-left");

/** パネルの状態表示。「…」で終わる文言（読み込み中・計算中）はスピナー付きで出す */
const status = (text: string) => {
  const e = $("status");
  e.textContent = text;
  e.toggleAttribute("data-busy", text.endsWith("…"));
};
const share = $<HTMLButtonElement>("share");

// 合流のたびにどちらの支流をたどるかは、集水域の広さでなく水源までの長さで選んでいる。分かりにくいので「？」で補う
const [sourceHelpBtn, sourceHelpText] = helpButtonAndText(
  "たどり方",
  "合流する支流のうち、集水域が広い方ではなく、いちばん遠くの水源まで続く方を選んでさかのぼります（流域サマリの「水源からの長さ」と同じ道筋です）。",
);
$<HTMLDetailsElement>("source")
  .querySelector("summary")
  ?.append(sourceHelpBtn, sourceHelpText);

const rain = new Rain(
  map,
  {
    panel: $("panel"),
    result: $("result"),
    journey: $("journey"),
    origin: $("origin"),
    headline: $("headline"),
    progress: $("progress"),
    bar: $("bar"),
    announce: $("announce"),
    route: $<HTMLDetailsElement>("route"),
    timeline: $<HTMLOListElement>("timeline"),
    source: $<HTMLDetailsElement>("source"),
    sourceTimeline: $<HTMLOListElement>("source-timeline"),
    sourceNote: $("source-note"),
    summary: $("summary"),
    share,
    infoToggles: [
      $<HTMLDetailsElement>("about"),
      $<HTMLDetailsElement>("sources"),
    ],
  },
  status,
  // 共有用に、吸着後の地点と、見ている道のり（水の来た道なら dir=up）を URL に残す
  (p) => setParam("p", p.map((v) => v.toFixed(5)).join(",")),
  (kind) => setParam("dir", kind === "source" ? "up" : null),
);

const viewBBox = (): BBox => {
  const b = map.getBounds();
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
};

/** 表示範囲の川を描く。流向の計算とは別に、地図を動かすたびに表示範囲の河川タイルを読む */
function showViewRivers() {
  if (map.getZoom() >= SHOW_RIVERS_ZOOM) showRivers(viewBBox());
}

// ---- 計算グリッドの用意 ----
/** 最後に始めた計算。計算中に地図が動いたら、古い結果は使わない */
let computing = 0;

/** 詳細グリッドを入れ替え、標高から推定した細い川（河川データにない沢）を薄く描く */
async function setLocal(g: Grid) {
  grids.local = g;
  const thr = DEM_RIVER_KM2 / g.cellKm2;
  const water = pixel("--color-water", 0);
  setImage(
    map,
    "dem-rivers",
    await paint(g, (c) =>
      g.acc[c] < thr
        ? 0
        : ((Math.min(88, 28 + 14 * Math.log2(g.acc[c] / thr)) << 24) |
            water) >>>
          0,
    ),
  );
}

/**
 * 拡大して地図を止めたら、表示範囲を詳細グリッドとして計算する（マウス位置からの流れの先読み用）。
 * 今の詳細グリッドがすでに表示範囲を同じ細かさで覆っていれば何もしない
 */
async function computeView() {
  // クリックした地点の雨の流れをたどっている間は、Worker と通信をそちらに譲る（終わったらあらためて計算する）
  if (clicking || map.getZoom() < AUTO_COMPUTE_ZOOM) return;
  const view = viewBBox();
  const L = grids.local;
  if (L && L.Z >= gridSpec(view).Z && covers(L.bbox, view)) return;
  // 先読み用の裏の計算なので、状態表示には出さない（雨の再生中の表示を邪魔しない）
  const id = ++computing;
  const g = await buildGrid(view);
  if (id !== computing) return;
  await setLocal(g);
}

/**
 * 表示範囲の先読みは、見えている地図のタイルを読み終えてから始める。
 * 標高タイル（1画面で約3.6MB）を同時に読むと、表示中の地図と回線を取り合って描画が遅れるので
 */
let waitingIdle = false;
function computeWhenIdle() {
  if (map.loaded()) return void computeView();
  if (waitingIdle) return;
  waitingIdle = true;
  map.once("idle", () => {
    waitingIdle = false;
    computeView();
  });
}

/** クリックした地点に降った雨の流れをたどる。まだ計算していない場所なら、その周りの地形を読み込んでから */
let clicks = 0;
let clicking = false;
function refreshIdleStatus() {
  if ($("panel").dataset.state === "result" || clicking) return;
  const c = map.getCenter();
  status(inBBox([c.lng, c.lat], JAPAN_BBOX) ? STATUS_IDLE_IN : STATUS_IDLE_OUT);
}

async function onClick(p: LngLat, up = false) {
  if (!inBBox(p, JAPAN_BBOX)) {
    rain.clear();
    rain.notifyAt(p, "日本国内の陸地をクリックしてください");
    status(STATUS_IDLE_OUT);
    return;
  }
  const id = ++clicks;
  clicking = true;
  try {
    rain.prepare(p); // すぐに雨粒を置き、パネルに「調べています」を出す
    // 大きく引いた状態のまま追いかけカメラが動き出すと、パンとズームが追いつかず
    // 目的地が画面の外に出ることがあるので、ある程度まで寄せてから雨の流れをたどり始める。
    // flyTo は一度引いてから寄る弧を描くので、まっすぐ寄せる easeTo にする
    const zoomedIn =
      map.getZoom() >= CLICK_ZOOM
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            // padding を easeTo に渡すと地図に残り続け、以後の cameraForBounds で二重に効いて
            // 追いかけカメラの目標が飛ぶ。パネルを避けた中心はここで計算して渡す
            const to = map.cameraForBounds([p, p], {
              padding: paddingAround(map, $("panel")),
              maxZoom: CLICK_ZOOM,
            });
            map.easeTo({
              center: to?.center ?? p,
              zoom: CLICK_ZOOM,
              duration: reducedMotion() ? 0 : 1600,
            });
            map.once("moveend", () => resolve());
          });
    if (!gridAt(p)) {
      // クリック地点の周り（細かい）と、下流をたどるための広域（粗い）を同時に読み込み始める。
      // 雨はたいてい周り約25kmの外へ流れ出るので、広域を後から読むと待ち時間が倍になる
      const [local] = await Promise.all([
        buildAround(p, CLICK_GRID.z, CLICK_GRID.tiles, rain.loading),
        gridAround(p) ? null : loadWide(p),
      ]);
      addWide(local);
      if (id !== clicks) return; // 読み込み中に別の地点がクリックされた
    }
    await zoomedIn; // 寄せ終わってから追いかけカメラに引き継ぐ（読み込みで待った分はここでは待たない）
    if (id !== clicks) return;
    await rain.play(p, up);
  } finally {
    if (id === clicks) {
      clicking = false;
      computeView(); // 後回しにしていた表示範囲の計算
    }
  }
}

// ---- マウス位置からの流れを先読み（読み込み済みのグリッドだけで追い、地形は取りに行かない） ----
let hoverQueued = false;
let hoverAt: LngLat = [0, 0];
/** 前回たどった出発セル。マウスが同じ川筋の上で動いている間は、たどり直さない */
let hoverFrom: { g: Grid | undefined; s: number } = { g: undefined, s: -1 };
function onMove(p: LngLat) {
  hoverAt = p;
  if (hoverQueued) return;
  hoverQueued = true;
  requestAnimationFrame(async () => {
    hoverQueued = false;
    const g = gridAt(hoverAt);
    const s = g ? snap(g.acc, g.W, g.H, g.toCell(...hoverAt), 2) : -1;
    if (g === hoverFrom.g && s === hoverFrom.s) return;
    hoverFrom = { g, s };
    if (!g || s < 0 || Number.isNaN(g.elev[s])) return setData(map, "hover");
    const { pts } = await traceToSea(g, s, { grow: false, withRivers: false });
    setData(map, "hover", { type: "LineString", coordinates: pts });
  });
}

// ---- キーボード操作: 地図にフォーカスしたら照準を出し、Enter / スペースでその位置に降った雨の流れをたどる ----
function setupKeyboard() {
  const canvas = map.getCanvas();
  const box = $("map");
  const crosshair = $("crosshair");
  const place = () => {
    const [x, y] = freeCenter(map, $("panel"));
    crosshair.style.left = `${x}px`;
    crosshair.style.top = `${y}px`;
  };
  canvas.addEventListener("focus", () => {
    // マウスで地図をつかんだときには出さず、キーボードで移ってきたときだけ出す
    if (!canvas.matches(":focus-visible")) return;
    place();
    box.dataset.keyboard = "";
  });
  canvas.addEventListener("blur", () => delete box.dataset.keyboard);
  window.addEventListener("resize", place);
  canvas.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    const { lng, lat } = map.unproject(freeCenter(map, $("panel")));
    onClick([lng, lat]);
  });
}

/** 「アプリについて・利用上の注意」「出典・ライセンス」はパネルの一番下にあり、開いても中身がパネルの外に隠れるので、見える位置までスクロールする */
function setupAbout() {
  for (const id of ["about", "sources"] as const) {
    const details = $<HTMLDetailsElement>(id);
    details.addEventListener("toggle", () => {
      if (!details.open) return;
      requestAnimationFrame(() =>
        details.scrollIntoView({
          block: "nearest",
          behavior: reducedMotion() ? "auto" : "smooth",
        }),
      );
    });
  }
}

/** 今の水の流れ（地点と向き）のURLをコピーし、リンク自体で結果を返す */
let copied: ReturnType<typeof setTimeout> | undefined;
async function onShare() {
  const ok = await navigator.clipboard.writeText(location.href).then(
    () => true,
    () => false,
  );
  share.dataset.copied = ok ? "ok" : "failed";
  share.textContent = ok
    ? "✓ リンクをコピーしました"
    : "コピーできませんでした。アドレスバーのURLを共有してください";
  $("announce").textContent = share.textContent;
  clearTimeout(copied);
  copied = setTimeout(() => {
    delete share.dataset.copied;
    share.textContent = "この結果を共有する";
  }, 2500);
}

async function main() {
  await new Promise<void>((resolve) =>
    map.loaded() ? resolve() : map.once("load", () => resolve()),
  );
  addOverlays(map);
  onRiversChange((features) =>
    setData(map, "rivers", { type: "FeatureCollection", features }),
  );
  map.getCanvas().style.cursor = "crosshair";
  map.on("click", (e) => onClick([e.lngLat.lng, e.lngLat.lat]));
  // 地図が止まってから少し待って、表示範囲の川の読み込みと自動計算をする。
  // 雨粒を追うカメラは毎フレーム地図を動かすので、そのたびに走らせない
  let settle: ReturnType<typeof setTimeout> | undefined;
  map.on("moveend", () => {
    clearTimeout(settle);
    settle = setTimeout(() => {
      showViewRivers();
      computeWhenIdle();
      refreshIdleStatus();
    }, 300);
  });
  map.on("mousemove", (e) => onMove([e.lngLat.lng, e.lngLat.lat]));
  map.on("mouseout", () => {
    hoverFrom = { g: undefined, s: -1 };
    setData(map, "hover");
  });
  share.onclick = onShare;
  setupKeyboard();
  setupKarte();
  setupAbout();

  refreshIdleStatus();
  if (shared) onClick(shared, sharedUp);
  showViewRivers();
  computeWhenIdle();
}

main();
