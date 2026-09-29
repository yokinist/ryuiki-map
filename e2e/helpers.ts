import { expect, type Locator, type Page } from "@playwright/test";

/** 河口（または水源）に着くまで待つ。着くと「この結果を共有する」が出る */
export async function waitForArrival(page: Page) {
  await expect(page.locator("#share")).toBeVisible();
}

/** 「24.0 km」「213.4 km上流」のような文字から距離 km を読む */
export function kmOf(text: string): number {
  const m = text.match(/([\d,]+(?:\.\d+)?) km/);
  if (!m) throw new Error(`距離が見つかりません: ${text}`);
  return Number(m[1].replace(/,/g, ""));
}

/** 距離が期待値の ±10% に入っているか（計算の細部で揺れるので幅を持たせる） */
export function expectKmNear(text: string, km: number) {
  const got = kmOf(text);
  expect(
    got,
    `距離 ${got} km が ${km} km の ±10% に入っていない`,
  ).toBeGreaterThanOrEqual(km * 0.9);
  expect(
    got,
    `距離 ${got} km が ${km} km の ±10% に入っていない`,
  ).toBeLessThanOrEqual(km * 1.1);
}

/** 表示中の時系列（雨の通り道 or 水の来た道）の最後の行 */
export function lastRow(list: Locator) {
  return list.locator("li").last();
}
