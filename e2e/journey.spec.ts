import { expect, test } from "@playwright/test";
import { waitForArrival } from "./helpers";

// 上り下りの切り替えを、淀川（速く終わる）で1本通す

test("河口に着く → 上流へさかのぼる（URL に dir=up）→ 下流へくだる（dir が消える）", async ({
  page,
}) => {
  await page.goto("/?p=135.5144,34.7237");
  await waitForArrival(page);
  await expect(page.locator("#headline")).toHaveText(
    "瀬戸内海にたどり着きました",
  );
  expect(new URL(page.url()).searchParams.get("dir")).toBeNull();

  await page.getByRole("button", { name: "上流へさかのぼる" }).click();
  // さかのぼっている間は共有が隠れ、水源に着くとまた出る
  await expect(page.locator("#share")).toBeHidden();
  await waitForArrival(page);
  // 淀川の集水域（琵琶湖を含む）は広域グリッドに収まらないが、さかのぼり専用の粗い範囲を読んで水源（高時川の源流）に届く（#3）
  await expect(page.locator("#headline")).toHaveText("水源にたどり着きました");
  expect(new URL(page.url()).searchParams.get("dir")).toBe("up");

  await page.getByRole("button", { name: "下流へくだる" }).click();
  await expect(page.locator("#share")).toBeHidden();
  await waitForArrival(page);
  await expect(page.locator("#headline")).toHaveText(
    "瀬戸内海にたどり着きました",
  );
  expect(new URL(page.url()).searchParams.get("dir")).toBeNull();
});
