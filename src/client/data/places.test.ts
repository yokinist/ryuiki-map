import { describe, expect, it } from "vitest";
import { muniChanges, placeOf } from "./places";

// 点は 500m おき。数字は点が入るメッシュの市区町村コード（配列は境界をまたぐメッシュ、null は表で見つからない点）
const run = (...pts: (number | number[] | null)[]) => ({
  codes: pts.map((p) => (p === null ? [] : [p].flat())),
  dist: pts.map((_, i) => i * 500),
});

describe("muniChanges", () => {
  it("出発点と違う市区町村が 2km 続いたら、入った所で出す", () => {
    const { codes, dist } = run(1, 1, 2, 2, 2, 2, 2);
    expect(muniChanges(codes, dist).changes).toEqual([{ step: 2, code: 2 }]);
  });

  it("境界の川で 2km に満たずに行き来するあいだは出さない", () => {
    const { codes, dist } = run(1, 2, 2, 1, 2, 1, 3, 3, 3, 3, 3);
    expect(muniChanges(codes, dist).changes).toEqual([{ step: 6, code: 3 }]);
  });

  it("短く通り過ぎた市区町村は出さず、続いた市区町村だけ出す", () => {
    const { codes, dist } = run(1, 2, 3, 3, 3, 3, 3);
    expect(muniChanges(codes, dist).changes).toEqual([{ step: 2, code: 3 }]);
  });

  it("表で見つからない点（湖の上など）は飛ばし、続きは切らない", () => {
    const { codes, dist } = run(null, 1, 2, null, 2, null, 2, 2);
    expect(muniChanges(codes, dist).changes).toEqual([{ step: 2, code: 2 }]);
  });

  it("出発点や一度出した市区町村に戻っても、出し直さない", () => {
    const { codes, dist } = run(1, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2);
    expect(muniChanges(codes, dist).changes).toEqual([{ step: 1, code: 2 }]);
  });

  it("境界をまたぐメッシュ（候補が複数）では、今いる市区町村のままにする", () => {
    const { codes, dist } = run(1, [1, 2], [1, 2], [2, 1], [1, 2], [1, 2]);
    expect(muniChanges(codes, dist).changes).toEqual([]);
  });

  it("最後の市区町村（河口・水源）は、境界をまたぐメッシュならそれまでいた市区町村", () => {
    const stay = run(1, 1, [1, 3]);
    expect(muniChanges(stay.codes, stay.dist).last).toBe(1);
    const moved = run(1, 2, 2, 2, 2, 2, [3, 2], null);
    expect(muniChanges(moved.codes, moved.dist).last).toBe(2);
    // 2km に満たなくても、最後の点が今の市区町村に入っていなければ、入りかけの市区町村
    const short = run(1, 1, 1, 3);
    expect(muniChanges(short.codes, short.dist).last).toBe(3);
    expect(muniChanges([[]], [0]).last).toBeUndefined();
  });
});

describe("placeOf", () => {
  it("頭が0の市区町村コード（北海道〜栃木）も名前を引ける", () => {
    const names = { "01457": ["北海道", "上川町"] as [string, string] };
    expect(placeOf(names, 1457)).toEqual({
      key: "01457",
      pref: "北海道",
      muni: "上川町",
    });
    expect(placeOf(names, 13111)).toBeNull();
  });
});
