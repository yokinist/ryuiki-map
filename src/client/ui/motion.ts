// 雨粒の動き。流路の点は計算範囲によって間隔（約16m〜130m）が違うので、点の数ではなく距離で進める

/** OS の「視差効果を減らす」などの設定 */
export const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 動き始めと到着前をゆるやかにする（0〜1 → 0〜1） */
export const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/** 累積距離 dist（昇順）で、距離 d までに通り過ぎた最後の点の添字 */
export function indexAtDistance(dist: number[], d: number): number {
  let lo = 0;
  let hi = dist.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (dist[mid] <= d) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 流路の長さに応じた再生時間 ms。短い旅は短く、長い旅でも10秒まで */
export const playDuration = (totalM: number) =>
  Math.min(10_000, 2500 + (totalM / 1000) * 20);
