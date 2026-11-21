// 地名の検索欄。打つたびに候補を出し、選んだら onPick に渡す（WAI-ARIA の combobox）
import { type SearchHit, searchPlaces } from "../data/place-search";
import { searchIndex } from "../data/places";
import { $, el } from "./dom";

export function setupSearch(onPick: (hit: SearchHit) => void) {
  const input = $<HTMLInputElement>("search-input");
  const list = $<HTMLDivElement>("search-list");
  let hits: SearchHit[] = [];
  let active = -1;
  let note = "";

  const render = () => {
    list.replaceChildren(
      ...hits.map((h, i) => {
        const option = el("div", {
          id: `search-${i}`,
          className: "search__option",
          role: "option",
          ariaSelected: String(i === active),
          textContent: h.label,
        });
        option.addEventListener("click", () => pick(i));
        return option;
      }),
      ...(note
        ? [el("div", { className: "search__note", textContent: note })]
        : []),
    );
    list.hidden = !hits.length && !note;
    input.ariaExpanded = String(!list.hidden);
    if (active >= 0)
      input.setAttribute("aria-activedescendant", `search-${active}`);
    else input.removeAttribute("aria-activedescendant");
    list
      .querySelector(`#search-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  };
  const close = () => {
    hits = [];
    active = -1;
    note = "";
    render();
  };
  const pick = (i: number) => {
    const hit = hits[i];
    if (!hit) return;
    input.value = hit.label;
    close();
    // スマホではキーボードを閉じ、移った先の地図が隠れないようにする
    if (matchMedia("(pointer: coarse)").matches) input.blur();
    onPick(hit);
  };

  // 候補やスクロールバーを押した瞬間に入力欄のフォーカスが外れて、候補が消えないように
  list.addEventListener("pointerdown", (e) => e.preventDefault());

  let typed = 0;
  input.addEventListener("input", async () => {
    const id = ++typed;
    const q = input.value;
    if (!q.trim()) return close();
    note = "地名を読み込み中…";
    hits = [];
    render();
    const index = await searchIndex().catch(() => null);
    if (id !== typed) return; // 読み込みを待つ間に打ち直された
    hits = index ? searchPlaces(index.rows, index.cities, q) : [];
    active = hits.length ? 0 : -1;
    note = !index
      ? "地名を読み込めませんでした"
      : hits.length
        ? ""
        : "見つかりませんでした";
    render();
  });
  input.addEventListener("keydown", (e) => {
    if (e.isComposing) return; // 変換の確定の Enter は候補の選択にしない
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!hits.length) return;
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      active = (active + step + hits.length) % hits.length;
      render();
    } else if (e.key === "Enter") {
      if (!hits.length) return;
      e.preventDefault();
      pick(Math.max(active, 0));
    } else if (e.key === "Escape") close();
  });
  input.addEventListener("blur", close);
  // 約2MB あるので、ページを開いたときではなく、検索欄に触れたときに読み始める
  input.addEventListener("focus", () => void searchIndex().catch(() => {}));
}
