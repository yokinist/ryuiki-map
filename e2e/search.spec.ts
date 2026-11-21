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

test("動きを減らす設定でも、着いたら案内が出る", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const input = page.getByRole("combobox", { name: "地名で探す" });
  await input.fill("狛江");
  await expect(
    page.getByRole("option", { name: "東京都狛江市" }),
  ).toBeVisible();
  await input.press("Enter");
  await expect(page.locator(".hint")).toContainText("東京都狛江市");
});

test("続けて選ぶと、案内は最後に選んだ所の1つだけ出る", async ({ page }) => {
  await page.goto("/");
  const input = page.getByRole("combobox", { name: "地名で探す" });
  await input.fill("狛江");
  await expect(
    page.getByRole("option", { name: "東京都狛江市" }),
  ).toBeVisible();
  await input.press("Enter");
  // 1つ目の移動の途中で次を選ぶ
  await input.fill("軽井沢");
  await page
    .getByRole("option", { name: "長野県軽井沢町", exact: true })
    .click();
  await expect(page.locator(".hint")).toContainText("長野県軽井沢町");
  await page.waitForTimeout(1000);
  await expect(page.locator(".hint")).toHaveCount(1);
});

test("地形を読み込んでいる途中で検索すると、そのクリックは取り消し、検索した所に留まる", async ({
  page,
}) => {
  await page.goto("/?p=135.5144,34.7237");
  // 共有された地点（淀川）の地形を読み込み始めた
  await expect(page.locator("#panel")).toHaveAttribute("data-state", "result");
  const input = page.getByRole("combobox", { name: "地名で探す" });
  await input.fill("狛江");
  await expect(
    page.getByRole("option", { name: "東京都狛江市" }),
  ).toBeVisible();
  await input.press("Enter");
  await expect(page.locator(".hint")).toContainText("東京都狛江市");
  expect(new URL(page.url()).searchParams.get("p")).toBeNull();
  // 読み込みが終わっても、淀川の雨は流さず、地図も引き戻さない
  await page.waitForTimeout(20_000);
  await expect(page.locator("#panel")).not.toHaveAttribute(
    "data-state",
    "result",
  );
  const c = center(page.url());
  expect(Math.abs(c.lng - 139.5786)).toBeLessThan(0.05);
});

test("検索のあと地図をクリックすると、案内が消えて雨の流れをたどり始める", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByRole("combobox", { name: "地名で探す" });
  await input.fill("狛江");
  await expect(
    page.getByRole("option", { name: "東京都狛江市" }),
  ).toBeVisible();
  await input.press("Enter");
  await expect(page.locator(".hint")).toContainText("東京都狛江市");
  await page.locator("#map canvas").click({ position: { x: 900, y: 600 } });
  await expect(page.locator(".hint--place")).toHaveCount(0);
  await expect(page.locator("#panel")).toHaveAttribute("data-state", "result");
});

test("移る途中で地図をドラッグしたら、着いていないので案内を出さない", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByRole("combobox", { name: "地名で探す" });
  await input.fill("札幌");
  await expect(page.getByRole("option").first()).toBeVisible();
  await input.press("Enter");
  await page.waitForTimeout(300);
  await page.mouse.move(800, 500);
  await page.mouse.down();
  await page.mouse.move(700, 450, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(4000);
  await expect(page.locator(".hint--place")).toHaveCount(0);
});
