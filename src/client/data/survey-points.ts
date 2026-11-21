// 市民の調査地点（水生生物調査 suisei・全国一斉調査 mizumap）を、通り道のそばから拾う。
// どちらの表も1行が [経度, 緯度, 値, 地点名, 調査日, そばの川の名前] の形（suisei-format.ts・mizumap-format.ts）
import type { LngLat } from "../geo";
import { nearestOnPath } from "./karte-stats";

export type SurveyRow = [
  lon: number,
  lat: number,
  value: number,
  name: string,
  date: string,
  river: string | null,
];

export interface SurveyOnPath {
  /** 流路上の位置（いちばん近い点の添字） */
  step: number;
  name: string;
  /** 水生生物調査なら水質階級（1〜4）、全国一斉調査なら COD mg/L */
  value: number;
  /** 調査日（YYYY-MM-DD） */
  date: string;
}

type PathLike = {
  pts: LngLat[];
  rivers?: { name: string; step: number }[];
};

/**
 * 流路 pts から maxM 以内の調査地点を、流路の順に返す。
 * そばを流れる川の名前が分かる地点は、流路のその位置の川と同じものだけ拾う（水質の stationsNearPath と同じく、近くの支流の地点を除くため）
 */
export function surveyNearPath(
  { pts, rivers = [] }: PathLike,
  rows: SurveyRow[],
  maxM = 250,
): SurveyOnPath[] {
  const { step } = nearestOnPath(pts, maxM);
  const riverAt = (s: number) => rivers.findLast((r) => r.step <= s)?.name;
  return rows
    .map(([x, y, value, name, date, river]) => ({
      step: step(x, y),
      name,
      value,
      date,
      river,
    }))
    .filter((s) => s.step >= 0 && (!s.river || s.river === riverAt(s.step)))
    .sort((a, b) => a.step - b.step)
    .map(({ river: _, ...s }) => s);
}
