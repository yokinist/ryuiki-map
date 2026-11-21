import { describe, expect, it } from "vitest";
import { waterGrade } from "../data/water";
import { waterDots } from "./survey-dots";

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
