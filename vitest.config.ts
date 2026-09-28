import { defineConfig } from "vitest/config";

// vite.config.ts の Cloudflare プラグインはテストと相性が悪く、
// テスト対象は DOM も Worker ランタイムも使わない純粋なロジックなので分けている。
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
