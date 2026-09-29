/** さかのぼり専用の粗い範囲を読み直す回数の上限 */
export const WIDEN_TRIES = 3;

/**
 * 切れた集水域を、切れた辺へ広げて読み直しながら数え直す（信濃川は南を広げると、次は西の梓川で切れる）。
 * load: いまの結果から次の範囲を読んで数えた候補。読めなければ null。
 * current: まだこの地点を聞かれているか。別の地点に移ったら、次を読まずに打ち切る。
 * complete: 最後まで試した（読めなかった・打ち切ったときは false。呼び出し側は覚えずに、次に聞かれたら読み直す）
 */
export async function widenBasin<C extends { km2: number; truncated: boolean }>(
  loaded: C,
  opts: { load: (best: C) => Promise<C | null>; current: () => boolean },
): Promise<{ basin: C; complete: boolean }> {
  let best = loaded;
  for (let i = 0; i < WIDEN_TRIES && best.truncated; i++) {
    if (!opts.current()) return { basin: best, complete: false };
    const wide = await opts.load(best);
    if (!wide) return { basin: best, complete: false };
    if (wide.km2 <= best.km2) break; // 広げても増えない（読み直しても変わらない）
    best = wide;
  }
  return { basin: best, complete: true };
}
