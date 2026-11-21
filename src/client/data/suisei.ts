// 川の生きもの調べ。全国水生生物調査（学校や市民団体が指標生物で水質を4階級に判定する）の表（public/suisei/）で、通り道のそばの調査地点を引く
import { SOURCES } from "../config";
import { meshFiles, rowsAlong } from "./mesh-files";
import type { SuiseiRow } from "./suisei-format";
import { type SurveyOnPath, surveyNearPath } from "./survey-points";

/** 水質階級 1〜4 の言葉（全国水生生物調査の判定のまま） */
const LABELS = [
  "きれいな水",
  "ややきれいな水",
  "きたない水",
  "とてもきたない水",
];

export const suiseiLabel = (grade: number) => LABELS[grade - 1];

// ---- 配信場所: /suisei/latest.json が今の版を指す（形は data/mesh-files.ts） ----
const suiseiFile = meshFiles<SuiseiRow>(SOURCES.suisei);

/** 道のり沿いの川の生きもの調べ（value は水質階級）の調査地点。道のりが通る1次メッシュのファイルだけを読む */
export async function suiseiAlong(
  path: Parameters<typeof surveyNearPath>[0],
): Promise<SurveyOnPath[]> {
  return surveyNearPath(path, await rowsAlong(suiseiFile, path.pts));
}
