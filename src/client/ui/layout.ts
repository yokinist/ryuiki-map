export interface Padding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** 雨粒を映す範囲として、縦横それぞれ最低限残す大きさ px */
export const MIN_FREE_PX = 200;

/**
 * 余白を取りすぎて地図を映す範囲がなくならないよう、縦横それぞれ MIN_FREE_PX は残す
 * （パネルが画面の半分を覆うスマホ、特に横向き）。先に second（出典表示や右端の余白）を削り、足りなければ first（パネル側）を削る
 */
export function fitPadding(p: Padding, width: number, height: number): Padding {
  const [top, bottom] = trim(p.top, p.bottom, height);
  const [left, right] = trim(p.left, p.right, width);
  return { top, bottom, left, right };
}

function trim(first: number, second: number, size: number): [number, number] {
  const over = first + second - Math.max(0, size - MIN_FREE_PX);
  if (over <= 0) return [first, second];
  const cut = Math.min(second, over);
  return [Math.max(0, first - (over - cut)), second - cut];
}
