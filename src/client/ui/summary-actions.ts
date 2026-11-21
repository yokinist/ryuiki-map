// 着いたあとのボタン（上流へさかのぼる・下流へくだる・流域サマリを見る）。共有ボタンは JourneyPanel が出し分ける
import type { Place } from "../data/places";
import type { Grid } from "../terrain/grid";
import type { Path } from "../terrain/trace";
import { el } from "./dom";
import { openKarte } from "./karte";
import { reducedMotion } from "./motion";

export interface SummaryUi {
  panel: HTMLElement;
  /** 貼り付く旅の見出し。ボタンの頭をこのすぐ下に合わせる */
  journey: HTMLElement;
  summary: HTMLElement;
  /** 雨の通り道の欄。開けば水の来た道は閉じる（name で束ねてある） */
  route: HTMLDetailsElement;
}

export class SummaryActions {
  /** 「上流へさかのぼる」「下流へくだる」。今見ている方でない側だけ出す */
  private upButton: HTMLButtonElement | null = null;
  private downButton: HTMLButtonElement | null = null;

  constructor(private readonly ui: SummaryUi) {}

  /** 今の「上流へさかのぼる」ボタン（別の地点を選ぶと作り直すので、呼んだ時点のものを指す） */
  get up() {
    return this.upButton;
  }

  hide() {
    this.ui.summary.hidden = true;
  }

  /** 河口に着いたら、ボタンを並べて見えるところまでスクロールする。onUp は「上流へさかのぼる」 */
  show(
    path: Path,
    originPlace: Promise<Place | null>,
    from: { g: Grid; s: number },
    onUp: () => void,
  ) {
    const up = button("secondary", "上流へさかのぼる", onUp);
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
    this.scrollTo();
  }

  /** 見ている道のりに合わせて「上流へさかのぼる」「下流へくだる」を出し分ける（trailView の showUp・showDown） */
  showFor({ showUp, showDown }: { showUp: boolean; showDown: boolean }) {
    if (this.upButton) this.upButton.hidden = !showUp;
    if (this.downButton) this.downButton.hidden = !showDown;
  }

  /**
   * まとめ（さかのぼる・くだる・流域サマリのボタンと共有リンク）の頭が、貼り付いた旅の見出しのすぐ下に来るまでスクロールする。
   * 一番下まで送ると、スマホ（パネルが画面の半分）ではボタンが上に押し出されて見切れるので、末尾でなく先頭に合わせる。
   * 河口に着いたときも水源に着いたときも同じボタンの並びなので共通の位置に合わせる
   * （呼ぶ時点でまだ高さが反映されていないことがあるので描画後に）
   */
  scrollTo() {
    const panel = this.ui.panel;
    requestAnimationFrame(() =>
      panel.scrollTo({
        top: this.ui.summary.offsetTop - this.ui.journey.offsetHeight,
        behavior: reducedMotion() ? "auto" : "smooth",
      }),
    );
  }
}

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
    openKarte(from, river, originPlace, down, path),
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
