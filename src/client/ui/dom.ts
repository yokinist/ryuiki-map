export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e as T;
}

/** 要素を作る小さなヘルパー。テキストは textContent / 文字列の子で入れる（innerHTML は使わない） */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

/** 「？」ボタンと、押すと開閉する説明の行 */
export function helpButtonAndText(
  label: string,
  help: string,
): [HTMLButtonElement, HTMLElement] {
  const text = el("p", {
    className: "help__text",
    hidden: true,
    textContent: help,
  });
  const btn = el(
    "button",
    {
      type: "button",
      className: "help",
      ariaLabel: `${label}とは`,
      ariaExpanded: "false",
    },
    "?",
  );
  btn.addEventListener("click", (e) => {
    e.preventDefault(); // <summary> の中に置いても開閉ボタンとして働かせ、詳細欄自体は開閉させない
    text.hidden = !text.hidden;
    btn.ariaExpanded = String(!text.hidden);
  });
  return [btn, text];
}
