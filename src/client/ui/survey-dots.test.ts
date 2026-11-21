import { describe, expect, it } from "vitest";
import { waterGrade } from "../data/water";
import { citizenDots, surveyDownstream, waterDots } from "./survey-dots";

describe("waterDots", () => {
  const station = (bod: number) => ({
    step: 2,
    name: "大正橋",
    bod,
    year: 2024,
    ...waterGrade(bod),
    history: [{ year: 2024, bod }],
  });

  it("環境省の測定点を、BOD で3つの色の段階に分ける（2以下・5以下・5より上。河川の環境基準の A と C の上限）", () => {
    expect(
      waterDots([0.5, 2, 2.1, 5, 5.1].map(station)).map((d) => d.tone),
    ).toEqual([0, 0, 1, 1, 2]);
  });

  it("押したときに出す中身は、地点名・きれいさの言葉・BOD・年度", () => {
    expect(waterDots([station(1.6)])[0]).toMatchObject({
      step: 2,
      kind: "water",
      text: "大正橋・ヤマメ・イワナが棲めるくらい・BOD 1.6（2024年度の平均・環境省）",
    });
  });
});

describe("surveyDownstream", () => {
  const dot = (step: number, tone: number) => ({
    step,
    kind: "citizen" as const,
    tone,
    text: `地点${step}`,
  });
  // 流路の各点までの長さ m
  const dist = [0, 500, 8_000, 19_000, 25_000];

  it("この地点から下流20km 以内の地点を、色の段階ごとに数え、いちばん近い地点と距離を返す", () => {
    const s = surveyDownstream(
      [dot(1, 0), dot(2, 1), dot(3, 0), dot(4, 2)],
      dist,
    );
    expect(s).toMatchObject({
      tones: [2, 1, 0],
      nearest: { dot: { step: 1 }, m: 500 },
    });
    expect(s?.dots.map((d) => d.step)).toEqual([1, 2, 3]);
  });

  it("20km 以内に地点がなければ null", () => {
    expect(surveyDownstream([dot(4, 0)], dist)).toBeNull();
  });
});

describe("citizenDots", () => {
  const s = (value: number, date = "2025-06-08") => ({
    step: 1,
    name: "大師橋",
    value,
    date,
  });

  it("帯に並べる短い中身は、場所と結果だけ（COD は値も）。押したときの中身には調査の名前と年月も添える", () => {
    // 同じ位置なら生きもの調べ・水質調べの順
    const [bio, cod] = citizenDots([s(2, "2025-07-26")], [s(3)]);
    expect([bio.short, cod.short]).toEqual([
      "大師橋・ややきれいな水",
      "大師橋・少しよごれている（COD 3）",
    ]);
    expect(cod.text).toBe(
      "大師橋・少しよごれている・COD 3（市民の水質調べ・2025年6月）",
    );
  });
});
