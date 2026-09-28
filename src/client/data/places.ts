import { GEOCODER, SOURCES } from "../config";
import type { LngLat } from "../geo";
import type { Path } from "../terrain/trace";

/** 大字（集落の単位）。key は市区町村コード + 大字名 */
export interface Place {
  key: string;
  pref: string;
  muni: string;
  aza: string;
}

/** 「群馬県沼田市 岩本町」。大字がなければ市区町村まで */
export const placeName = (p: Pick<Place, "pref" | "muni" | "aza">) =>
  `${p.pref}${p.muni}${p.aza ? ` ${p.aza}` : ""}`;
export interface PlaceEvent extends Place {
  step: number;
}

// 市区町村コード → 都道府県名・市区町村名。地理院地図の muni.js（"県コード,県名,市区町村コード,市区町村名"）を読んで使う
type Muni = Record<number, { pref: string; muni: string }>;
let muni: Promise<Muni> | null = null;
const loadMuni = () =>
  (muni ??= fetch(SOURCES.muni)
    .then((r) => r.text())
    .then((t) => {
      const m: Muni = {};
      for (const [, cd, pref, name] of t.matchAll(
        /MUNI_ARRAY\["(\d+)"\]\s*=\s*'[^,]*,([^,]*),[^,]*,([^']*)'/g,
      ))
        m[+cd] = { pref, muni: name.replace(/\s/g, "") }; // 「新潟市　南区」→「新潟市南区」
      return m;
    })
    .catch(() => ({}) as Muni));

const cache = new Map<string, Promise<Place | null>>();

// 地理院の逆ジオコーダに負荷をかけないよう、同時に投げる問い合わせを絞る
let active = 0;
const waiting: (() => void)[] = [];
async function throttled<T>(task: () => Promise<T>): Promise<T> {
  if (active >= GEOCODER.concurrency)
    await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await task();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/** 地理院 逆ジオコーダで地点の大字を調べる。大字がない地点（川の上など）は aza が空 */
export function place([lon, lat]: LngLat): Promise<Place | null> {
  const k = `${lon.toFixed(3)},${lat.toFixed(3)}`;
  let p = cache.get(k);
  if (!p) {
    p = (async () => {
      const res = await fetch(SOURCES.reverseGeocoder(lon, lat), {
        signal: AbortSignal.timeout(GEOCODER.timeoutMs),
      });
      const r: { muniCd: string; lv01Nm: string } | undefined = (
        await res.json()
      ).results;
      if (!r) return null;
      const aza = /^[-－−―ー\s]*$/.test(r.lv01Nm)
        ? ""
        : r.lv01Nm.replace(/^大字/, ""); // 大字なしは記号が返る
      return {
        key: r.muniCd + aza,
        ...((await loadMuni())[+r.muniCd] ?? { pref: "", muni: "" }),
        aza,
      };
    })().catch(() => {
      cache.delete(k); // 失敗（混雑による打ち切りなど）は覚えずに、次の雨でまた問い合わせる
      return null;
    });
    cache.set(k, p);
  }
  return p;
}

/**
 * 流路沿いの地区。川の区間（合流から次の合流まで）ごとに1つ、区間の中ほどの地区を出す
 * （区間全体が出発点や隣の区間と同じ地区なら、その区間には出さない）。
 * 応答は遅いことがあるので、1件届くたびにその時点の一覧を onUpdate に渡す。
 * stale() が true になったら（別の地点がクリックされたら）まだ投げていない問い合わせは取りやめる
 */
export async function placesAlong(
  path: Pick<Path, "pts" | "dist" | "rivers">,
  stale: () => boolean = () => false,
  onUpdate?: (events: PlaceEvent[]) => void,
): Promise<PlaceEvent[]> {
  const found: Found[] = [];
  const query = (step: number) =>
    throttled(async () => (stale() ? null : place(path.pts[step])));
  // 出発点や上流の区間と同じ地区なら、区間の別の地点を試す。問い合わせは全区間で同時に始めるが、
  // どの地区を採るかは上流の区間から順に決める（応答の順番で下流に先取りされないように）。
  // 出発点は Rain も同じ地点を引くのでキャッシュが効く
  let upstream: Promise<Set<string>> = place(path.pts[0]).then(
    (p) => new Set(p ? [p.key] : []),
  );
  const sections = probeSteps(path).map((steps) => {
    const first = query(steps[0]);
    const before = upstream;
    upstream = (async () => {
      const seen = await before;
      for (const [i, step] of steps.entries()) {
        const p = await (i === 0 ? first : query(step));
        if (stale()) break;
        if (p?.aza && !seen.has(p.key)) {
          found.push({ step, p });
          onUpdate?.(placeEvents(found));
          return new Set([...seen, p.key]);
        }
      }
      return seen;
    })();
    return upstream;
  });
  await Promise.all(sections);
  return placeEvents(found);
}

/**
 * 川の区間ごとの、地区を問い合わせる地点（Path.pts の添字）。
 * 川の上など大字が返らない地点もあるので、区間の中央・1/3・2/3 の順に、見つかるまで試す
 */
export function probeSteps({
  dist,
  rivers,
}: Pick<Path, "dist" | "rivers">): number[][] {
  const cuts = [...new Set([0, ...rivers.map((r) => r.step), dist.length - 1])]
    .filter((s) => s < dist.length)
    .sort((a, b) => a - b);
  const out: number[][] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    const at = (f: number) => {
      const d = dist[a] + (dist[b] - dist[a]) * f;
      return Math.max(
        a,
        dist.findIndex((x) => x >= d),
      );
    };
    out.push([...new Set([at(1 / 2), at(1 / 3), at(2 / 3)])]);
  }
  return out;
}

type Found = { step: number; p: Place | null };

/**
 * 届いた問い合わせ結果（届いた順）を流路の順に並べた地区の一覧。
 * 隣の区間で同じ地区になることがあるので、一度出た地区は最初の地点だけにする
 */
export function placeEvents(found: Found[]): PlaceEvent[] {
  const out: PlaceEvent[] = [];
  const seen = new Set<string>();
  for (const { step, p } of [...found].sort((a, b) => a.step - b.step))
    if (p?.aza && !seen.has(p.key)) {
      seen.add(p.key);
      out.push({ ...p, step });
    }
  return out;
}
