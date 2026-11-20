import { describe, expect, it } from "vitest";
import { trailView } from "./trail-state";

describe("trailView", () => {
  it("雨の通り道を見ているときは「上流へさかのぼる」だけ出し、水の来た道の線を消し、URL に dir を付けない", () => {
    expect(trailView("route")).toEqual({
      showUp: true,
      showDown: false,
      clearLine: "upstream",
      dir: null,
    });
  });

  it("水の来た道を見ているときは「下流へくだる」だけ出し、雨の通り道の線を消し、URL に dir=up を付ける", () => {
    expect(trailView("source")).toEqual({
      showUp: false,
      showDown: true,
      clearLine: "downstream",
      dir: "up",
    });
  });
});
