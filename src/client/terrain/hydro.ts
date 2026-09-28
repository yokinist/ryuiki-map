export interface Routed {
  /** 下流側のセル。-1 は出口（海・範囲の端） */
  down: Int32Array;
  /** 取り出し順。どのセルも下流側のセルより後に来る（トポロジカル順） */
  order: Int32Array;
  /** 集水セル数（自分を含む上流の陸セル数） */
  acc: Float32Array;
}

/**
 * W×H グリッドの D8 流向。elev の NaN は海。
 * Priority-flood (Barnes et al. 2014): 海とグリッドの端から内側へ広げるので、窪地は埋められ、
 * すべての陸セルが出口までの下流経路を持つ。埋められた範囲の中の道筋は、元の標高が低いセルを優先してつなぐ。
 */
export function route(elev: Float32Array, W: number, H: number): Routed {
  const N = W * H;
  const down = new Int32Array(N).fill(-1);
  const order = new Int32Array(N);
  const acc = new Float32Array(N);
  const key = new Float64Array(N);
  const seq = new Uint32Array(N);
  const heap = new Int32Array(N);
  const seen = new Uint8Array(N);
  let n = 0;
  let s = 0;
  let k = 0;
  // 同じ高さ（窪地が埋められて平らになった範囲を含む）の中では、
  // 1. 元の標高が低いセルから先に取り出す。平らに埋められても、深く焼き込んだ本流の川筋が道筋になり、
  //    河口が砂州でふさがっている場合やダム湖の手前などで、並行する支流に流れが逸れない
  // 2. それも同じなら先着順。平坦地はジグザグせず出口から幅優先で流れる
  const low = (a: number, b: number) => elev[a] < elev[b]; // 海 (NaN) どうしは常に false で、先着順になる
  const less = (a: number, b: number) =>
    key[a] < key[b] ||
    (key[a] === key[b] && (low(a, b) || (!low(b, a) && seq[a] < seq[b])));
  const push = (c: number, z: number) => {
    seen[c] = 1;
    key[c] = z;
    seq[c] = s++;
    let i = n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(c, heap[p])) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = c;
  };
  const pop = () => {
    const top = heap[0];
    const last = heap[--n];
    let i = 0;
    for (;;) {
      let m = 2 * i + 1;
      if (m >= n) break;
      if (m + 1 < n && less(heap[m + 1], heap[m])) m++;
      if (!less(heap[m], last)) break;
      heap[i] = heap[m];
      i = m;
    }
    heap[i] = last;
    return top;
  };

  // 海のセルは出口。キューには入れず（海岸の範囲では半分近くが海で、出し入れの手間が大きい）、
  // 海に接する陸のセルとグリッドの端のセルだけを最初に入れる
  for (let c = 0; c < N; c++) {
    if (!Number.isNaN(elev[c])) continue;
    seen[c] = 1;
    order[k++] = c;
  }
  for (let c = 0; c < N; c++) {
    if (seen[c]) continue;
    const x = c % W;
    const y = (c / W) | 0;
    let sea = -1;
    for (let dy = -1; dy <= 1 && sea < 0; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const m = ny * W + nx;
        if (Number.isNaN(elev[m])) {
          sea = m;
          break;
        }
      }
    if (sea >= 0) {
      down[c] = sea;
      push(c, elev[c]);
    } else if (x === 0 || y === 0 || x === W - 1 || y === H - 1)
      push(c, elev[c]);
  }
  while (n) {
    const c = pop();
    order[k++] = c;
    const x = c % W;
    const y = (c / W) | 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const m = ny * W + nx;
        if (seen[m]) continue;
        down[m] = c;
        push(m, Math.max(elev[m], key[c]));
      }
  }
  // 陸セルの集水数を上流から順に足し込む。海には足さない（海岸近くのクリックが海に吸着しないように）
  for (let i = N - 1; i >= 0; i--) {
    const c = order[i];
    if (Number.isNaN(elev[c])) continue;
    acc[c] += 1;
    if (down[c] >= 0 && !Number.isNaN(elev[down[c]])) acc[down[c]] += acc[c];
  }
  return { down, order, acc };
}

/** セル s の集水域を 0/1 マスクで返す。トポロジカル順に1回なめるだけ */
export function upstream(
  down: Int32Array,
  order: Int32Array,
  s: number,
): Uint8Array {
  const m = new Uint8Array(down.length);
  m[s] = 1;
  for (const c of order) if (down[c] >= 0 && m[down[c]]) m[c] = 1;
  return m;
}

/** p に流れ込む隣のセル */
function inflows(down: Int32Array, W: number, H: number, p: number) {
  const x = p % W;
  const y = (p / W) | 0;
  const out: number[] = [];
  for (let j = Math.max(0, y - 1); j <= Math.min(H - 1, y + 1); j++)
    for (let i = Math.max(0, x - 1); i <= Math.min(W - 1, x + 1); i++)
      if (down[j * W + i] === p) out.push(j * W + i);
  return out;
}

/** s から、流れ込む中で集水数の一番大きいセルを選び続けて水源までさかのぼる（s が先頭） */
export function mainStem(
  down: Int32Array,
  acc: Float32Array,
  W: number,
  H: number,
  s: number,
): number[] {
  const stem = [s];
  for (;;) {
    const up = inflows(down, W, H, stem[stem.length - 1]);
    if (!up.length) return stem;
    stem.push(up.reduce((a, b) => (acc[b] > acc[a] ? b : a)));
  }
}

/** s から、いちばん遠い水源に続く流れを選んでさかのぼる（s が先頭）。距離は斜めを √2 セルとして測る */
export function farthestStem(
  down: Int32Array,
  order: Int32Array,
  W: number,
  s: number,
): number[] {
  // 上流から順に「そこより上流のいちばん遠い水源までの長さ」を下流へ渡し、どの流れから来たかを覚える
  const len = new Float64Array(down.length);
  const from = new Int32Array(down.length).fill(-1);
  for (let i = order.length - 1; i >= 0; i--) {
    const c = order[i];
    const d = down[c];
    if (d < 0) continue;
    const diagonal = c % W !== d % W && ((c / W) | 0) !== ((d / W) | 0);
    const v = len[c] + (diagonal ? Math.SQRT2 : 1);
    if (v > len[d]) {
      len[d] = v;
      from[d] = c;
    }
  }
  const stem = [s];
  while (from[stem[stem.length - 1]] >= 0)
    stem.push(from[stem[stem.length - 1]]);
  return stem;
}

/**
 * 本筋 stem に脇から流れ込むセルのうち、集水数が minAcc 以上で、かつ合流点の本筋の集水数の minShare 以上のもの。
 * step は stem の添字
 */
export function tributaries(
  down: Int32Array,
  acc: Float32Array,
  W: number,
  H: number,
  stem: number[],
  minAcc: number,
  minShare = 0,
): { step: number; cell: number }[] {
  const out: { step: number; cell: number }[] = [];
  stem.forEach((p, step) => {
    for (const c of inflows(down, W, H, p))
      if (
        c !== stem[step + 1] &&
        acc[c] >= minAcc &&
        acc[c] >= acc[p] * minShare
      )
        out.push({ step, cell: c });
  });
  return out;
}

/** クリック地点を半径 r セル内で一番大きい流れに吸着させる（「川の近く」を押せば川に当たるように） */
export function snap(
  acc: Float32Array,
  W: number,
  H: number,
  c: number,
  r = 4,
): number {
  const x = c % W;
  const y = (c / W) | 0;
  let best = c;
  for (let j = Math.max(0, y - r); j <= Math.min(H - 1, y + r); j++)
    for (let i = Math.max(0, x - r); i <= Math.min(W - 1, x + r); i++)
      if (acc[j * W + i] > acc[best]) best = j * W + i;
  return best;
}
