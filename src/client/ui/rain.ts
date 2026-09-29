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
import type { LngLat } from "../geo";
import { maskRect, paint, setData, setImage } from "../map/overlays";
import { pixel } from "../map/theme";
import { type Grid, gridAt } from "../terrain/grid";
import { snap, upstream } from "../terrain/hydro";
import { type Path, traceToSea, traceToSource } from "../terrain/trace";
import { FollowCamera } from "./camera";
import { el } from "./dom";
import { areaSize, eta, km } from "./format";
import { openKarte } from "./karte";
import {
  easeInOut,
  indexAtDistance,
  playDuration,
  reducedMotion,
} from "./motion";
import {
  type Mouth,
  mouthName,
  type SourcePath,
  sourceEvents,
  Timeline,
  type TimelineEvent,
  timelineEvents,
} from "./timeline";

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

/** クリックした地点の雨粒を海まで流し（または水源へさかのぼり）、通過した川・地区・ダムを時系列に出す */
export class Rain {
  /** 再生のたびに増える。古い再生の非同期処理はこれで打ち切る */
  private token = 0;
  private readonly drop = new maplibregl.Marker({
    element: el("div", { className: "drop", ariaHidden: "true" }), // 地図上の飾り。内容はパネルが伝える
  });
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
  /** 「上流へさかのぼる」「下流へくだる」ボタン。今見ている方でない側だけ出す */
  private upButton: HTMLButtonElement | null = null;
  private downButton: HTMLButtonElement | null = null;
  /** 出発点の説明（「出発点：」を付ける前の文字列） */
  private originText = "";

  constructor(
    private readonly map: MlMap,
    private readonly ui: RainUi,
    private readonly status: (text: string) => void,
    /** 流し始めた地点（吸着後）。共有URLの更新に使う */
    private readonly onStart: (p: LngLat) => void,
    /** 見ている道のり（雨の通り道・水の来た道）が変わった。共有URLに残す */
    private readonly onTrail: (kind: Trail) => void,
  ) {
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
    this.drop.remove();
    this.camera?.dispose();
  }

  clear() {
    this.stop();
    this.ui.result.hidden = true;
    delete this.ui.panel.dataset.state;
    this.clearOverlays();
  }

  private clearOverlays() {
    setImage(this.map, "basin");
    setData(this.map, "downstream");
    setData(this.map, "upstream");
    setData(this.map, "confluences");
  }

  /** 雨粒の印を k 番目の点へ動かし、道のりの線をそこまで伸ばす */
  private advance(layer: "downstream" | "upstream", pts: LngLat[], k: number) {
    this.drop.setLngLat(pts[k]);
    setData(this.map, layer, {
      type: "LineString",
      coordinates: pts.slice(0, k + 1),
    });
  }

  /**
   * 時系列に出た項目のうち、川の合流・支流の合流・ダムを地図にも印と名前で置く（雨の通り道・水の来た道で共通）。
   * 出発点自体（最初の川。id "r0"）は雨粒の印と重なるので出さない。ダムは「を通る」を除いた名前だけ
   */
  private showConfluences(events: TimelineEvent[], pts: LngLat[]) {
    const marks = events.filter(
      (ev) =>
        (ev.kind === "river" && ev.id !== "r0") ||
        ev.kind === "dam" ||
        ev.kind === "branch",
    );
    setData(this.map, "confluences", {
      type: "FeatureCollection",
      features: marks.map((ev) => ({
        type: "Feature",
        properties: {
          kind: ev.kind,
          label: ev.kind === "dam" ? ev.title.replace(/を通る$/, "") : ev.title,
        },
        geometry: { type: "Point", coordinates: pts[ev.step] },
      })),
    });
  }

  /**
   * クリックした直後の表示。地形の読み込みや流路の計算を待つ間も、
   * その地点に雨粒を置き、パネルに「調べています」と進み具合を出して、反応があることを示す
   */
  prepare(p: LngLat, text = "この辺りの地形を読み込み中…") {
    this.token++;
    this.camera?.dispose();
    this.drop.setLngLat(p).addTo(this.map);
    this.openPanel("");
    this.closeInfo();
    this.ui.route.open = true;
    this.ui.journey.dataset.loading = "";
    this.ui.headline.textContent = "雨の流れをたどっています";
    this.ui.announce.textContent = "雨の流れをたどっています";
    this.ui.bar.style.transform = "";
    this.ui.progress.textContent = text;
    this.clearOverlays();
  }

  /** 結果欄を開き、前の雨の時系列・まとめを消す */
  private openPanel(origin: string) {
    this.ui.panel.dataset.state = "result";
    this.ui.result.hidden = false;
    this.ui.summary.hidden = true;
    this.ui.share.hidden = true;
    this.ui.source.hidden = true;
    this.replay = {};
    this.showing = "route";
    delete this.ui.journey.dataset.arrived;
    this.setOrigin(origin);
    this.timeline.clear();
    this.sourceTimeline.clear();
    this.ui.sourceNote.replaceChildren();
  }

  /**
   * クリックした出発点の説明を出す。水源など他の地点と混同しないよう「出発点：」を付ける
   * （調べている最中は何も付けない。空にするときも使う）
   */
  private setOrigin(text: string) {
    this.originText = text;
    this.ui.origin.textContent = text ? `出発点：${text}` : "";
  }

  /** 地名が後から届いたときに、標高の説明の前に書き足す */
  private prependOrigin(text: string) {
    this.setOrigin(`${text}・${this.originText}`);
  }

  /** 読み込み・計算の進み具合。調べている最中ならパネルの見出しに、そうでなければ状態表示に出す */
  readonly loading = (text: string) => {
    if (this.ui.journey.dataset.loading !== undefined)
      this.ui.progress.textContent = text;
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
    setData(this.map, "hover");
    const path = await traceToSea(g, s, { say: this.loading });
    if (!alive()) return; // 計算中に別の地点がクリックされた
    this.status(
      "別の地点をクリックすると、そこに降った雨の流れをたどり直します。",
    );
    this.onStart(path.pts[0]);

    this.showBasin(g, s, alive);
    this.resetPanel(`標高 ${Math.round(g.elev[s]).toLocaleString()} m`);

    // 地名は非同期で届くので、届いたら到達済みの分を出す
    let origin: Place | null = null;
    let places: PlaceEvent[] = [];
    let reached = -1;
    const originPlace = place(path.pts[0]);
    originPlace.then((p) => {
      if (!alive() || !p) return;
      origin = p;
      this.prependOrigin(placeName(p));
    });
    placesAlong(
      path,
      () => !alive(),
      (list) => {
        places = list;
        reveal(reached);
      },
    );
    // 流路沿いのダム・堰（流域サマリのデータ）。読めなければ出さないだけ
    let dams: DamOnPath[] = [];
    damsAlong(path.pts)
      .then((list) => {
        dams = list;
        reveal(reached);
      })
      .catch(() => {});
    // 河口の海は海域データからすぐ分かるが、地名は逆ジオコーダ次第で遅い（混んでいると1件10秒以上）。
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
      Promise.all([placeNearMouth(path, alive), mouthReady]).then(([at]) => {
        if (!alive() || !at || !mouth) return;
        mouth = { ...mouth, name: mouthName(lastRiver, at) };
        reveal(reached);
        // 見出しは今その道のりを見ているときだけ書き換える（水の来た道を見ている間に上書きしない）
        if (arrived && this.showing === "route")
          this.showArrival(path, mouth, false);
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
      ).filter((ev) => ev.step <= k);
      this.timeline.add(events);
      this.showConfluences(events, path.pts);
    };

    this.drop.setLngLat(path.pts[0]).addTo(this.map);
    /** 河口まで下る。開き直したときも最初と同じように、見出し・時系列・進み具合を出し直してたどる */
    const descend = (onEnd: () => unknown) => {
      arrived = false; // たどっている間に河口の地名が届いても、見出しを結論にしない
      this.timeline.clear();
      this.startJourney("ここに降った雨は…");
      this.follow(
        "route",
        path,
        alive,
        (k) => {
          reached = k;
          this.advance("downstream", path.pts, k);
          reveal(k);
          this.showProgress(path, k, "route");
        },
        onEnd,
      );
    };
    const finish = () =>
      mouthReady.then(() => {
        if (!alive()) return;
        arrived = true;
        this.showArrival(path, mouth ?? null, !up);
        this.showSummary(path, originPlace, { g, s }, alive);
        this.replay.route = () =>
          descend(() => {
            arrived = true;
            this.showArrival(path, mouth ?? null);
            this.scrollToActions();
          });
        // 大きな川では、さかのぼり専用の粗い範囲を先に読んでおく（押されたときに待たせない）。
        // 集水域を数えるのに数十 ms かかるので、着地の動きを止めないよう、カメラが着地し終えてから始める
        if (up) this.upButton?.click();
        else
          this.camera?.landed.then(() => {
            if (alive() && this.showing === "route") prefetchBasin({ g, s });
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
    // 別の道のりの線は、ここでは伸びていかないので消す（合流点・支流・ダムの印は reveal() 側で出し直す）
    setData(this.map, kind === "route" ? "upstream" : "downstream");
    // 「上流へさかのぼる」「下流へくだる」は、今見ていない方だけ出す
    if (this.upButton) this.upButton.hidden = kind !== "route";
    if (this.downButton) this.downButton.hidden = kind !== "source";
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

  /** 雨粒が動き出す前の見出し。下るときもさかのぼるときも、結論が出るまでは同じ見た目（黒い見出しと進み具合のバー） */
  private startJourney(headline: string) {
    delete this.ui.journey.dataset.arrived;
    this.ui.share.hidden = true; // 共有はアクションボタンと一緒に、着いてから出す（conclude で）
    this.ui.headline.textContent = headline;
    this.ui.progress.replaceChildren();
    this.ui.bar.style.transform = "scaleX(0)";
  }

  /**
   * 旅の見出しに進み具合（距離・所要時間・今いる川）を出す。
   * さかのぼるときは「12.3 km上流・約3時間前」のように、上流への距離と何時間前の雨かで書く
   */
  private showProgress(
    line: Pick<Path, "dist" | "rivers">,
    k: number,
    kind: Trail,
  ) {
    const d = line.dist[k];
    const total = line.dist[line.dist.length - 1];
    const river = line.rivers.findLast((r) => r.step <= k)?.name;
    const up = kind === "source";
    this.ui.bar.style.transform = `scaleX(${total > 0 ? d / total : 1})`;
    this.ui.progress.replaceChildren(
      el("b", { textContent: up ? `${km(d)}上流` : km(d) }),
      ...(d > 0 ? [`・${eta(d)}${up ? "前" : ""}`] : []),
      ...(river ? [`　${river}`] : []),
    );
  }

  /**
   * 到着したら、見出しを結論（どの海に・どれだけかけて・どこの河口から）に切り替える。
   * announce: 読み上げるか（河口の地名を後から書き足すときは読み上げ直さない）
   */
  private showArrival(path: Path, mouth: Mouth | null, announce = true) {
    const total = path.dist[path.dist.length - 1];
    this.conclude(
      path.toSea
        ? `${mouth?.sea ?? "海"}にたどり着きました`
        : "河口まで追いきれませんでした",
      `${km(total)}・${eta(total)}`,
      mouth?.name,
      announce && `${km(total)}、${eta(total)}`,
    );
  }

  /** さかのぼりが終わったら、見出しを結論（水源に着いた・どれだけ上流か）に切り替えて読み上げる */
  private showSourceArrival(src: SourcePath) {
    const total = src.dist[src.dist.length - 1];
    this.conclude(
      src.cut ? "水源まで追いきれませんでした" : "水源にたどり着きました",
      `${km(total)}上流・${eta(total)}前`,
      null,
      `${km(total)}上流、${eta(total)}前`,
    );
  }

  /**
   * 見出しを結論に切り替える（雨の通り道・水の来た道で共通）。
   * where: 2行目に添える地名。spoken: 読み上げる距離の言い方（false なら読み上げない）
   */
  private conclude(
    headline: string,
    distance: string,
    where: string | null | undefined,
    spoken: string | false,
  ) {
    this.ui.journey.dataset.arrived = "";
    this.ui.headline.textContent = headline;
    this.ui.progress.replaceChildren(
      el("b", { textContent: distance }),
      ...(where ? [el("br"), where] : []),
    );
    // 共有はアクションボタンと一緒に、着いたときだけ出す（さかのぼっている間は隠す）
    this.ui.share.hidden = false;
    if (spoken === false) return;
    this.ui.announce.textContent = [headline, spoken, where]
      .filter(Boolean)
      .join("。");
  }

  /** クリック地点の集水域を地図に塗る（数値は流域サマリで見る） */
  private showBasin(
    g: Grid,
    s: number,
    alive: () => boolean,
    up = upstream(g.down, g.order, s),
  ) {
    const fill = pixel("--color-basin", 0xa8);
    const rect = maskRect(g, up);
    if (rect)
      paint(g, (c) => (up[c] ? fill : 0), rect).then((img) => {
        if (alive()) setImage(this.map, "basin", img, { fade: true });
        else URL.revokeObjectURL(img.url);
      });
  }

  private resetPanel(origin: string) {
    this.openPanel(origin);
    delete this.ui.journey.dataset.loading;
    this.startJourney("ここに降った雨は…");
  }

  private showSummary(
    path: Path,
    originPlace: Promise<Place | null>,
    from: { g: Grid; s: number },
    alive: () => boolean,
  ) {
    const up = button("secondary", "上流へさかのぼる", () =>
      this.playSource(from, originPlace, alive),
    );
    // 雨の通り道は name で束ねてあるので、開けば水の来た道は閉じる
    const down = button("secondary", "下流へくだる", () => {
      this.ui.route.open = true;
    });
    down.hidden = true;
    this.upButton = up;
    this.downButton = down;
    this.ui.summary.replaceChildren(
      ...(path.toSea
        ? []
        : [
            el("p", {
              className: "note",
              textContent:
                "この先の地形を読み込めず、河口まで追えませんでした。",
            }),
          ]),
      up,
      down,
      karteButton(path, originPlace, from),
    );
    this.ui.summary.hidden = false;
    this.scrollToActions();
  }

  /**
   * まとめ（さかのぼる・くだる・流域サマリのボタンと共有リンク）の頭が、貼り付いた旅の見出しのすぐ下に来るまでスクロールする。
   * 一番下まで送ると、スマホ（パネルが画面の半分）ではボタンが上に押し出されて見切れるので、末尾でなく先頭に合わせる。
   * 河口に着いたときも水源に着いたときも同じボタンの並びなので共通の位置に合わせる
   * （呼ぶ時点でまだ高さが反映されていないことがあるので描画後に）
   */
  private scrollToActions() {
    const panel = this.ui.panel;
    requestAnimationFrame(() =>
      panel.scrollTo({
        top: this.ui.summary.offsetTop - this.ui.journey.offsetHeight,
        behavior: reducedMotion() ? "auto" : "smooth",
      }),
    );
  }

  /**
   * クリック地点から、支流の先の先までたどっていちばん遠い水源へさかのぼる。道のりの線をクリック地点から上流へ伸ばし、
   * 通る川・流れ込む支流・地区を「水の来た道」に並べる。河口に着いてから呼ぶ（同じ再生の alive を使う）
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
    this.startJourney("水源へさかのぼっています");
    this.ui.progress.textContent = "上流の地形を読み込み中…";
    // 待っている間は押せないようにする（押し直すたびに読み込み中の表示に戻らないように）。
    // 戻すのは始めたときのボタン（待つ間に別の地点を選ぶと、this.upButton は新しいボタンを指す）
    const up = this.upButton;
    if (up) up.disabled = true;
    const basin = await basinAt(from, (text) => {
      if (alive()) this.ui.progress.textContent = text;
    });
    if (up) up.disabled = false;
    // 待つ間に「雨の通り道」を開き直して下り直していたら、さかのぼりで割り込まない
    if (!alive() || !basin || this.showing !== "source") return;
    // クリック時の塗りは雨をたどった範囲の中だけなので、より広い範囲で数え直せたら塗り直す
    if (basin.g !== from.g) this.showBasin(basin.g, basin.s, alive, basin.up);
    const src = traceToSource(basin.g, basin.s, basin.truncated);
    const n = src.pts.length;
    this.ui.route.open = false; // 下る旅はたたみ、さかのぼる道のりに目を移す
    this.ui.source.hidden = false;
    this.ui.source.open = true;

    let origin: Place | null = null;
    let places: PlaceEvent[] = [];
    // 水源の地区（未着なら undefined のまま「水源」と出す）
    let sourcePlace: Place | null | undefined;
    let dams: DamOnPath[] = [];
    let reached = -1;
    const reveal = (k: number) => {
      if (!alive()) return;
      const events = sourceEvents(
        src,
        places,
        origin,
        sourcePlace,
        dams,
      ).filter((ev) => ev.step <= k);
      this.sourceTimeline.add(events);
      this.showConfluences(events, src.pts);
    };
    originPlace.then((p) => {
      origin = p;
    });
    if (!src.cut)
      place(src.pts[n - 1]).then((p) => {
        if (!alive()) return;
        sourcePlace = p;
        reveal(reached);
      });
    // さかのぼる道のり沿いのダム・堰（読めなければ出さないだけ）
    damsAlong(src.pts)
      .then((list) => {
        dams = list;
        reveal(reached);
      })
      .catch(() => {});
    // 本筋は1本の川のことが多いので、支流の合流点でも区切って地区を引く
    const cuts = [
      ...src.rivers,
      ...src.tributaries.map((t) => ({ ...t, km: 0 })),
    ].sort((a, b) => a.step - b.step);
    placesAlong(
      { ...src, rivers: cuts },
      () => !alive(),
      (list) => {
        places = list;
        reveal(reached);
      },
    );

    /** 水源へさかのぼる。開き直したときも最初と同じように、見出し・時系列・進み具合を出し直してたどる */
    const climb = () => {
      this.sourceTimeline.clear();
      this.ui.sourceNote.replaceChildren();
      this.startJourney("水源へさかのぼっています");
      this.follow(
        "source",
        src,
        alive,
        (k) => {
          reached = k;
          // 雨粒の印も一緒にさかのぼらせ、河口と同じように水源に印が残るようにする
          this.advance("upstream", src.pts, k);
          reveal(k);
          this.showProgress(src, k, "source");
        },
        () => {
          this.showSourceArrival(src);
          this.showSourceNote(basin, src);
          this.scrollToActions();
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
    this.ui.announce.textContent = text;
    setTimeout(() => popup.remove(), 2500);
  }
}

/** パネルの2つの道のり（雨の通り道・水の来た道） */
export type Trail = "route" | "source";

/** これより狭い集水域は「小さな水路」として、近くの雨がほとんどだと添える */
const SMALL_BASIN_KM2 = 10;
/** 水源とクリック地点の高低差がこれ未満なら平地とみなす */
const FLAT_RELIEF_M = 30;

/** 集水域の流域サマリ（面積・土地・人口・降水量・ダム）を開くボタン */
function karteButton(
  path: Path,
  originPlace: Promise<Place | null>,
  from: { g: Grid; s: number },
) {
  // 出発点が名前のある川の上なら、その川の名前を見出しにする
  const river = path.rivers[0]?.step === 0 ? path.rivers[0].name : undefined;
  const down = { m: path.dist[path.dist.length - 1], toSea: path.toSea };
  return button("primary", "流域サマリを見る", () =>
    openKarte(from, river, originPlace, down, path.pts),
  );
}

function button(
  variant: "primary" | "secondary",
  text: string,
  onClick: () => void,
) {
  const btn = el("button", {
    type: "button",
    className: `button button--${variant}`,
    textContent: text,
  });
  btn.addEventListener("click", onClick);
  return btn;
}

/**
 * 河口の住所。河口は川幅の広い水面で住所が返らないことが多いので、
 * 海に入る直前・約0.5km・1km・2km・4km 手前と上流へさかのぼって探す。alive() でなくなったらやめる
 */
async function placeNearMouth(path: Path, alive: () => boolean) {
  const n = path.pts.length;
  const total = path.dist[n - 1];
  for (const back of [0, 500, 1000, 2000, 4000]) {
    const i =
      back === 0
        ? Math.max(0, n - 2)
        : path.dist.findLastIndex((d) => d <= total - back);
    if (i < 0 || !alive()) break;
    const p = await place(path.pts[i]);
    if (p?.muni) return p;
  }
  return null;
}
