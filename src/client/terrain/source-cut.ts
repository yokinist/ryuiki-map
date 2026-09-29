/**
 * さかのぼりが水源まで追いきれなかったか。
 * 最後の点が範囲の端にあるときのほか、集水域が範囲からはみ出しているときも追いきれていない
 * （本流が端で切れると、範囲に収まっている支流のほうが遠く見えて、その先を水源に選んでしまう）
 */
export function isSourceCut(
  g: { W: number; H: number },
  last: number,
  truncated: boolean,
) {
  const x = last % g.W;
  const y = (last / g.W) | 0;
  return truncated || x === 0 || y === 0 || x === g.W - 1 || y === g.H - 1;
}
