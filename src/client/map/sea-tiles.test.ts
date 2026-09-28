import { describe, expect, it } from "vitest";
import { isMissingTile } from "./sea-tiles";

describe("isMissingTile", () => {
  const missing = new Set(["6/54/24", "10/900/400"]);

  it("一覧にあるタイルは無いと判定する", () => {
    expect(isMissingTile(missing, 6, 54, 24)).toBe(true);
  });

  it("無いタイルの子孫も無いと判定する", () => {
    expect(isMissingTile(missing, 8, 54 * 4 + 3, 24 * 4 + 1)).toBe(true);
    expect(isMissingTile(missing, 14, 900 * 16 + 5, 400 * 16 + 9)).toBe(true);
  });

  it("一覧にないタイルとその親は問い合わせる", () => {
    expect(isMissingTile(missing, 6, 56, 25)).toBe(false);
    expect(isMissingTile(missing, 5, 27, 12)).toBe(false);
  });
});
