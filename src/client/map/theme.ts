// 色の定義は styles/tokens.css に一本化し、地図の描画でも CSS 変数から読む

/** tokens.css の CSS 変数の値 */
export const token = (name: `--${string}`) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** 色トークン (#rrggbb) の [r, g, b] */
const rgb = (name: `--color-${string}`) => {
  const hex = token(name).replace("#", "");
  return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
};

/** 色トークンを canvas の Uint32 ピクセル（リトルエンディアンの ABGR）に */
export function pixel(name: `--color-${string}`, alpha: number): number {
  const [r, g, b] = rgb(name);
  return ((alpha << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/** 色トークンを MapLibre の色（rgba）に。alpha は 0〜1 */
export function rgba(name: `--color-${string}`, alpha: number) {
  const [r, g, b] = rgb(name);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 時間のトークン（"900ms"）をミリ秒の数に */
export const tokenMs = (name: `--duration-${string}`) =>
  Number.parseFloat(token(name));
