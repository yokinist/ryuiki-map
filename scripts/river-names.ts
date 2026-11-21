// 測定点がどの川にあるかを、配信している河川タイル（public/rivers/）の線でいちばん近いものの名前にする（水質・水生生物の表で共通）。
// 河川線は OSM のもので、雨の通り道の川の名前と同じ出どころなので、名前が揃う
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decodeTile,
  type RiverLine,
  tileKey,
} from "../src/client/data/river-format.ts";
import { nearestRiverName } from "../src/client/data/river-near.ts";

const rivers = join(import.meta.dirname, "..", "public", "rivers");
const riverDir = join(
  rivers,
  JSON.parse(readFileSync(join(rivers, "latest.json"), "utf8")).version,
);
const tiles = new Map<string, RiverLine[]>();
const tileLines = (key: string) => {
  let lines = tiles.get(key);
  if (!lines) {
    const file = join(riverDir, `${key}.json`);
    lines = existsSync(file)
      ? decodeTile(JSON.parse(readFileSync(file, "utf8")))
      : [];
    tiles.set(key, lines);
  }
  return lines;
};

/** (lon, lat) から maxM 以内でいちばん近い河川線の名前。線は最初の点があるタイルに入っているので、隣のタイルも含めた9枚から探す */
export function riverNameAt(lon: number, lat: number, maxM: number) {
  const [tx, ty] = tileKey(lon, lat).split("_").map(Number);
  const lines = [-1, 0, 1].flatMap((dx) =>
    [-1, 0, 1].flatMap((dy) => tileLines(`${tx + dx}_${ty + dy}`)),
  );
  return nearestRiverName(lines, lon, lat, maxM);
}
