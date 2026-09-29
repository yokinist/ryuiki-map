import { describe, expect, it } from "vitest";
import { basinExtent, widestTiles } from "./basin-range";

// 8x8 の範囲。W=8 なので添字 = y*W + x。端から2つ以上内側は x, y とも 2〜5
const g = {
  W: 8,
  H: 8,
  // 左上が (経度 0, 緯度 8)、1セル = 1度 という模型
  at: (x: number, y: number): [number, number] => [x, 8 - y],
};
const mask = (...cells: [number, number][]) => {
  const up = new Uint8Array(g.W * g.H);
  for (const [x, y] of cells) up[y * g.W + x] = 1;
  return up;
};

describe("basinExtent: 集水域の広がりと、どの辺で切れているか", () => {
  it("内側に収まっていれば、どの辺にも届いていない", () => {
    const e = basinExtent(g, mask([3, 3], [4, 4]));
    expect(e.touched).toEqual({ n: false, s: false, e: false, w: false });
    // セル (3,3)〜(4,4) の外接矩形: 経度 3〜5、緯度 3〜5
    expect(e.bbox).toEqual([3, 3, 5, 5]);
  });

  it("端の1つ内側に届いた辺だけが true になる（北は y の小さい側）", () => {
    expect(basinExtent(g, mask([3, 1], [3, 3])).touched).toEqual({
      n: true,
      s: false,
      e: false,
      w: false,
    });
    expect(basinExtent(g, mask([3, 3], [3, 6])).touched.s).toBe(true);
    expect(basinExtent(g, mask([1, 3], [3, 3])).touched.w).toBe(true);
    expect(basinExtent(g, mask([3, 3], [6, 3])).touched.e).toBe(true);
  });
});

describe("widestTiles: はみ出した集水域を読むタイルの範囲（ズーム z）", () => {
  const z = 9;
  // 経度 141.0〜141.7、緯度 38.5〜39.6 の集水域（ズーム9でおよそ横1〜2枚・縦2〜3枚）
  const bbox: [number, number, number, number] = [141.0, 38.5, 141.7, 39.6];
  const none = { n: false, s: false, e: false, w: false };

  it("集水域の外接矩形を覆うタイルから始める", () => {
    // ズーム9で、経度141.0〜141.7は x=456〜457、緯度39.6〜38.5は y=194〜196（Web メルカトルのタイル番号）
    expect(widestTiles(z, bbox, none)).toEqual({
      tx0: 456,
      tx1: 457,
      ty0: 194,
      ty1: 196,
    });
  });

  it("外接矩形の東端・南端がちょうどタイルの境目にあっても、隣のタイルを数えない", () => {
    // ズーム9のタイル x=457 の東端は経度 (458 / 512) * 360 - 180 = 142.03125 度
    const onEdge: [number, number, number, number] = [
      141.0, 38.5, 142.03125, 39.6,
    ];
    expect(widestTiles(z, onEdge, none).tx1).toBe(457);
  });

  it("北で切れていれば北へだけ広げる。広げる幅は、その軸が8枚か、全体が36枚に収まるまで", () => {
    const t = widestTiles(z, bbox, { ...none, n: true });
    const base = widestTiles(z, bbox, none);
    expect(t.tx0).toBe(base.tx0);
    expect(t.tx1).toBe(base.tx1);
    expect(t.ty1).toBe(base.ty1); // 南はそのまま
    const w = t.tx1 - t.tx0 + 1;
    const h = t.ty1 - t.ty0 + 1;
    expect(w).toBe(2);
    expect(h).toBe(8); // 横2枚なので、縦は1つの軸の上限の8枚まで（2×8=16枚で36枚以内）
  });

  it("北と南の両方で切れていれば、両側へ分けて広げる", () => {
    const t = widestTiles(z, bbox, { ...none, n: true, s: true });
    const base = widestTiles(z, bbox, none);
    expect(t.ty0).toBeLessThan(base.ty0);
    expect(t.ty1).toBeGreaterThan(base.ty1);
    expect((t.tx1 - t.tx0 + 1) * (t.ty1 - t.ty0 + 1)).toBeLessThanOrEqual(36);
  });

  it("四方で切れていれば、縦横とも6枚（36枚）に収める", () => {
    const t = widestTiles(z, bbox, { n: true, s: true, e: true, w: true });
    expect(t.tx1 - t.tx0 + 1).toBe(6);
    expect(t.ty1 - t.ty0 + 1).toBe(6);
  });

  it("両方の軸で切れていても、縦がすでに長ければ横を絞って36枚に収める", () => {
    // 縦8枚（北緯36〜39.6度ほど）で、北と西が切れている
    const tall: [number, number, number, number] = [138.3, 35.2, 139.0, 39.6];
    const t = widestTiles(z, tall, { ...none, n: true, w: true });
    expect((t.tx1 - t.tx0 + 1) * (t.ty1 - t.ty0 + 1)).toBeLessThanOrEqual(36);
  });

  it("全体は36枚を超えない（横に広いときは縦を絞る）", () => {
    const wide: [number, number, number, number] = [138.0, 38.5, 142.0, 38.6]; // 横6枚ほど
    const t = widestTiles(z, wide, { ...none, n: true });
    expect((t.tx1 - t.tx0 + 1) * (t.ty1 - t.ty0 + 1)).toBeLessThanOrEqual(36);
    expect(t.ty0).toBeLessThan(widestTiles(z, wide, none).ty0);
  });
});
