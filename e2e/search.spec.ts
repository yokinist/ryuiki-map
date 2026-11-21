import { expect, test } from "@playwright/test";

/** 地図の中心（MapLibre が URL の # に入れる「#ズーム/緯度/経度」） */
const center = (url: string) => {
  const [zoom, lat, lng] = new URL(url).hash.slice(1).split("/").map(Number);
  return { zoom, lat, lng };
};

test("地名を打つと候補が出て、選ぶとその場所へ地図が動く", async ({ page }) => {
  await page.goto("/");
  const input = page.getByRole("combobox", { name: "地名で探す" });
  await input.fill("奥多摩 日原");
  const option = page.getByRole("option", {
    name: "東京都奥多摩町 日原",
  });
  await expect(option).toBeVisible();
  await input.press("Enter");
  // 雨は自動では降らせないので、クリックすればたどれることを添える
  const hint = page.locator(".hint");
  await expect(hint).toContainText("東京都奥多摩町 日原");
  await expect(hint).toContainText("地図をクリックすると");
  // パネルを避けた中心なので、地点そのものとは少しずれる
  const c = center(page.url());
  expect(c.zoom).toBeCloseTo(14, 1);
  expect(Math.abs(c.lat - 35.8566)).toBeLessThan(0.02);
  expect(Math.abs(c.lng - 139.0065)).toBeLessThan(0.05);
});

test("合う地名がなければそう伝える", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "地名で探す" }).fill("ああああ");
  await expect(page.getByText("見つかりませんでした")).toBeVisible();
});
