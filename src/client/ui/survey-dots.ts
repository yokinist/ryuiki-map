// 地図に点で置き、時系列の帯や流域サマリに並べる調査地点（環境省の水質測定点・市民の調査地点）の色の点
import { codGrade } from "../data/mizumap";
import { suiseiLabel } from "../data/suisei";
import type { SurveyOnPath } from "../data/survey-points";
import type { WaterOnPath } from "../data/water";

/**
 * 地図に点で置く調査地点1つ（環境省の測定点 water・市民の調査地点 citizen）。
 * tone は色の段階（0 きれい寄り・1 なか・2 よごれ寄り）、text は押したときに出す中身
 */
export interface SurveyDot {
  step: number;
  kind: "water" | "citizen";
  tone: number;
  text: string;
}

const month = (date: string) => {
  const [y, m] = date.split("-").map(Number);
  return `${y}年${m}月`;
};

/** 水生生物調査の水質階級 1〜4 → 色の段階。「ややきれいな水」までは きれい寄りにする */
const suiseiTone = (grade: number) => [0, 0, 1, 2][grade - 1];

/**
 * BOD 年平均 mg/L → 色の段階。境目は河川の環境基準の A（2 以下。ヤマメ・イワナ）と C（5 以下。コイ・フナ）。
 * 市民の水質調べの COD の境目（3・6）とおおよそ揃う
 */
const waterTone = (bod: number) => (bod <= 2 ? 0 : bod <= 5 ? 1 : 2);

/** 川の生きもの調べ・市民の水質調べの地点を、流路の順に色の点にする */
export function citizenDots(
  suisei: SurveyOnPath[],
  mizumap: SurveyOnPath[],
): SurveyDot[] {
  return [
    ...suisei.map((s) => ({
      step: s.step,
      kind: "citizen" as const,
      tone: suiseiTone(s.value),
      text: `${s.name}・${suiseiLabel(s.value)}（川の生きもの調べ・${month(s.date)}）`,
    })),
    ...mizumap.map((s) => ({
      step: s.step,
      kind: "citizen" as const,
      tone: codGrade(s.value).level,
      text: `${s.name}・${codGrade(s.value).label}・COD ${s.value}（市民の水質調べ・${month(s.date)}）`,
    })),
  ].sort((a, b) => a.step - b.step);
}

/** 環境省の測定点を、流路の順に色の点にする */
export function waterDots(stations: WaterOnPath[]): SurveyDot[] {
  return stations.map((w) => ({
    step: w.step,
    kind: "water" as const,
    tone: waterTone(w.bod),
    text: `${w.name}・${w.label}・BOD ${w.bod}（${w.year}年度の平均・環境省）`,
  }));
}
