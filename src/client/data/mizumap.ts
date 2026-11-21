// 市民の水質調べ。身近な水環境の全国一斉調査（市民団体や学校がパックテストで COD を測る）の表（public/mizumap/）で、通り道のそばの調査地点を引く
import { SOURCES } from "../config";
import { meshFiles, rowsAlong } from "./mesh-files";
import type { MizumapRow } from "./mizumap-format";
import { type SurveyOnPath, surveyNearPath } from "./survey-points";

// COD mg/L の段階の上限と言葉。境目は全国一斉調査の結果の概要と同じ（3未満・3〜6未満・6以上）。
// 概要には段階の言葉がないので、きれいな川の COD は1〜2 mg/L 程度という説明に合わせてこちらで付けた
const GRADES = [
  [3, "よごれは少ない"],
  [6, "少しよごれている"],
] as const;

/** COD mg/L → 段階（0 がきれい）と言葉 */
export function codGrade(cod: number): { level: number; label: string } {
  const level = GRADES.findIndex(([max]) => cod < max);
  return level < 0
    ? { level: GRADES.length, label: "よごれている" }
    : { level, label: GRADES[level][1] };
}

// ---- 配信場所: /mizumap/latest.json が今の版を指す（形は data/mesh-files.ts） ----
const mizumapFile = meshFiles<MizumapRow>(SOURCES.mizumap);

/** 道のり沿いの市民の水質調べ（value は COD mg/L）の調査地点。道のりが通る1次メッシュのファイルだけを読む */
export async function mizumapAlong(
  path: Parameters<typeof surveyNearPath>[0],
): Promise<SurveyOnPath[]> {
  return surveyNearPath(path, await rowsAlong(mizumapFile, path.pts));
}
