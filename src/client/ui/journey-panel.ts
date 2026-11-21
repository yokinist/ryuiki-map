// パネルの旅の見出し（見出し・進み具合のバー・結論・出発点）。雨の通り道・水の来た道で共通
import type { Path } from "../terrain/trace";
import { el } from "./dom";
import { eta, km } from "./format";
import type { Mouth, SourcePath } from "./timeline";
import type { Trail } from "./trail-state";

export interface JourneyUi {
  journey: HTMLElement;
  origin: HTMLElement;
  headline: HTMLElement;
  progress: HTMLElement;
  bar: HTMLElement;
  /** 読み上げ専用の領域（aria-live） */
  announce: HTMLElement;
  share: HTMLElement;
}

export class JourneyPanel {
  /** 出発点の説明（「出発点：」を付ける前の文字列） */
  private originText = "";
  /** 出発点の地名（標高の説明を除いたもの）。まだ分からなければ空 */
  private place = "";
  /** 着いたときの結論。共有したときにプレビュー用に預ける。たどっている間は null */
  private conclusion: {
    headline: string;
    distance: string;
    where: string | null;
  } | null = null;

  constructor(private readonly ui: JourneyUi) {}

  /** 地形の読み込みや流路の計算を待つ間の見出し。text は進み具合 */
  searching(text: string) {
    this.ui.journey.dataset.loading = "";
    this.ui.headline.textContent = "雨の流れをたどっています";
    this.ui.announce.textContent = "雨の流れをたどっています";
    this.ui.bar.style.transform = "";
    this.ui.progress.textContent = text;
  }

  /** 調べている最中か（進み具合を見出しに出すか、状態表示に出すか） */
  get isSearching() {
    return this.ui.journey.dataset.loading !== undefined;
  }

  /** 見出しの2行目を文字だけにする（読み込み中の進み具合など） */
  say(text: string) {
    this.ui.progress.textContent = text;
  }

  /** 前の雨の結論と共有を消し、出発点を出し直す */
  reset(origin: string) {
    this.place = "";
    this.ui.share.hidden = true;
    delete this.ui.journey.dataset.arrived;
    this.setOrigin(origin);
  }

  /** 調べ終えて、雨粒が動き出す前の見出しにする */
  found() {
    delete this.ui.journey.dataset.loading;
    this.start("ここに降った雨は…");
  }

  /**
   * クリックした出発点の説明を出す。水源など他の地点と混同しないよう「出発点：」を付ける
   * （調べている最中は何も付けない。空にするときも使う）
   */
  setOrigin(text: string) {
    this.originText = text;
    this.ui.origin.textContent = text ? `出発点：${text}` : "";
  }

  /** 地名が後から届いたときに、標高の説明の前に書き足す */
  prependOrigin(text: string) {
    this.place = text;
    this.setOrigin(`${text}・${this.originText}`);
  }

  /** 雨粒が動き出す前の見出し。下るときもさかのぼるときも、結論が出るまでは同じ見た目（黒い見出しと進み具合のバー） */
  start(headline: string) {
    this.conclusion = null;
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
  progress(line: Pick<Path, "dist" | "rivers">, k: number, kind: Trail) {
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
  arrive(path: Path, mouth: Mouth | null, announce = true) {
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
  arriveSource(src: SourcePath) {
    const total = src.dist[src.dist.length - 1];
    this.conclude(
      src.cut ? "水源まで追いきれませんでした" : "水源にたどり着きました",
      `${km(total)}上流・${eta(total)}前`,
      null,
      `${km(total)}上流、${eta(total)}前`,
    );
  }

  /** 画面に出ている結論（出発点の地名と、見出し・距離・河口の地名）。着いていないか地名が分からなければ null */
  get summary() {
    return this.conclusion && this.place
      ? { origin: this.place, ...this.conclusion }
      : null;
  }

  /** 読み上げる（地図上の吹き出しなど、見出しの外の知らせ） */
  announce(text: string) {
    this.ui.announce.textContent = text;
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
    this.conclusion = { headline, distance, where: where ?? null };
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
}
