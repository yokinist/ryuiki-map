import { DOME_KM2, DOME_M3, FLOW_MPS } from "../config";

/** 距離 m → 「820 m」「12.3 km」 */
export const km = (m: number) =>
  m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;

/** 流路長 m → 到着までの目安 */
export function eta(m: number) {
  const min = m / FLOW_MPS / 60;
  if (min < 60) return `約${Math.max(1, Math.round(min))}分`;
  if (min < 48 * 60) return `約${Math.round(min / 60)}時間`;
  return `約${Math.round(min / 1440)}日`;
}

/** 出発点からの距離と所要時間。出発点そのものは「すぐに」 */
export const distance = (m: number) =>
  m > 0 ? `${km(m)}・${eta(m)}` : "すぐに";

/** 面積 km² の表示（例: 12.3 km²） */
export function areaSize(km2: number) {
  return km2 < 1 ? `${Math.round(km2 * 100)} ha` : `${km2.toFixed(1)} km²`;
}

/** 面積の東京ドーム換算（添え書き用） */
export function areaDome(km2: number) {
  return km2 < DOME_KM2
    ? "東京ドームより狭い"
    : `東京ドーム約${Math.round(km2 / DOME_KM2).toLocaleString()}個分`;
}

/** 面積 km² → 「29 ha（東京ドーム約6個分）」 */
export function area(km2: number) {
  return `${areaSize(km2)}（${areaDome(km2)}）`;
}

/** 人数 → 「1,234人」「約12.3万人」 */
export function people(n: number) {
  if (n < 10_000) return `${Math.round(n).toLocaleString()}人`;
  if (n < 100_000_000)
    return `約${(n / 10_000).toFixed(n < 100_000 ? 1 : 0)}万人`;
  return `約${(n / 100_000_000).toFixed(1)}億人`;
}

/** 変化の割合 → 「+3%」「-12%」「±0%」 */
export function change(from: number, to: number) {
  if (!from) return "—";
  const pct = Math.round(((to - from) / from) * 100);
  return pct > 0 ? `+${pct}%` : pct < 0 ? `${pct}%` : "±0%";
}

/** 水の量 m³ の主値（例: 約2686万m³） */
export function volumeSize(m3: number) {
  return m3 < 10_000
    ? `約${Math.round(m3).toLocaleString()}m³`
    : m3 < 100_000_000
      ? `約${(m3 / 10_000).toFixed(m3 < 100_000 ? 1 : 0)}万m³`
      : `約${(m3 / 100_000_000).toFixed(1)}億m³`;
}

/** 水の量の東京ドーム換算（添え書き用） */
export function volumeDome(m3: number) {
  const dome = m3 / DOME_M3;
  return dome < 1
    ? `東京ドームの約${Math.max(1, Math.round(dome * 100))}%`
    : `東京ドーム約${Math.round(dome).toLocaleString()}杯分`;
}

/** 水の量 m³ → 「約1.5億m³（東京ドーム約120杯分）」 */
export function volume(m3: number) {
  return `${volumeSize(m3)}（${volumeDome(m3)}）`;
}
