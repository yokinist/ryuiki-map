import { describe, expect, it } from "vitest";
import {
  farthestStem,
  mainStem,
  route,
  snap,
  tributaries,
  upstream,
} from "./hydro";

// 5x5 の V字谷。南端の行が海で、(2,2) に窪地がある
const W = 5;
const H = 5;
const at = (x: number, y: number) => y * W + x;
function valley() {
  const elev = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      elev[at(x, y)] =
        y === 4 ? Number.NaN : (4 - y) * 10 + Math.abs(x - 2) * 3;
  elev[at(2, 2)] = 5; // 出口 (2,3)=10 より低い窪地
  return elev;
}

describe("route", () => {
  const elev = valley();
  const { down, order, acc } = route(elev, W, H);

  it("すべての陸セルが出口に着く（窪地で止まらない）", () => {
    for (let c = 0; c < W * H; c++) {
      let p = c;
      let steps = 0;
      while (down[p] >= 0) {
        p = down[p];
        expect(++steps).toBeLessThan(100);
      }
    }
  });

  it("谷頭の水は谷筋を下って海に入る", () => {
    const path = [at(2, 1)];
    while (down[path[path.length - 1]] >= 0)
      path.push(down[path[path.length - 1]]);
    expect(path.slice(0, 3)).toEqual([at(2, 1), at(2, 2), at(2, 3)]);
    expect(path).toHaveLength(4);
    expect(Number.isNaN(elev[path[3]])).toBe(true); // どの海セルに入っても河口として正しい
  });

  it("集水域と集水数が一致する", () => {
    const up = upstream(down, order, at(2, 3));
    expect(up[at(2, 1)] && up[at(2, 2)]).toBeTruthy();
    expect(up[at(2, 4)]).toBe(0);
    expect(acc[at(2, 3)]).toBe(up.reduce((a, b) => a + b, 0));
  });

  it("snap は近くの一番大きい流れに吸着する", () => {
    expect(snap(acc, W, H, at(1, 3), 1)).toBe(at(2, 3));
  });
});

describe("route: 河口が砂州でふさがっている場合", () => {
  // 9x8。周りは丘(50)、南端の行が海、その手前の行が砂州(5)。低地(3)の中を
  // 深く焼き込んだ本流(x=3, -40)と浅く焼き込んだ支流(x=5, -20)が並行して流れ、y=2 でつながっている。
  // 砂州があるので川筋は海につながっておらず、流向計算では砂州の高さまで埋められて平らになる
  const W2 = 9;
  const H2 = 8;
  const at2 = (x: number, y: number) => y * W2 + x;
  function barred() {
    const elev = new Float32Array(W2 * H2).fill(50);
    for (let x = 0; x < W2; x++) elev[at2(x, 7)] = Number.NaN;
    for (let x = 1; x < W2 - 1; x++) elev[at2(x, 6)] = 5;
    for (let y = 1; y <= 5; y++)
      for (let x = 1; x < W2 - 1; x++) elev[at2(x, y)] = 3;
    for (let y = 1; y <= 5; y++) elev[at2(3, y)] = -40;
    for (let y = 1; y <= 5; y++) elev[at2(5, y)] = -20;
    elev[at2(4, 2)] = -20;
    return elev;
  }

  it("埋められて平らになっても、深く焼き込んだ本流の川筋を流れる", () => {
    const { down } = route(barred(), W2, H2);
    const path = [at2(3, 1)];
    while (down[path[path.length - 1]] >= 0)
      path.push(down[path[path.length - 1]]);
    // 本流を海の手前まで下る（最後に砂州へ抜けるところは、先に道筋が決まった隣の低地を通ることがある）
    expect(path.slice(0, 4)).toEqual([1, 2, 3, 4].map((y) => at2(3, y)));
    expect(path.some((c) => c % W2 === 5)).toBe(false); // 支流には入らない
  });
});

describe("mainStem", () => {
  // 3x3。5→2→1→4→7 が本筋で、0→1、3→6→7、8→7 が脇から入る。7 は出口
  const down = Int32Array.from([1, 4, 1, 6, 7, 2, 7, -1, 7]);
  const acc = Float32Array.from([1, 4, 2, 1, 5, 1, 2, 9, 1]);

  it("集水数の一番大きい流れを選んで、水源までさかのぼる", () => {
    expect(mainStem(down, acc, 3, 3, 7)).toEqual([7, 4, 1, 2, 5]);
  });

  it("本筋に脇から入る流れのうち、集水数が minAcc 以上のものを支流として拾う", () => {
    expect(tributaries(down, acc, 3, 3, [7, 4, 1, 2, 5], 2)).toEqual([
      { step: 0, cell: 6 },
    ]);
  });

  it("本筋の集水数に対する割合が minShare 未満の流れは、支流として拾わない", () => {
    // 7 の集水数 9 に対して 6 は 2（22%）、1 の集水数 4 に対して 0 は 1（25%）
    expect(tributaries(down, acc, 3, 3, [7, 4, 1, 2, 5], 1, 0.25)).toEqual([
      { step: 2, cell: 0 },
    ]);
  });
});

describe("farthestStem", () => {
  // 4x3。0 が出口。1←2←3←7←11 は細長い流れ（5セル）、4 には 5・8・9・6・10 が集まる（6セル）が短い
  const down = Int32Array.from([-1, 0, 1, 2, 0, 4, 5, 3, 4, 4, 9, 7]);
  const order = Int32Array.from([0, 1, 4, 2, 5, 8, 9, 3, 6, 10, 7, 11]);

  it("集水数が小さくても、いちばん遠い水源に続く流れをさかのぼる", () => {
    expect(farthestStem(down, order, 4, 0)).toEqual([0, 1, 2, 3, 7, 11]);
  });
});
