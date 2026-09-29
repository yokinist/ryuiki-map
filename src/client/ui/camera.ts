import maplibregl, {
  type Map as MlMap,
  type PaddingOptions,
} from "maplibre-gl";
import { CLICK_ZOOM } from "../config";
import type { LngLat } from "../geo";
import { tokenMs } from "../map/theme";
import { fitPadding } from "./layout";
import { reducedMotion } from "./motion";

/** 追いかけるときに寄りすぎない上限のズーム */
const MAX_ZOOM = 13;
/** 到着したら、旅がぴったり収まるズームよりこの分だけ余分に引く（海に出た余白が見えるように） */
const ARRIVAL_EXTRA_ZOOM_OUT = 0.3;

/**
 * 雨粒を追いかけ、通ってきた道のりが収まるよう引いていくカメラ。作られてから止まるまで、毎フレーム1つのループで動かす。
 * - 目標（中心・ズーム）を徐々に動かし、表示はそれをさらに追う（2段のなめらかさ）。止まった状態から緩やかに動き出し、急には動かない
 * - ズームは CLICK_ZOOM を上限に、道のりを収めるために引く方向にだけ動く
 * - 到着後も、パネルの大きさが変わったら同じ動きで収め直す
 * - 利用者が地図を動かす・到着後に開閉欄を操作したら、以後は一切動かさない
 * - 動きを減らす設定なら追いかけず、旅の全体へ一度に合わせる
 */
export class FollowCamera {
  /** 雨粒が今いる点 */
  private k = 0;
  /** 箱に入れ終えた点 */
  private seen = -1;
  private box: [w: number, s: number, e: number, n: number];
  /** 道のりを収めるのに要るズーム。引く方向にだけ動く */
  private fit = MAX_ZOOM;
  private arrived = false;
  private extra = 0;
  /** 最終目標 */
  private goal: { lng: number; lat: number; zoom: number } | null = null;
  /** 表示が追いかける途中の目標（1段目） */
  private aim: { lng: number; lat: number; zoom: number };
  private raf = 0;
  private last = 0;
  private stopped = false;
  private land: () => void = () => {};
  /** 着地し終えた（または止められた）ら解決する。重い処理は、これを待ってから始めると動きを止めない */
  readonly landed = new Promise<void>((resolve) => {
    this.land = resolve;
  });
  private readonly reduce = reducedMotion();
  private readonly panMs = Math.max(tokenMs("--duration-slow"), 1);
  private readonly zoomMs = Math.max(tokenMs("--duration-camera"), 1);
  /**
   * パネルに隠れない余白。パネルは時系列が増えると伸びるので、大きさが変わったときだけ測り直す
   * （毎フレーム測ると、直前の文字の書き換えのせいで毎回レイアウト計算が走り、スマホでかくつく）
   */
  private padding: PaddingOptions;
  private readonly resize = new ResizeObserver(() => {
    this.padding = paddingAround(this.map, this.panel);
    this.run();
  });

  constructor(
    private readonly map: MlMap,
    private readonly pts: LngLat[],
    /** 地図の上でパネルが覆っている要素（その部分を避けて映す） */
    private readonly panel: HTMLElement,
  ) {
    const [x, y] = pts[0];
    this.box = [x, y, x, y];
    const c = map.getCenter();
    this.aim = { lng: c.lng, lat: c.lat, zoom: map.getZoom() };
    this.padding = paddingAround(map, panel);
    const container = map.getContainer();
    for (const e of [panel, container, credits(container)])
      if (e) this.resize.observe(e);
    map.on("movestart", this.onMoveStart);
    // toggle は泡立たないので、捕捉段階で拾う
    panel.addEventListener("toggle", this.onToggle, true);
    this.run();
  }

  /** 雨粒が k 番目の点まで来た */
  progress(k: number) {
    this.k = k;
  }

  /** 到着した。旅の全体に着地し、以後はパネルの大きさが変わったときだけ収め直す */
  arrive() {
    this.arrived = true;
    this.padding = paddingAround(this.map, this.panel);
    // スマホ（パネルが画面幅の大半を占める）はフレームが詰まりがちで、追加の引きが引き切らずに
    // 止まって見えることがあるので足さない
    const m = this.map.getContainer().getBoundingClientRect();
    const wide = this.panel.getBoundingClientRect().width <= m.width * 0.6;
    this.extra = wide ? ARRIVAL_EXTRA_ZOOM_OUT : 0;
    this.run();
  }

  dispose() {
    this.stopped = true;
    this.land();
    cancelAnimationFrame(this.raf);
    this.map.off("movestart", this.onMoveStart);
    this.panel.removeEventListener("toggle", this.onToggle, true);
    this.resize.disconnect();
  }

  private run() {
    if (this.stopped || this.raf) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number) => {
    this.raf = 0;
    if (this.stopped) return;
    // フレーム落ちで一気に追いつくと跳ねるので、1フレーム分の進みを抑える
    const dt = Math.min(this.last ? now - this.last : 16, 50);
    this.last = now;
    const goal = this.target();
    if (this.reduce) {
      this.map.jumpTo({ center: goal, zoom: goal.zoom });
    } else {
      // 1段目: 目標を最終目標へ寄せる。2段目: 表示を目標へ寄せる
      const aPan = 1 - Math.exp(-dt / this.panMs);
      const aZoom = 1 - Math.exp(-dt / this.zoomMs);
      const a = this.aim;
      a.lng += (goal.lng - a.lng) * aPan;
      a.lat += (goal.lat - a.lat) * aPan;
      a.zoom += (goal.zoom - a.zoom) * aPan;
      const c = this.map.getCenter();
      const z = this.map.getZoom();
      this.map.jumpTo({
        center: [
          c.lng + (a.lng - c.lng) * aPan,
          c.lat + (a.lat - c.lat) * aPan,
        ],
        zoom: z + (a.zoom - z) * aZoom,
      });
    }
    // 追いかけている間は毎フレーム動かし続ける（1フレームでも止めると、次で2倍進んでカクつく）
    if (!this.arrived || !this.settled(goal))
      this.raf = requestAnimationFrame(this.tick);
    else this.land();
  };

  /** 今の最終目標。動きを減らす設定なら、最初から旅の全体 */
  private target() {
    const last = this.pts.length - 1;
    // これから通る先の 1/4 も箱に入れて、ズームアウトが雨粒より遅れないようにする
    const look =
      this.reduce || this.arrived
        ? last
        : this.k + Math.ceil((last - this.k) * 0.25);
    for (; this.seen < look; ) {
      const [x, y] = this.pts[++this.seen];
      const b = this.box;
      this.box = [
        Math.min(b[0], x),
        Math.min(b[1], y),
        Math.max(b[2], x),
        Math.max(b[3], y),
      ];
    }
    const [w, s, e, n] = this.box;
    const bounds: [LngLat, LngLat] = [
      [w, s],
      [e, n],
    ];
    const fit = this.map.cameraForBounds(bounds, {
      padding: this.padding,
      maxZoom: MAX_ZOOM,
    })?.zoom;
    if (fit !== undefined) this.fit = Math.min(this.fit, fit);
    const zoom = Math.min(CLICK_ZOOM, this.fit) - this.extra;
    // 中心は実際に使うズームで求める（パネルを避ける余白の効き方がズームで変わる）。
    // 収められないとき（画面がとても小さい）は、前の目標のままにする（雨粒へ飛ばさない）
    const center = this.map.cameraForBounds(bounds, {
      padding: this.padding,
      maxZoom: zoom,
    })?.center;
    const c = center
      ? maplibregl.LngLat.convert(center)
      : (this.goal ?? maplibregl.LngLat.convert(this.pts[this.k]));
    this.goal = { lng: c.lng, lat: c.lat, zoom };
    return this.goal;
  }

  private settled(goal: { lng: number; lat: number; zoom: number }) {
    if (Math.abs(this.map.getZoom() - goal.zoom) > 0.04) return false;
    const c = this.map.getCenter();
    const dx = (c.lng - goal.lng) * Math.cos((c.lat * Math.PI) / 180);
    const dy = c.lat - goal.lat;
    return dx * dx + dy * dy < 4e-6;
  }

  // 利用者の操作（ドラッグ・ホイール・ピンチ）には originalEvent が付く。カメラ自身の jumpTo には付かない
  private readonly onMoveStart = (e: { originalEvent?: unknown }) => {
    if (e.originalEvent) this.dispose();
  };

  // 到着後に開閉欄（アプリについて・利用上の注意など）を開くのは利用者の操作なので、地図を動かさない
  private readonly onToggle = () => {
    if (this.arrived) this.dispose();
  };
}

/** パネルに隠れていない範囲の中心（地図の左上からのピクセル） */
export function freeCenter(map: MlMap, panel: HTMLElement): [number, number] {
  const {
    top = 0,
    bottom = 0,
    left = 0,
    right = 0,
  } = paddingAround(map, panel);
  const { width, height } = map.getContainer().getBoundingClientRect();
  return [left + (width - left - right) / 2, top + (height - top - bottom) / 2];
}

/** 地図の右下の出典表示 */
const credits = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(".maplibregl-ctrl-bottom-right");

/** パネルに隠れない余白。パネルが画面幅の大半を占める（スマホ）ならパネルの下、そうでなければ右に映す */
export function paddingAround(map: MlMap, panel: HTMLElement): PaddingOptions {
  const container = map.getContainer();
  const m = container.getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  const gap = 48;
  // 下の出典表示（スマホでは数行に折り返す）にも隠れないように
  const c = credits(container)?.getBoundingClientRect();
  const bottom = c ? m.bottom - c.top + gap / 2 : gap;
  return fitPadding(
    p.width > m.width * 0.6
      ? { top: p.bottom - m.top + gap, bottom, left: gap, right: gap }
      : { top: gap, bottom: gap, left: p.right - m.left + gap, right: 56 },
    m.width,
    m.height,
  );
}
