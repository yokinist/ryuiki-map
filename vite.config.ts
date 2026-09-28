import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig, type Plugin } from "vite";
import { SITE, STRUCTURED_DATA } from "./site.config.ts";
import { SITE_FILES } from "./site.files.ts";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * index.html の {{キー}} を SITE の値に置き換え、構造化データを <head> に足す。
 * ないキーは書き間違いなのでビルドを止める。本番ではソース用の HTML コメントも外す
 */
const siteConfig = (): Plugin => ({
  name: "site-config",
  transformIndexHtml: (html, ctx) => ({
    html: (ctx.server
      ? html
      : html.replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*\n?/gm, "")
    ).replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      if (!Object.hasOwn(SITE, key)) {
        throw new Error(`index.html の {{${key}}} が site.config.ts にない`);
      }
      return escapeHtml(SITE[key as keyof typeof SITE]);
    }),
    tags: [
      {
        tag: "script",
        attrs: { type: "application/ld+json" },
        // </script> で閉じられないよう < をエスケープする
        children: JSON.stringify(STRUCTURED_DATA).replace(/</g, "\\u003c"),
        injectTo: "head",
      },
    ],
  }),
});

/** SITE_FILES をビルドでは dist に書き出し、開発サーバーではそのまま返す */
const siteFiles = (): Plugin => ({
  name: "site-files",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const file = SITE_FILES[req.url?.split("?")[0] ?? ""];
      if (!file) return next();
      res.setHeader("Content-Type", file[0]);
      res.end(file[1]);
    });
  },
  generateBundle() {
    if (this.environment.name !== "client") return;
    for (const [path, [, source]] of Object.entries(SITE_FILES))
      this.emitFile({ type: "asset", fileName: path.slice(1), source });
  },
});

/**
 * public/ の .txt（rivers・karte の README.txt など）を、本番の _headers と同じ
 * text/plain; charset=utf-8 で返す。開発サーバーは既定で charset を付けず文字化けするため
 */
const textFilesUtf8 = (): Plugin => ({
  name: "text-files-utf8",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = req.url?.split("?")[0] ?? "";
      if (!url.endsWith(".txt")) return next();
      const file = join(server.config.publicDir, url);
      if (!existsSync(file)) return next();
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(readFileSync(file));
    });
  },
});

export default defineConfig({
  plugins: [cloudflare(), siteConfig(), siteFiles(), textFilesUtf8()],
  // maplibre-gl 本体だけで約800KB。初回表示に必須なので分割せず、警告の閾値を上げる
  // ソースは公開しているので、本番でもソースマップを配って不具合を追いやすくする
  build: {
    chunkSizeWarningLimit: 1200,
    sourcemap: true,
    license: { fileName: "licenses.md" },
  },
});
