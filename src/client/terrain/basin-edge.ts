/**
 * 集水域が計算範囲の端まで届いているか。
 * route は端のセルを出口にするので、集水域は端の1つ内側までしか広がらない。1つ内側に届いた時点で、
 * 本当の集水域は範囲の外に続いていると見なす
 */
export function touchesEdge(g: { W: number; H: number }, up: Uint8Array) {
  const { W, H } = g;
  const rows = [0, 1, H - 2, H - 1];
  const cols = [0, 1, W - 2, W - 1];
  for (const y of rows)
    for (let x = 0; x < W; x++) if (up[y * W + x]) return true;
  for (const x of cols)
    for (let y = 0; y < H; y++) if (up[y * W + x]) return true;
  return false;
}

/** 最初の候補に比べてこれより集水域が小さい候補は、吸着し直しで別の沢に乗ったものと見なす */
const SAME_RIVER_SHARE = 0.5;

/**
 * 候補の範囲から、集水域が収まる最初のものを選ぶ。最初の候補は雨をたどったグリッド、以降は吸着し直した別のグリッド。
 * 吸着し直しで別の小さな沢に乗った候補は除く。どれにも収まらなければ、集水域がいちばん広く数えられた候補
 * （いちばん遠くまでたどれる）を返す
 */
export function pickBasin<T extends { truncated: boolean; km2: number }>(
  candidates: T[],
): T | null {
  const ref = candidates[0]?.km2 ?? 0;
  let best: T | null = null;
  for (const c of candidates) {
    if (c.km2 < ref * SAME_RIVER_SHARE) continue;
    if (!c.truncated) return c;
    if (!best || c.km2 > best.km2) best = c;
  }
  return best;
}
