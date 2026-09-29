import { expect, test } from "@playwright/test";
import { expectKmNear, lastRow, waitForArrival } from "./helpers";

// 代表地点。計算やデータを変えて結果が変わったことに気づくための表。1行足せば地点が増える。
// 期待値は実際の表示から置いている（距離は ±10%）

/** 下り（海へ）。sea は見出しの海、mouth は最後の行に出る河口の名前と地名 */
const down = [
  {
    name: "多摩川 狛江付近",
    p: "139.6008,35.6172",
    sea: "太平洋",
    mouth: /多摩川河口（東京都大田区/,
    km: 24.0,
  },
  {
    name: "信濃川 長岡付近",
    p: "138.8419,37.4577",
    sea: "日本海",
    mouth: /信濃川河口（新潟県新潟市中央区/,
    km: 81.8,
  },
  {
    name: "淀川 大阪付近",
    p: "135.5144,34.7237",
    sea: "瀬戸内海",
    mouth: /淀川河口（大阪府大阪市西淀川区/,
    km: 9.9,
  },
];

/**
 * 上り（水源へ）。reached: 水源に着くか。集水域が広域グリッド（約190km四方）に収まらない大きな川は、
 * さかのぼり専用の粗い範囲（約360km四方）を読んで水源まで届かせる（#3）。それにも収まらなければ「追いきれませんでした」
 */
const up = [
  {
    name: "多摩川 狛江付近",
    p: "139.6008,35.6172",
    reached: true,
    source: /水源（埼玉県秩父市/,
    km: 104.8,
  },
  {
    name: "利根川 取手付近",
    p: "140.0011,35.9093",
    reached: true,
    source: /水源（群馬県みなかみ町/, // 大水上山（利根川の水源）
    km: 216.3,
  },
  {
    name: "北上川 一関付近",
    p: "141.2673,38.7115",
    reached: true,
    source: /水源（岩手県(盛岡市|岩手町)/, // 北上山地の北端（岩手町御堂〜盛岡市玉山）
    km: 242.6,
  },
  {
    name: "石狩川 江別付近",
    p: "141.5598,43.1185",
    reached: true,
    source: /水源（北海道上川町/, // 石狩岳
    km: 237.9,
  },
  {
    // 信濃川の集水域は南北に長く、360km四方の粗い範囲にも収まらない。#4 で範囲の形を集水域に合わせると届く
    name: "信濃川 長岡付近",
    p: "138.8419,37.4577",
    reached: false,
    source: /この先は追いきれませんでした/,
    km: 289.3,
  },
];

for (const c of down) {
  test(`下り: ${c.name} → ${c.sea} ${c.km}km`, async ({ page }) => {
    await page.goto(`/?p=${c.p}`);
    await waitForArrival(page);
    await expect(page.locator("#headline")).toHaveText(
      `${c.sea}にたどり着きました`,
    );
    const end = lastRow(page.locator("#timeline"));
    await expect(end).toContainText(`${c.sea}へ`);
    await expect(end).toContainText(c.mouth);
    expectKmNear(await end.innerText(), c.km);
  });
}

for (const c of up) {
  test(`上り: ${c.name} → ${c.reached ? "水源" : "追いきれない"} ${c.km}km`, async ({
    page,
  }) => {
    await page.goto(`/?p=${c.p}&dir=up`);
    await waitForArrival(page);
    await expect(page.locator("#headline")).toHaveText(
      c.reached ? "水源にたどり着きました" : "水源まで追いきれませんでした",
    );
    const end = lastRow(page.locator("#source-timeline"));
    await expect(end).toContainText(c.source);
    expectKmNear(await end.innerText(), c.km);
  });
}
