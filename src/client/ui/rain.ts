import maplibregl, { type Map as MlMap } from "maplibre-gl";
import {
  basinAt,
  type DamOnPath,
  damsAlong,
  prefetchBasin,
} from "../data/karte";
import {
  type Place,
  type PlaceEvent,
  place,
  placeName,
  placesAlong,
} from "../data/places";
import { seaAt } from "../data/seas";
import { type WaterOnPath, waterAlong } from "../data/water";
import type { LngLat } from "../geo";
import { type Grid, gridAt } from "../terrain/grid";
import { snap } from "../terrain/hydro";
import {
  type Path,
  refineSource,
  traceToSea,
  traceToSource,
} from "../terrain/trace";
import { FollowCamera } from "./camera";
import { el } from "./dom";
import { areaSize } from "./format";
import { JourneyPanel } from "./journey-panel";
import {
  easeInOut,
  indexAtDistance,
  playDuration,
  reducedMotion,
} from "./motion";
import { SummaryActions } from "./summary-actions";
import {
  type Mouth,
  mouthName,
  type SourcePath,
  sourceEvents,
  Timeline,
  timelineEvents,
} from "./timeline";
import { TrailLayers } from "./trail-layers";
import { type Trail, trailView } from "./trail-state";

export interface RainUi {
  panel: HTMLElement;
  result: HTMLElement;
  journey: HTMLElement;
  origin: HTMLElement;
  headline: HTMLElement;
  progress: HTMLElement;
  bar: HTMLElement;
  /** 読み上げ専用の領域（aria-live） */
  announce: HTMLElement;
  /** 時系列を包む開閉できる欄 */
  route: HTMLDetailsElement;
  timeline: HTMLOListElement;
  /** 上流へさかのぼった道のりの欄と時系列 */
  source: HTMLDetailsElement;
  sourceTimeline: HTMLOListElement;
  sourceNote: HTMLElement;
  summary: HTMLElement;
  share: HTMLElement;
  /** 「アプリについて・利用上の注意」「出典・ライセンス」欄。開いたまま雨の流れをたどると、旅の見出しが伸びた分スクロールされすぎるので閉じる */
  infoToggles: HTMLDetailsElement[];
}

/** クリックした地点の雨粒を海まで流し（または水源へさかのぼり）、通過した川・市区町村・ダムを時系列に出す */
export class Rain {
  /** 再生のたびに増える。古い再生の非同期処理はこれで打ち切る */
  private token = 0;
  private readonly layers: TrailLayers;
  private readonly timeline: Timeline;
  private readonly sourceTimeline: Timeline;
  private camera: FollowCamera | null = null;
  /** さかのぼりのたびに増える。もう一度さかのぼったら、前のさかのぼりの非同期処理（地名・ダム）を打ち切る */
  private sourceRun = 0;
  /** 道のりを追う動きのたびに増える。雨の通り道と水の来た道は同時に1つだけ動かす */
  private motion = 0;
  /** 今カメラが追っている（追い終えた）道のり */
  private showing: Trail = "route";
  /** 欄を開き直したときに、その道のりをもう一度追う */
  private replay: Partial<Record<Trail, () => void>> = {};
  private readonly actions: SummaryActions;
  private readonly panel: JourneyPanel;

  constructor(
    private readonly map: MlMap,
    private readonly ui: RainUi,
    private readonly status: (text: string) => void,
    /** 流し始めた地点（吸着後）。共有URLの更新に使う */
    private readonly onStart: (p: LngLat) => void,
    /** 見ている道のり（雨の通り道・水の来た道）が変わった。共有URLに残す */
    private readonly onTrail: (kind: Trail) => void,
  ) {
    this.panel = new JourneyPanel(ui);
    this.layers = new TrailLayers(map);
    this.actions = new SummaryActions(ui);
    this.timeline = new Timeline(ui.timeline);
    this.sourceTimeline = new Timeline(ui.sourceTimeline);
    // 2つの欄は name で束ねてあり、片方を開くともう片方は閉じる。開いた方の道のりをもう一度追う
    for (const kind of ["route", "source"] as const)
      ui[kind].addEventListener("toggle", () => {
        if (ui[kind].open && this.showing !== kind) this.replay[kind]?.();
      });
  }

  stop() {
    this.token++;
    this.layers.removeDrop();
    this.camera?.dispose();
  }

  clear() {
    this.stop();
    this.ui.result.hidden = true;
    delete this.ui.panel.dataset.state;
    this.layers.clear();
  }

  /**
   * クリックした直後の表示。地形の読み込みや流路の計算を待つ間も、
   * その地点に雨粒を置き、パネルに「調べています」と進み具合を出して、反応があることを示す
   */
  prepare(p: LngLat, text = "この辺りの地形を読み込み中…") {
    this.token++;
    this.camera?.dispose();
    this.layers.placeDrop(p);
    this.openPanel("");
    this.closeInfo();
    this.ui.route.open = true;
    this.panel.searching(text);
    this.layers.clear();
  }

  /** 結果欄を開き、前の雨の時系列・まとめを消す */
  private openPanel(origin: string) {
    this.ui.panel.dataset.state = "result";
    this.ui.result.hidden = false;
    this.actions.hide();
    this.ui.source.hidden = true;
    this.replay = {};
    this.showing = "route";
    this.panel.reset(origin);
    this.timeline.clear();
    this.sourceTimeline.clear();
    this.ui.sourceNote.replaceChildren();
  }

  /** 読み込み・計算の進み具合。調べている最中ならパネルの見出しに、そうでなければ状態表示に出す */
  readonly loading = (text: string) => {
    if (this.panel.isSearching) this.panel.say(text);
    else this.status(text);
  };

  /** up: 下る動きは見せず、すぐに上流へさかのぼる（さかのぼった状態の共有URLを開いたとき） */
  async play([lon, lat]: LngLat, up = false) {
    const g = gridAt([lon, lat]);
    const s = g ? snap(g.acc, g.W, g.H, g.toCell(lon, lat)) : -1;
    if (!g || Number.isNaN(g.elev[s])) {
      this.clear();
      return this.notifyAt(
        [lon, lat],
        g
          ? "ここは海です。陸地をクリックしてください"
          : "この地点の地形を読み込めませんでした",
      );
    }
    this.prepare(g.lngLat(s), "雨の流れを計算中…");
    const token = this.token;
    const alive = () => token === this.token;
    this.layers.clearHover();
    const path = await traceToSea(g, s, { say: this.loading });
    if (!alive()) return; // 計算中に別の地点がクリックされた
    this.status(
      "別の地点をクリックすると、そこに降った雨の流れをたどり直します。",
    );
    this.onStart(path.pts[0]);

    this.layers.showBasin(g, s, alive);
    this.resetPanel(`標高 ${Math.round(g.elev[s]).toLocaleString()} m`);

    // 地名は非同期で届くので、届いたら到達済みの分を出す
    let origin: Place | null = null;
    let places: PlaceEvent[] = [];
    let reached = -1;
    const originPlace = place(path.pts[0]);
    originPlace.then((p) => {
      if (!alive() || !p) return;
      origin = p;
      this.panel.prependOrigin(placeName(p));
    });
    const along = placesAlong(path);
    along.then((a) => {
      places = a.places;
      reveal(reached);
    });
    // 流路沿いのダム・堰（流域サマリのデータ）。読めなければ出さないだけ
    let dams: DamOnPath[] = [];
    damsAlong(path.pts)
      .then((list) => {
        dams = list;
        reveal(reached);
      })
      .catch(() => {});
    // 流路沿いの水のきれいさ（公共用水域の測定点）。読めなければ出さないだけ
    let water: WaterOnPath[] = [];
    waterAlong(path)
      .then((list) => {
        water = list;
        reveal(reached);
      })
      .catch(() => {});
    // 河口の海と地名はどちらも別のファイルを読んでから分かる。
    // 到着は海が分かりしだい出し、河口の地名は分かったら書き足す（undefined = 海を調べ中）
    let mouth: Mouth | null | undefined = path.toSea ? undefined : null;
    let arrived = false;
    const lastRiver = path.rivers.at(-1)?.name;
    const mouthReady = path.toSea
      ? seaAt(path.pts[path.pts.length - 1]).then((sea) => {
          mouth = { sea, name: mouthName(lastRiver, null) };
          reveal(reached);
        })
      : Promise.resolve();
    if (path.toSea)
      Promise.all([along, mouthReady]).then(([{ last: at }]) => {
        if (!alive() || !at || !mouth) return;
        mouth = { ...mouth, name: mouthName(lastRiver, at) };
        reveal(reached);
        // 見出しは今その道のりを見ているときだけ書き換える（水の来た道を見ている間に上書きしない）
        if (arrived && this.showing === "route")
          this.panel.arrive(path, mouth, false);
      });

    const reveal = (k: number) => {
      if (!alive()) return;
      const events = timelineEvents(
        path,
        places,
        origin,
        mouth,
        k,
        dams,
        water,
      ).filter((ev) => ev.step <= k);
      this.timeline.add(events);
      this.layers.showConfluences(events, path.pts);
    };

    this.layers.placeDrop(path.pts[0]);
    /** 河口まで下る。開き直したときも最初と同じように、見出し・時系列・進み具合を出し直してたどる */
    const descend = (onEnd: () => unknown) => {
      arrived = false; // たどっている間に河口の地名が届いても、見出しを結論にしない
      this.timeline.clear();
      this.panel.start("ここに降った雨は…");
      this.follow(
        "route",
        path,
        alive,
        (k) => {
          reached = k;
          this.layers.advance("downstream", path.pts, k);
          reveal(k);
          this.panel.progress(path, k, "route");
        },
        onEnd,
      );
    };
    const finish = () =>
      mouthReady.then(() => {
        if (!alive()) return;
        arrived = true;
        this.panel.arrive(path, mouth ?? null, !up);
        this.actions.show(path, originPlace, { g, s }, () =>
          this.playSource({ g, s }, originPlace, alive),
        );
        this.replay.route = () =>
          descend(() => {
            arrived = true;
            this.panel.arrive(path, mouth ?? null);
            this.actions.scrollTo();
          });
        // 大きな川では、さかのぼり専用の粗い範囲を先に読んでおく（押されたときに待たせない）。
        // 集水域を数えるのに数十 ms かかるので、着地の動きを止めないよう、カメラが着地し終えてから始める。
        // クリックした範囲からはみ出していたら、さかのぼるときと同じ集水域で塗り直す（さかのぼりに移っていれば playSource が塗る）
        if (up) this.actions.up?.click();
        else
          this.camera?.landed.then(async () => {
            if (!alive() || this.showing !== "route") return;
            const basin = await prefetchBasin({ g, s });
            if (alive() && this.showing === "route" && basin && basin.g !== g)
              this.layers.showBasin(basin.g, basin.s, alive, basin.up);
          });
      });
    if (up) {
      // さかのぼった状態の共有URL: 下る動きは見せず、雨の通り道の時系列だけ作ってすぐにさかのぼる
      // （線と雨粒は動かさない。「下流へくだる」で開き直せば、最初からたどり直す）
      reached = path.pts.length - 1;
      reveal(reached);
      finish();
      return;
    }
    descend(finish);
  }

  /**
   * 道のりに沿って距離で進め（動き始めと到着前はゆるやか。動きを減らす設定なら短く）、カメラで追いかける。
   * 着いたら onEnd を待ってから全体に着地する。後から始めた動きが前の動きを止める
   */
  private closeInfo() {
    for (const d of this.ui.infoToggles) d.open = false;
  }

  private follow(
    kind: Trail,
    { pts, dist }: Pick<Path, "pts" | "dist">,
    playing: () => boolean,
    onStep: (k: number) => void,
    onEnd?: () => unknown,
  ) {
    const run = ++this.motion;
    const alive = () => playing() && run === this.motion;
    this.showing = kind;
    this.onTrail(kind);
    // さかのぼる・くだり直すときも、見てほしいのは道のりなので閉じる
    this.closeInfo();
    const view = trailView(kind);
    // 合流点・支流・ダムの印は reveal() 側で出し直す
    this.layers.clearLine(view.clearLine);
    this.actions.showFor(view);
    this.camera?.dispose();
    const camera = new FollowCamera(this.map, pts, this.ui.panel);
    this.camera = camera;
    const n = pts.length;
    const total = dist[n - 1];
    const duration = reducedMotion() ? 800 : playDuration(total);
    const t0 = performance.now();
    let reached = -1;
    const frame = (now: number) => {
      if (!alive()) return;
      const t = Math.min(1, Math.max(0, (now - t0) / duration)); // rAF の now は t0 より前のことがある
      const k = t >= 1 ? n - 1 : indexAtDistance(dist, total * easeInOut(t));
      if (k !== reached) {
        reached = k;
        onStep(k);
      }
      camera.progress(k);
      if (k < n - 1) requestAnimationFrame(frame);
      else
        Promise.resolve(onEnd?.()).then(() => {
          // パネルの高さが確定してから、隠れない範囲に全体を収める
          if (alive()) requestAnimationFrame(() => camera.arrive());
        });
    };
    requestAnimationFrame(frame);
  }

  private resetPanel(origin: string) {
    this.openPanel(origin);
    this.panel.found();
  }

  /**
   * クリック地点から、支流の先の先までたどっていちばん遠い水源へさかのぼる。道のりの線をクリック地点から上流へ伸ばし、
   * 通る川・流れ込む支流・市区町村を「水の来た道」に並べる。河口に着いてから呼ぶ（同じ再生の alive を使う）
   */
  private async playSource(
    from: { g: Grid; s: number },
    originPlace: Promise<Place | null>,
    playing: () => boolean,
  ) {
    const run = ++this.sourceRun;
    const alive = () => playing() && run === this.sourceRun;
    // 大きな川では、さかのぼり専用の粗い範囲を読んでから始める（読み込み中は見出しに出す）。
    // 読み込みを待つ間に河口の地名が届いても見出しを書き戻さないよう、先に「水の来た道」を見ている状態にする
    this.showing = "source";
    this.panel.start("水源へさかのぼっています");
    this.panel.say("上流の地形を読み込み中…");
    // 待っている間は押せないようにする（押し直すたびに読み込み中の表示に戻らないように）。
    // 戻すのは始めたときのボタン（待つ間に別の地点を選ぶと、actions.up は新しいボタンを指す）
    const up = this.actions.up;
    if (up) up.disabled = true;
    const basin = await basinAt(from, (text) => {
      if (alive()) this.panel.say(text);
    });
    if (up) up.disabled = false;
    // 待つ間に「雨の通り道」を開き直して下り直していたら、さかのぼりで割り込まない
    if (!alive() || !basin || this.showing !== "source") return;
    // クリック時の塗りは雨をたどった範囲の中だけなので、より広い範囲で数え直せたら塗り直す
    if (basin.g !== from.g)
      this.layers.showBasin(basin.g, basin.s, alive, basin.up);
    // 雨をたどった範囲より粗い範囲で水源を探したときは、水源の位置だけ使い、線は細かい範囲で引き直す。
    // クリック地点のそばを通らなければ、粗い道のりのまま出す
    const coarse = traceToSource(basin.g, basin.s, basin.truncated);
    const src =
      basin.g === from.g
        ? coarse
        : ((await refineSource(coarse, from, basin.g, (text) => {
            if (alive()) this.panel.say(text);
          }).catch(() => null)) ?? coarse); // 引き直しの地形を読めなくても、粗い線で続ける
    if (!alive()) return;
    this.ui.route.open = false; // 下る旅はたたみ、さかのぼる道のりに目を移す
    this.ui.source.hidden = false;
    this.ui.source.open = true;

    let origin: Place | null = null;
    let places: PlaceEvent[] = [];
    // 水源の市区町村（未着なら undefined のまま「水源」と出す）
    let sourcePlace: Place | null | undefined;
    let dams: DamOnPath[] = [];
    let water: WaterOnPath[] = [];
    let reached = -1;
    const reveal = (k: number) => {
      if (!alive()) return;
      const events = sourceEvents(
        src,
        places,
        origin,
        sourcePlace,
        dams,
        water,
      ).filter((ev) => ev.step <= k);
      this.sourceTimeline.add(events);
      this.layers.showConfluences(events, src.pts);
    };
    originPlace.then((p) => {
      origin = p;
    });
    // さかのぼる道のり沿いのダム・堰（読めなければ出さないだけ）
    damsAlong(src.pts)
      .then((list) => {
        dams = list;
        reveal(reached);
      })
      .catch(() => {});
    waterAlong(src)
      .then((list) => {
        water = list;
        reveal(reached);
      })
      .catch(() => {});
    placesAlong(src).then((a) => {
      places = a.places;
      if (!src.cut) sourcePlace = a.last;
      reveal(reached);
    });

    /** 水源へさかのぼる。開き直したときも最初と同じように、見出し・時系列・進み具合を出し直してたどる */
    const climb = () => {
      this.sourceTimeline.clear();
      this.ui.sourceNote.replaceChildren();
      this.panel.start("水源へさかのぼっています");
      this.follow(
        "source",
        src,
        alive,
        (k) => {
          reached = k;
          // 雨粒の印も一緒にさかのぼらせ、河口と同じように水源に印が残るようにする
          this.layers.advance("upstream", src.pts, k);
          reveal(k);
          this.panel.progress(src, k, "source");
        },
        () => {
          this.panel.arriveSource(src);
          this.showSourceNote(basin, src);
          this.actions.scrollTo();
        },
      );
    };
    this.replay.source = climb;
    climb();
  }

  /**
   * さかのぼった結果の補足。集まる範囲が小さい地点（小さな水路）は、近くの雨がほとんどだと伝える。
   * 高低差の小さい平地では、用水が地形からたどれないことを添える
   */
  private showSourceNote(basin: { g: Grid; s: number }, src: SourcePath) {
    // 小さいかどうかの目安なので、範囲の中央の緯度の面積で足りる（流域サマリの面積はセルごとの緯度で測る）
    const km2 = basin.g.acc[basin.s] * basin.g.cellKm2;
    const small = km2 < SMALL_BASIN_KM2;
    const flat = src.elev - basin.g.elev[basin.s] < FLAT_RELIEF_M;
    this.ui.sourceNote.replaceChildren(
      ...(small
        ? [
            el("p", {
              textContent: `この地点に水が集まる範囲は${areaSize(km2)}ほどで、ほとんどが近くに降った雨です。`,
            }),
          ]
        : []),
      ...(flat
        ? [
            el("p", {
              textContent:
                "平地の田んぼや水路には、遠くの川から引いた用水も流れていますが、地形からはたどれません。",
            }),
          ]
        : []),
    );
  }

  /** 地図上のその地点に、少しの間だけ吹き出しで知らせる */
  notifyAt(p: LngLat, text: string) {
    const popup = new maplibregl.Popup({
      closeButton: false,
      className: "hint",
      offset: 8,
      maxWidth: "none",
    })
      .setLngLat(p)
      .setText(text)
      .addTo(this.map);
    this.panel.announce(text);
    setTimeout(() => popup.remove(), 2500);
  }
}

/** これより狭い集水域は「小さな水路」として、近くの雨がほとんどだと添える */
const SMALL_BASIN_KM2 = 10;
/** 水源とクリック地点の高低差がこれ未満なら平地とみなす */
const FLAT_RELIEF_M = 30;
