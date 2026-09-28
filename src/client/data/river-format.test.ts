import { describe, expect, it } from "vitest";
import {
  cachedTiles,
  decodeTile,
  encodeTile,
  tileKey,
  tileKeysFor,
} from "./river-format";

describe("river-format", () => {
  it("エンコードして戻すと同じ線になる（座標は小数4桁）", () => {
    const lines = [
      {
        name: "片品川",
        km: 60,
        pts: [139.2801, 36.8802, 139.2811, 36.8791, 139.29, 36.87],
      },
      { name: "尾名沢", km: 0, pts: [139.27, 36.88, 139.2801, 36.8802] },
      { name: "片品川", km: 60, pts: [139.29, 36.87, 139.3, 36.86] },
    ];
    const packed = encodeTile(lines);
    expect(packed.names).toEqual(["片品川", "尾名沢"]); // 同じ名前は1回だけ
    const back = decodeTile(JSON.parse(JSON.stringify(packed)));
    expect(back.map((l) => l.name)).toEqual(["片品川", "尾名沢", "片品川"]);
    for (const [i, l] of back.entries())
      for (const [j, v] of l.pts.entries())
        expect(v).toBeCloseTo(lines[i].pts[j], 4);
  });

  it("タイルのキーは0.5°単位", () => {
    expect(tileKey(139.28, 36.88)).toBe("278_73");
    expect(tileKey(139.5, 36.5)).toBe("279_73");
    expect(tileKeysFor([139.28, 36.88, 139.3, 36.9], 0)).toEqual(["278_73"]);
    expect(tileKeysFor([139.45, 36.45, 139.55, 36.55], 0)).toEqual([
      "278_72",
      "278_73",
      "279_72",
      "279_73",
    ]);
  });
});

describe("cachedTiles", () => {
  const setup = () => {
    const cache = new Map<string, Promise<string>>();
    const loaded: string[] = [];
    const get = (keys: string[], max = 2) =>
      cachedTiles(cache, keys, max, (k) => {
        loaded.push(k);
        return Promise.resolve(k);
      });
    return { cache, loaded, get };
  };

  it("読み込み済みのタイルは読み直さない", async () => {
    const { loaded, get } = setup();
    expect(await Promise.all(get(["a", "b"]))).toEqual(["a", "b"]);
    await Promise.all(get(["b", "a"]));
    expect(loaded).toEqual(["a", "b"]);
  });

  it("上限を超えたら一番長く使っていないタイルから捨てる", () => {
    const { cache, get } = setup();
    get(["a", "b"]);
    get(["a"]); // a を使ったので、捨てられるのは b
    get(["c"]);
    expect([...cache.keys()]).toEqual(["a", "c"]);
  });

  it("今回使うタイルは上限を超えても捨てない", () => {
    const { cache, get } = setup();
    get(["a", "b", "c"]);
    expect(cache.size).toBe(3);
  });
});
