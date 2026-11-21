// 地名の文字検索。public/places/<版>/search.json（scripts/build-places.ts が e-Stat の代表点から作る）を手元で引く
import type { LngLat } from "../geo";
import { azaName, type PlaceIndex, placeName } from "./places";

/** [市区町村コード, 町丁・字等の名前（"" は市区町村そのもの）, 経度, 緯度] */
export type SearchRow = [code: number, name: string, lng: number, lat: number];

export interface SearchHit {
  label: string;
  p: LngLat;
  /** 町丁・字等（false なら市区町村） */
  aza: boolean;
}

interface Entry {
  /** 比べる名前（市区町村名、または頭の「大字」を外した町丁・字等の名前） */
  name: string;
  aza: boolean;
  pref: string;
  muni: string;
  p: LngLat;
}

// 20万件を打つたびに組み立て直すと重いので、読んだ表ごとに1回だけ作る
const prepared = new WeakMap<SearchRow[], Entry[]>();
function entries(rows: SearchRow[], cities: PlaceIndex["cities"]) {
  let list = prepared.get(rows);
  if (!list) {
    list = rows.flatMap(([code, raw, lng, lat]) => {
      const city = cities[String(code).padStart(5, "0")];
      if (!city) return [];
      const aza = azaName(raw);
      return [
        {
          name: aza || city[1],
          aza: !!aza,
          pref: city[0],
          muni: city[1],
          p: [lng, lat] as LngLat,
        },
      ];
    });
    prepared.set(rows, list);
  }
  return list;
}

/**
 * 空白で区切った最後の語を名前に含むものを、市区町村（名前が同じ → 名前で始まる）→ 町丁・字等（同じ → 始まる）→
 * 名前に含む市区町村 → 町丁・字等 の順に、その中では短い名前から limit 件まで（「千葉」なら島田市 千葉より千葉市）。
 * ほかの語は都道府県名・市区町村名に含むものに絞る
 */
export function searchPlaces(
  rows: SearchRow[],
  cities: PlaceIndex["cities"],
  query: string,
  limit = 8,
): SearchHit[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  const last = words.pop();
  if (!last) return [];
  const hits: { rank: number; e: Entry }[] = [];
  for (const e of entries(rows, cities)) {
    const at = e.name.indexOf(last);
    if (at < 0) continue;
    if (!words.every((w) => (e.pref + e.muni).includes(w))) continue;
    const rank =
      at > 0 ? (e.aza ? 5 : 4) : (e.aza ? 2 : 0) + (e.name === last ? 0 : 1);
    hits.push({ rank, e });
  }
  return hits
    .sort((a, b) => a.rank - b.rank || a.e.name.length - b.e.name.length)
    .slice(0, limit)
    .map(({ e }) => ({
      label: placeName({
        pref: e.pref,
        muni: e.muni,
        aza: e.aza ? e.name : "",
      }),
      p: e.p,
      aza: e.aza,
    }));
}
