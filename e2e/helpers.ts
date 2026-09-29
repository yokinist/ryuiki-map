import { expect, type Locator, type Page } from "@playwright/test";

/** 河口（または水源）に着くまで待つ。着くと「この結果を共有する」が出る */
export async function waitForArrival(page: Page) {
  await expect(page.locator("#share")).toBeVisible();
}

/** 「24.0 km」「213.4 km上流」「820 m」のような文字から距離 km を読む（format.ts の km は 1km 未満を m で出す） */
export function kmOf(text: string): number {
  // km を先に探す（「標高 1,999 m」のような別の値を拾わないように）。km がなければ m
  const km = text.match(/([\d,]+(?:\.\d+)?) km/);
  if (km) return Number(km[1].replace(/,/g, ""));
  const m = text.match(/([\d,]+) m(?![a-z])/);
  if (!m) throw new Error(`距離が見つかりません: ${text}`);
  return Number(m[1].replace(/,/g, "")) / 1000;
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
