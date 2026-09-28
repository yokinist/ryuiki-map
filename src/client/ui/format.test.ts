import { describe, expect, it } from "vitest";
import {
  area,
  areaDome,
  areaSize,
  change,
  distance,
  eta,
  km,
  people,
  volume,
} from "./format";

describe("format", () => {
  it("距離", () => {
    expect(km(823)).toBe("820 m");
    expect(km(12345)).toBe("12.3 km");
  });
  it("所要時間は分・時間・日で切り替える", () => {
    expect(eta(10)).toBe("約1分");
    expect(eta(1800)).toBe("約30分");
    expect(eta(56000)).toBe("約16時間");
    expect(eta(305500)).toBe("約4日");
  });
  it("出発点は「すぐに」", () => {
    expect(distance(0)).toBe("すぐに");
  });
  it("面積と東京ドーム換算", () => {
    expect(areaSize(0.29)).toBe("29 ha");
    expect(areaDome(12.3)).toBe("東京ドーム約263個分");
    expect(area(0.02)).toBe("2 ha（東京ドームより狭い）");
    expect(area(0.29)).toBe("29 ha（東京ドーム約6個分）");
    expect(area(12.3)).toBe("12.3 km²（東京ドーム約263個分）");
  });
  it("人数は1万人から万単位にする", () => {
    expect(people(1234.4)).toBe("1,234人");
    expect(people(12_345)).toBe("約1.2万人");
    expect(people(1_234_567)).toBe("約123万人");
  });
  it("変化の割合に符号を付ける", () => {
    expect(change(100, 112)).toBe("+12%");
    expect(change(100, 88)).toBe("-12%");
    expect(change(100, 100)).toBe("±0%");
    expect(change(0, 10)).toBe("—");
  });
  it("水の量を東京ドーム何杯分かで添える", () => {
    expect(volume(150_000_000)).toBe("約1.5億m³（東京ドーム約121杯分）");
    expect(volume(620_000)).toBe("約62万m³（東京ドームの約50%）");
  });
});
