import { describe, expect, it } from "vitest";
import { pickBasin, touchesEdge } from "./basin-edge";

// 7x7 の範囲。W=7 なので添字 = y*W + x。端から2つ以上内側は x, y とも 2〜4
const g = { W: 7, H: 7 };
const mask = (...cells: [number, number][]) => {
  const up = new Uint8Array(g.W * g.H);
  for (const [x, y] of cells) up[y * g.W + x] = 1;
  return up;
};

describe("touchesEdge: 集水域が計算範囲の端まで届いているか", () => {
  it("内側に収まっていれば届いていない", () => {
    expect(touchesEdge(g, mask([3, 3], [2, 3], [3, 4], [4, 2]))).toBe(false);
  });

  it("範囲の端のセルは出口になるので、集水域は端の1つ内側までしか広がらない。1つ内側に届いたら端まで届いた扱い", () => {
    expect(touchesEdge(g, mask([3, 3], [1, 3]))).toBe(true); // 左端の1つ内側
    expect(touchesEdge(g, mask([3, 3], [3, 1]))).toBe(true); // 上端の1つ内側
    expect(touchesEdge(g, mask([3, 3], [5, 3]))).toBe(true); // 右端の1つ内側
    expect(touchesEdge(g, mask([3, 3], [3, 5]))).toBe(true); // 下端の1つ内側
  });

  it("端のセルそのものに届いている場合も届いた扱い", () => {
    expect(touchesEdge(g, mask([3, 3], [0, 3]))).toBe(true);
  });
});

describe("pickBasin: 候補の範囲から、集水域が収まるものを選ぶ", () => {
  const c = (id: string, truncated: boolean, km2: number) => ({
    id,
    truncated,
    km2,
  });

  it("収まる候補があれば、最初に収まったものを選ぶ", () => {
    expect(
      pickBasin([
        c("細かい", true, 5),
        c("広域A", false, 300),
        c("広域B", false, 900),
      ])?.id,
    ).toBe("広域A");
  });

  it("最初の候補（雨をたどったグリッド）より集水域がずっと小さい候補は、吸着し直しで別の沢に乗ったものなので選ばない", () => {
    // grids.wides にはクリック地点の細かいグリッド（z13）も入る（main.ts の addWide(local)）。
    // 石狩川の本流（約 4000 km²）をそこで吸着し直すと、近くの小さな沢（約 2 km²）に乗ることがある
    expect(pickBasin([c("広域", true, 4000), c("細かい", false, 2)])?.id).toBe(
      "広域",
    );
    // 同じ川に乗り直したなら、数え方の違いで多少小さくても選ぶ
    expect(
      pickBasin([c("広域", true, 4000), c("細かい", false, 3500)])?.id,
    ).toBe("細かい");
  });

  it("どれも収まらなければ、集水域がいちばん広く数えられた候補を選ぶ（できるだけ遠くまでたどるため）", () => {
    expect(
      pickBasin([
        c("細かい", true, 5),
        c("広域A", true, 4000),
        c("広域B", true, 1200),
      ])?.id,
    ).toBe("広域A");
  });

  it("収まる候補が見つかったら、残りの候補は数えない（候補ごとに集水域を数えるのは重いので）", () => {
    function* candidates() {
      yield c("細かい", true, 5);
      yield c("広域A", false, 300);
      throw new Error("収まる候補が見つかったあとに、次の候補を数えた");
    }
    expect(pickBasin(candidates())?.id).toBe("広域A");
  });

  it("候補を1件ずつ受け取るときも、最初の候補より集水域がずっと小さい候補は選ばない", () => {
    function* candidates() {
      yield c("広域", true, 4000);
      yield c("細かい", false, 2);
    }
    expect(pickBasin(candidates())?.id).toBe("広域");
  });

  it("候補がなければ null", () => {
    expect(pickBasin([])).toBeNull();
  });
});
