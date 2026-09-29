import { defineConfig } from "@playwright/test";

// ブラウザで動かす E2E。流れの計算は Web Worker・OffscreenCanvas・国土地理院の標高タイルに依存するので、
// Vitest（Node）では動かせない分をここで守る。テストは e2e/ に置く（vitest は src/**/*.test.ts だけを見る）。
// BASE_URL を渡すと、手元のビルドではなくその URL（本番・PR のプレビュー）に対して走る。
// CI の workflow_dispatch の入力は未指定だと空文字で届くので、空も「渡していない」と見なす
const baseURL = process.env.BASE_URL || "http://localhost:4173";

export default defineConfig({
  testDir: "e2e",
  // 1地点で標高タイルを数〜十数MB読み、海まで数十秒たどる
  timeout: 240_000,
  expect: { timeout: 180_000 },
  // 国土地理院への問い合わせが重ならないように控えめに
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command:
          "pnpm build && pnpm exec vite preview --port 4173 --strictPort",
        url: "http://localhost:4173",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
