import { describe, expect, it } from "vitest";
import { areasNear, cellOf, nearestArea, rle, runAt } from "./place-grid";

describe("cellOf: 地点が入る1次メッシュと、その中の格子のマス（列 i・行 j。行0が南）", () => {
  it("1次メッシュ 5339（東経139〜140度・北緯35°20′〜36°）の真ん中あたり", () => {
    // 北緯35.5度は、1次メッシュの南端（35°20′）から 1/4 の高さ
    expect(cellOf(139.5, 35.5, 1600)).toEqual({ m1: 5339, i: 800, j: 400 });
  });

  it("南西の角はマス (0, 0)、東の端の手前は最後の列", () => {
    expect(cellOf(139, 53 / 1.5, 1600)).toEqual({ m1: 5339, i: 0, j: 0 });
    expect(cellOf(139.99999, 35.4, 1600).i).toBe(1599);
  });
});

describe("rle と runAt: 1行を [値, 続く数, 値, 続く数, …] に縮め、列 i の値を引く", () => {
  const row = [0, 0, 3, 3, 3, 0, 7];
  it("同じ値の連なりをまとめる", () => {
    expect(rle(row)).toEqual([0, 2, 3, 3, 0, 1, 7, 1]);
  });
  it("縮めた行から、元の行と同じ値を引ける", () => {
    const runs = rle(row);
    expect(row.map((_, i) => runAt(runs, i))).toEqual(row);
  });
});

describe("areasNear: マス (i, j) の周り r マス以内に入っている番号（0 は除き、小さい順）", () => {
  // 3×3 の格子。行0が南
  const grid = [
    [1, 1, 2],
    [1, 0, 2],
    [3, 3, 2],
  ];
  const row = (j: number) => grid[j];
  it("r=0 ならそのマスだけ。どこにも入らないマスは空", () => {
    expect(areasNear(row, 0, 0, 0, 3)).toEqual([1]);
    expect(areasNear(row, 1, 1, 0, 3)).toEqual([]);
  });
  it("r=1 なら周りの8マスも見る。格子の外は見ない", () => {
    expect(areasNear(row, 1, 1, 1, 3)).toEqual([1, 2, 3]);
    expect(areasNear(row, 0, 0, 1, 3)).toEqual([1]);
  });
  it("読めない行（ファイルの外）は飛ばす", () => {
    expect(
      areasNear((j) => (j === 2 ? undefined : grid[j]), 1, 1, 1, 3),
    ).toEqual([1, 2]);
  });
});

describe("nearestArea: マス (i, j) を囲む輪を近い方から（r マスまで）広げ、条件に合う番号を探す", () => {
  const grid = [
    [1, 1, 2],
    [1, 0, 2],
    [3, 3, 2],
  ];
  const row = (j: number) => grid[j];
  it("近い輪と遠い輪の両方に合う番号があれば、近い輪のもの（行の順に先に見えても、遠い輪のものは選ばない）", () => {
    // 5×5。(0, 0) から1マスの輪に 5、2マスの輪（南の行）に 9
    const rings = [
      [0, 0, 9, 0, 0],
      [0, 5, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ];
    expect(
      nearestArea(
        (j) => rings[j],
        0,
        0,
        2,
        5,
        (k) => k > 0,
      ),
    ).toBe(5);
  });
  it("条件に合う番号を探す。なければ 0", () => {
    expect(nearestArea(row, 1, 1, 1, 3, (k) => k === 3)).toBe(3);
    expect(nearestArea(row, 1, 1, 1, 3, (k) => k === 4)).toBe(0);
  });
  it("そのマス自体が合えば、それを返す", () => {
    expect(nearestArea(row, 2, 0, 1, 3, (k) => k > 0)).toBe(2);
  });
  it("r=0 ならそのマスだけを見る", () => {
    expect(nearestArea(row, 1, 1, 0, 3, (k) => k > 0)).toBe(0);
  });
});
