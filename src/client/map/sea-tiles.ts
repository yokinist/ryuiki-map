/** 無いタイルの一覧（hill-missing.json）を作ったズームの範囲。変えたら pnpm build:hill で作り直す */
export const HILL_INDEX_MIN_Z = 2;
export const HILL_INDEX_MAX_Z = 10;

/**
 * 陰影起伏図のタイル z/x/y が無い（海だけ）と分かっているか。親が無ければ子も無いので、祖先をたどって調べる。
 * 一覧より細かいズームの海岸沿いは分からないので false（問い合わせる）
 */
export function isMissingTile(
  missing: ReadonlySet<string>,
  z: number,
  x: number,
  y: number,
) {
  for (let zz = Math.min(z, HILL_INDEX_MAX_Z); zz >= HILL_INDEX_MIN_Z; zz--) {
    const d = z - zz;
    if (missing.has(`${zz}/${x >> d}/${y >> d}`)) return true;
  }
  return false;
}
