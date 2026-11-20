import { describe, expect, it } from "vitest";
import {
  nearestStation,
  stationsNearPath,
  waterGrade,
  waterNearPath,
  waterScore,
  waterTrend,
} from "./water";

describe("waterNearPath", () => {
  // 東へまっすぐ約900m（経度0.01°）進む流路
  const pts: [number, number][] = [
    [138.0, 37.0],
    [138.005, 37.0],
    [138.01, 37.0],
  ];

  it("流路の近く（250m 以内）の測定点を、流路の順に拾う", () => {
    const found = waterNearPath({ pts }, [
      [138.0099, 37.0005, 4, "下の橋", 2024, null, []], // 約55m
      [138.0001, 37.0, 1, "上の橋", 2024, null, []],
      [138.005, 37.01, 9, "隣の川", 2024, null, []], // 約1.1km
    ]);
    expect(found.map((w) => [w.step, w.name])).toEqual([
      [0, "上の橋"],
      [2, "下の橋"],
    ]);
  });

  it("きれいさの段階が前と同じ測定点は出さず、変わった所だけ出す", () => {
    const found = waterNearPath({ pts }, [
      [138.0, 37.0, 1.2, "源流", 2024, null, []],
      [138.005, 37.0, 1.5, "中流", 2024, null, []], // 同じ「ヤマメ・イワナ」
      [138.01, 37.0, 2.5, "下流", 2024, null, []], // 「アユ」に変わる
    ]);
    expect(found.map((w) => w.name)).toEqual(["源流", "下流"]);
  });

  it("段階の境目のすぐ向こう（境目の値の2割以内）では、変わったとみなさない（境目を行き来して言葉がちらつかないように）", () => {
    const found = waterNearPath({ pts }, [
      [138.0, 37.0, 0.9, "源流", 2024, null, []], // 自然の清流なみ（1以下）
      [138.005, 37.0, 1.1, "中流", 2024, null, []], // ヤマメ・イワナだが、境目 1 の 1.2 倍以内
      [138.01, 37.0, 1.5, "下流", 2024, null, []], // はっきり越えた
    ]);
    expect(found.map((w) => w.name)).toEqual(["源流", "下流"]);
  });

  it("一度変わったら、境目のすぐ手前まで戻っただけでは戻さない", () => {
    const found = waterNearPath({ pts }, [
      [138.0, 37.0, 1.5, "源流", 2024, null, []], // ヤマメ・イワナ
      [138.005, 37.0, 0.9, "中流", 2024, null, []], // 自然の清流なみだが、境目 1 の 0.8 倍より上
      [138.01, 37.0, 0.7, "下流", 2024, null, []], // はっきり下回った
    ]);
    expect(found.map((w) => w.name)).toEqual(["源流", "下流"]);
  });

  it("段階が同じでも、前に出した点から50km 以上進んだら出す（長い川で、きれいなままなのが分かるように）", () => {
    const found = waterNearPath({ pts, dist: [0, 30_000, 60_000] }, [
      [138.0, 37.0, 1, "源流", 2024, null, []],
      [138.005, 37.0, 1, "30km 先", 2024, null, []],
      [138.01, 37.0, 1, "60km 先", 2024, null, []],
    ]);
    expect(found.map((w) => w.name)).toEqual(["源流", "60km 先"]);
  });
});

describe("waterNearPath の川の名前", () => {
  // 東へまっすぐ約900m進む流路。最初は本流、2点目から合流した「下流川」に変わる
  const pts: [number, number][] = [
    [138.0, 37.0],
    [138.005, 37.0],
    [138.01, 37.0],
  ];
  const rivers = [
    { name: "本流", step: 0 },
    { name: "下流川", step: 2 },
  ];

  it("測定点のある川が、流路のその位置の川と違えば出さない（近くを流れる支流の測定点）", () => {
    const found = waterNearPath({ pts, rivers }, [
      [138.0, 37.0, 1, "本流の橋", 2024, "本流", []],
      [138.005, 37.0, 9, "支流の橋", 2024, "支流", []], // 流路のそばだが、別の川
    ]);
    expect(found.map((w) => w.name)).toEqual(["本流の橋"]);
  });

  it("川の名前が分からない測定点は、近ければ出す", () => {
    const found = waterNearPath({ pts, rivers }, [
      [138.0, 37.0, 1, "名前のない川の橋", 2024, null, []],
    ]);
    expect(found.map((w) => w.name)).toEqual(["名前のない川の橋"]);
  });

  it("川が変わったあとの位置では、変わったあとの川の名前だけを通す", () => {
    const found = waterNearPath({ pts, rivers }, [
      [138.0099, 37.0, 1, "下流川の橋", 2024, "下流川", []],
      [138.0099, 37.0001, 9, "本流の橋", 2024, "本流", []], // 同じ位置だが、そこはもう下流川
    ]);
    expect(found.map((w) => w.name)).toEqual(["下流川の橋"]);
  });

  it("段階が同じでも、流路の川が変わったら、その川の最初の測定点を出す", () => {
    const found = waterNearPath({ pts, rivers }, [
      [138.0, 37.0, 1, "本流の橋", 2024, "本流", []],
      [138.005, 37.0, 1, "本流の下の橋", 2024, "本流", []],
      [138.01, 37.0, 1, "下流川の橋", 2024, "下流川", []],
    ]);
    expect(found.map((w) => w.name)).toEqual(["本流の橋", "下流川の橋"]);
  });
});

describe("推移", () => {
  const pts: [number, number][] = [
    [138.0, 37.0],
    [138.005, 37.0],
    [138.01, 37.0],
  ];

  it("測定点の推移は、過去の年度（測っていない年度は除く）と最新の年度を古い順に並べる", () => {
    const [w] = waterNearPath({ pts }, [
      [138.0, 37.0, 3.4, "亀の子橋", 2024, null, [9.3, null, 4]],
    ]);
    expect(w.history).toEqual([
      { year: 1994, bod: 9.3 },
      { year: 2014, bod: 4 },
      { year: 2024, bod: 3.4 },
    ]);
  });

  it("流域サマリ用には、段階が同じでも間引かずに、流路の順に全部返す", () => {
    const all = stationsNearPath({ pts }, [
      [138.01, 37.0, 1, "下流", 2024, null, []],
      [138.0, 37.0, 1, "源流", 2024, null, []],
      [138.005, 37.0, 1, "中流", 2024, null, []],
    ]);
    expect(all.map((w) => w.name)).toEqual(["源流", "中流", "下流"]);
  });

  it("いちばん古い年度と最新の年度を比べ、きれいさの点数が2以上上がれば「よくなった」", () => {
    expect(
      waterTrend([
        { year: 1994, bod: 9.3 },
        { year: 2024, bod: 3.4 },
      ]),
    ).toMatchObject({
      from: { year: 1994, bod: 9.3, label: "よごれが目立つ" },
      to: { year: 2024, bod: 3.4, label: "コイ・フナが棲めるくらい" },
      change: "よくなった",
    });
  });

  it("点数の差が1以内なら「ほぼ同じ」、2以上下がれば「わるくなった」", () => {
    const of = (a: number, b: number) =>
      waterTrend([
        { year: 1994, bod: a },
        { year: 2024, bod: b },
      ])?.change;
    expect(of(2.3, 1.6)).toBe("ほぼ同じ");
    expect(of(1, 4)).toBe("わるくなった");
  });

  it("流域サマリには、20km 以内で推移のある最初の測定点を選ぶ（なければ推移のない最初の点、それもなければ null）", () => {
    const st = (step: number, name: string, years: number[]) => ({
      step,
      name,
      bod: 1,
      year: 2024,
      level: 0,
      label: "",
      history: years.map((year) => ({ year, bod: 1 })),
    });
    const dist = [0, 5_000, 30_000];
    expect(
      nearestStation(
        [st(0, "今だけ", [2024]), st(1, "推移あり", [1994, 2024])],
        dist,
      )?.name,
    ).toBe("推移あり");
    expect(
      nearestStation(
        [st(0, "今だけ", [2024]), st(2, "遠い推移", [1994, 2024])],
        dist,
      )?.name,
    ).toBe("今だけ");
    expect(nearestStation([st(2, "遠い", [1994, 2024])], dist)).toBeNull();
  });

  it("比べる年度が1つしかなければ null", () => {
    expect(waterTrend([{ year: 2024, bod: 1 }])).toBeNull();
  });
});

describe("waterScore", () => {
  // 10段。環境基準の境目（1・2・3・5・8・10）は必ず段の境目にし、その間を割って細かくする（言葉の段階と食い違わないように）
  it("BOD を、きれいなほど大きい 1〜10 の点数にする", () => {
    expect(waterScore(0.5)).toBe(10);
    expect(waterScore(0.8)).toBe(9);
    expect(waterScore(1)).toBe(9);
    expect(waterScore(1.2)).toBe(8);
    expect(waterScore(1.9)).toBe(7);
    expect(waterScore(2.5)).toBe(6);
    expect(waterScore(3.5)).toBe(5);
    expect(waterScore(4.2)).toBe(4);
    expect(waterScore(6)).toBe(3);
    expect(waterScore(9)).toBe(2);
    expect(waterScore(38)).toBe(1);
  });

  it("言葉の段階の境目（BOD 1・2・3・5・8）をまたぐと、点数も必ず変わる", () => {
    for (const edge of [1, 2, 3, 5, 8])
      expect(waterScore(edge)).toBeGreaterThan(waterScore(edge + 0.01));
  });
});

describe("waterGrade", () => {
  // 河川の BOD の環境基準: AA ≤1（自然環境保全）、A ≤2（水産1級: ヤマメ・イワナ）、B ≤3（水産2級: アユ）、C ≤5（水産3級: コイ・フナ）、D ≤8（農業用水）
  it("BOD を、環境基準の類型が示す生きものと使いみちの言葉にする", () => {
    expect(waterGrade(0.5).label).toBe("自然の清流なみ");
    expect(waterGrade(1).label).toBe("自然の清流なみ");
    expect(waterGrade(1.1).label).toBe("ヤマメ・イワナが棲めるくらい");
    expect(waterGrade(2).label).toBe("ヤマメ・イワナが棲めるくらい");
    expect(waterGrade(2.1).label).toBe("アユが棲めるくらい");
    expect(waterGrade(3).label).toBe("アユが棲めるくらい");
    expect(waterGrade(5).label).toBe("コイ・フナが棲めるくらい");
    expect(waterGrade(8).label).toBe("田畑の水に使えるくらい");
    expect(waterGrade(8.1).label).toBe("よごれが目立つ");
  });
});
