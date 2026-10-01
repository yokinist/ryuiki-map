// 地名の格子（public/places/）の引き方。1次メッシュ（経度1°×緯度40′）を grid×grid のマスに割り、
// マスの中心が入る町丁・字等の番号を、行ごとのランレングスで持つ。作る側（scripts/build-places.ts）と共通

/** 地点が入る1次メッシュと、その中のマス（列 i は西から、行 j は南から） */
export function cellOf(lon: number, lat: number, grid: number) {
  const y = lat * 1.5;
  const x = lon - 100;
  const p = Math.floor(y);
  const u = Math.floor(x);
  return {
    m1: p * 100 + u,
    i: Math.min(grid - 1, Math.floor((x - u) * grid)),
    j: Math.min(grid - 1, Math.floor((y - p) * grid)),
  };
}

/** 1行を [値, 続く数, 値, 続く数, …] に縮める */
export function rle(row: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < row.length; i++) {
    if (out.length && out[out.length - 2] === row[i]) out[out.length - 1]++;
    else out.push(row[i], 1);
  }
  return out;
}

/** 縮めた行の、列 i の値 */
export function runAt(runs: number[], i: number): number {
  let end = 0;
  for (let k = 0; k < runs.length; k += 2) {
    end += runs[k + 1];
    if (i < end) return runs[k];
  }
  return 0;
}

/**
 * マス (i, j) の周り r マス以内に入っている番号（0 は除き、小さい順）。row(j) は行 j を広げた配列（読めなければ undefined）。
 * 境界の川に沿って流れる道のりで、岸を行き来するたびに地名が変わらないよう、近くの候補をまとめて見るのに使う
 */
export function areasNear(
  row: (j: number) => ArrayLike<number> | undefined,
  i: number,
  j: number,
  r: number,
  grid: number,
): number[] {
  const found = new Set<number>();
  for (let y = Math.max(0, j - r); y <= Math.min(grid - 1, j + r); y++) {
    const cells = row(y);
    if (!cells) continue;
    for (let x = Math.max(0, i - r); x <= Math.min(grid - 1, i + r); x++)
      if (cells[x]) found.add(cells[x]);
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * マス (i, j) を囲む輪を1マスずつ広げ（r マスまで）、accept に合う番号を探す。なければ 0。
 * 同じ輪の中は南の行の西から見て最初のもの（輪の角も辺の真ん中も同じ近さとみなす。河口の地名には足りる）
 */
export function nearestArea(
  row: (j: number) => ArrayLike<number> | undefined,
  i: number,
  j: number,
  r: number,
  grid: number,
  accept: (k: number) => boolean,
): number {
  for (let d = 0; d <= r; d++)
    for (let y = Math.max(0, j - d); y <= Math.min(grid - 1, j + d); y++) {
      const cells = row(y);
      if (!cells) continue;
      // 輪の上のマスだけを見る（内側は前の d で見た）
      const step = y === j - d || y === j + d ? 1 : 2 * d || 1;
      for (let x = i - d; x <= i + d; x += step)
        if (x >= 0 && x < grid && cells[x] && accept(cells[x])) return cells[x];
    }
  return 0;
}
