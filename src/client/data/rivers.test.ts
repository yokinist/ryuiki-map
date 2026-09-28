import { describe, expect, it } from "vitest";
import {
  type LabelGrid,
  type RiverProps,
  rasterize,
  riversAlong,
} from "./rivers";

// 20x3 のグリッドで、真ん中の行を西から東へ流れる経路を考える
const W = 20;
const H = 3;
const at = (x: number, y: number) => y * W + x;
const path = Array.from({ length: W }, (_, x) => at(x, 1));

function grid(labels: [x: number, y: number, name: string][]): LabelGrid {
  const rivers: RiverProps[] = [];
  const label = new Int32Array(W * H).fill(-1);
  for (const [x, y, name] of labels) {
    let i = rivers.findIndex((r) => r.name === name);
    if (i < 0) i = rivers.push({ name, km: 0 }) - 1;
    label[at(x, y)] = i;
  }
  return { W, H, cellM: 200, label, rivers }; // 1km = 5セル
}
const row = (x0: number, x1: number, name: string, y = 1) =>
  Array.from(
    { length: x1 - x0 + 1 },
    (_, i) => [x0 + i, y, name] as [number, number, string],
  );

describe("riversAlong", () => {
  it("川が変わった地点を返す", () => {
    const g = grid([...row(0, 11, "片品川"), ...row(12, 19, "利根川")]);
    expect(riversAlong(g, path).map((r) => [r.name, r.step])).toEqual([
      ["片品川", 0],
      ["利根川", 14], // 片品川が2セル以内に残っている間は片品川のまま（2セル遅れる）
    ]);
  });

  it("本流に並行して流れる支流の名前には飛ばない", () => {
    // 片品川（y=1）のすぐ隣の行（y=0）を支流が並行している。経路が片品川から1セル外れても片品川のまま
    const g = grid([...row(0, 19, "片品川"), ...row(5, 15, "並行する支流", 0)]);
    const wobble = path.map((c, x) => (x >= 6 && x <= 10 ? at(x, 0) : c)); // 途中で支流側に寄る
    expect(riversAlong(g, wobble).map((r) => r.name)).toEqual(["片品川"]);
  });

  it("合流してくる支流の名前には飛ばない", () => {
    const g = grid([
      ...row(0, 11, "片品川"),
      ...row(12, 19, "利根川"),
      ...row(8, 9, "黒沢", 0),
    ]);
    expect(riversAlong(g, path).map((r) => r.name)).toEqual([
      "片品川",
      "利根川",
    ]);
  });

  it("計算範囲を乗り換えた後の区間では、最初の川でも短ければ数えない", () => {
    const g = grid([...row(0, 1, "赤良木川"), ...row(2, 19, "梼原川")]);
    expect(riversAlong(g, path).map((r) => r.name)).toEqual([
      "赤良木川",
      "梼原川",
    ]); // 出発点の区間なら残す
    expect(riversAlong(g, path, false).map((r) => r.name)).toEqual(["梼原川"]);
  });

  it("1km 未満しか沿わない川は数えない", () => {
    const g = grid([
      ...row(0, 3, "片品川"),
      ...row(5, 6, "烏川"),
      ...row(8, 11, "片品川"),
      ...row(12, 19, "利根川"),
    ]);
    expect(riversAlong(g, path).map((r) => r.name)).toEqual([
      "片品川",
      "利根川",
    ]);
  });
});

describe("rasterize", () => {
  // 1ピクセル = 1度の単純なグリッド
  const g = {
    W: 5,
    H: 5,
    toPixel: (lon: number, lat: number): [number, number] => [lon, lat],
  };

  it("線が通るセルに添字と焼き込みの深さを入れる。重なったら長い川を優先", () => {
    const { label, burn } = rasterize(g, [
      { name: "沢", km: 0, pts: [0.5, 2.5, 4.5, 2.5] }, // 横一直線
      { name: "本流", km: 300, pts: [2.5, 0.5, 2.5, 4.5] }, // 縦一直線
    ]);
    expect(label[2 * 5 + 0]).toBe(0);
    expect(label[2 * 5 + 2]).toBe(1); // 交点は長い川
    expect(burn[2 * 5 + 2]).toBeGreaterThan(burn[2 * 5 + 0]);
    expect(label[0]).toBe(-1);
  });
});
