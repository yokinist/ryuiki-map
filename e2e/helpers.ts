import { expect, type Locator, type Page, test } from "@playwright/test";

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

/**
 * 地名（国土地理院の逆ジオコーダ）を確かめる。地名は着いたあとに届き、アプリは20秒で打ち切る（config.ts の GEOCODER）。
 * 逆ジオコーダが答えなかった（打ち切り・エラー）問い合わせがあり、その行に地名（「（…）」）が出ていないときだけ、
 * 外部の不調として確かめずに注記を残す。地名が出ていて違えば失敗させる。page.goto の前に呼ぶ
 */
export function watchPlaces(page: Page) {
  let failed = 0;
  const isGeocoder = (url: string) => url.includes("reverse-geocoder");
  page.on("requestfailed", (r) => {
    if (isGeocoder(r.url())) failed++;
  });
  page.on("response", (r) => {
    if (isGeocoder(r.url()) && !r.ok()) failed++;
  });
  return async (row: Locator, place: RegExp) => {
    try {
      await expect(row).toContainText(place, { timeout: 60_000 });
    } catch (e) {
      // 途中の地点だけ打ち切られた日に、河口・水源の地名の誤りを見逃さないよう、地名が出ていれば失敗させる
      if (!failed || (await row.innerText()).includes("（")) throw e;
      const note = `逆ジオコーダが ${failed} 件答えなかったので、地名 ${place} は確かめていない`;
      test.info().annotations.push({ type: "warning", description: note });
      console.warn(note);
    }
  };
}
