// public/og.png（共有時の画像 1200×630）を、site.config.ts の文言で描き直す。
// 左に名前・stage・ogTagline、右に地図の素材 assets/og-map.png を置く。
//
//   pnpm build:og
//
// ponytail: 文字は OS に入っているヒラギノ（macOS）で描く。ほかの環境で要るならフォントファイルを置いて fontFiles で渡す
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { SITE } from "../site.config.ts";

const root = join(import.meta.dirname, "..");
const [W, H, LEFT, MAP_X, GAP] = [1200, 630, 80, 590, 44];
const RIGHT = MAP_X - GAP; // 左の文字はここまでに収める
// tokens.css の --color-ink / --color-ink-muted / --color-drop
const INK = "#1b1f24";
const MUTED = "#667080";
const DROP = "#d6336c"; // 雨粒と主操作の色。右の地図の雨粒の点とも同じ
const FONT = "Hiragino Sans";

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const text = (
  s: string,
  size: number,
  weight: number,
  x = 0,
  y = 0,
  fill = INK,
) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(s)}</text>`;

const render = (body: string) =>
  new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`,
    { font: { loadSystemFonts: true, defaultFontFamily: FONT } },
  );

/** 基準線を y=BASE に置いたときの字面の位置と大きさ */
const BASE = 400;
const measure = (s: string, size: number, weight: number) => {
  const box = render(text(s, size, weight, 0, BASE)).innerBBox();
  if (!box) throw new Error(`「${s}」を描けない（${FONT} がない？）`);
  return {
    width: box.width,
    top: box.y - BASE,
    bottom: box.y + box.height - BASE,
  };
};

/** max から縮めて、横幅が width に収まる最大の文字サイズ */
const fitSize = (width: (size: number) => number, max: number) => {
  let size = max;
  while (size > 12 && width(size) > RIGHT - LEFT) size--;
  return size;
};

const stageSize = (size: number) => Math.round(size * 0.5);
const stageGap = (size: number) => Math.round(size * 0.12);
const nameSize = fitSize(
  (size) =>
    measure(SITE.name, size, 800).width +
    (SITE.stage
      ? stageGap(size) + measure(SITE.stage, stageSize(size), 600).width
      : 0),
  60,
);
const tagSize = fitSize((size) => measure(SITE.ogTagline, size, 600).width, 34);

const name = measure(SITE.name, nameSize, 800);
const tag = measure(SITE.ogTagline, tagSize, 600);
const TAG_GAP = 34;
const nameHeight = name.bottom - name.top;
// 名前の上に置く短い線（アプリの進み具合のバーと同じ色・丸み）
const [BAR_W, BAR_H, BAR_GAP] = [56, 6, 30];
const blockHeight =
  BAR_H + BAR_GAP + nameHeight + TAG_GAP + (tag.bottom - tag.top);

// 線・名前・タグラインをひとかたまりにして、上下の中央に置く
const barTop = Math.round((H - blockHeight) / 2);
const top = barTop + BAR_H + BAR_GAP;
const nameBase = top - name.top;
const tagBase = top + nameHeight + TAG_GAP - tag.top;
const parts = [
  `<rect width="${W}" height="${H}" fill="#fff"/>`,
  `<image x="${MAP_X}" y="0" width="${W - MAP_X}" height="${H}" href="data:image/png;base64,${readFileSync(join(root, "assets", "og-map.png")).toString("base64")}"/>`,
  `<rect x="${LEFT + 3}" y="${barTop}" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${DROP}"/>`,
  text(SITE.name, nameSize, 800, LEFT, nameBase),
];
if (SITE.stage) {
  const small = stageSize(nameSize);
  const s = measure(SITE.stage, small, 600);
  // stage の下端を名前の下端に揃える
  parts.push(
    text(
      SITE.stage,
      small,
      600,
      LEFT + name.width + stageGap(nameSize),
      nameBase + name.bottom - s.bottom,
      MUTED,
    ),
  );
}
parts.push(text(SITE.ogTagline, tagSize, 600, LEFT, tagBase, MUTED));

const out = join(root, "public", "og.png");
writeFileSync(out, render(parts.join("")).render().asPng());
console.log(`${out}: 名前 ${nameSize}px・タグライン ${tagSize}px`);
