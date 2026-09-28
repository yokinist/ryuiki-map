import { SOURCES } from "../config";
import type { GridSpec } from "./grid-spec";

/** 地理院 標高タイル (dem_png): RGB = 0.01m 単位の24bit符号付き整数、0x800000 = 無効値（海） */
export async function loadDemTile(
  g: GridSpec,
  tx: number,
  ty: number,
  elev: Float32Array,
) {
  const res = await fetch(SOURCES.dem(g.Z, tx, ty));
  if (!res.ok) return; // 海だけのタイルは 404 → NaN のまま
  const bmp = await createImageBitmap(await res.blob(), {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  const ctx = new OffscreenCanvas(256, 256).getContext("2d", {
    willReadFrequently: true,
  });
  if (!ctx) throw new Error("OffscreenCanvas 2d context is unavailable");
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, 256, 256).data;
  const ox = (tx - g.tx0) * 256;
  const oy = (ty - g.ty0) * 256;
  for (let j = 0; j < 256; j++)
    for (let i = 0; i < 256; i++) {
      const p = (j * 256 + i) * 4;
      const v = (d[p] << 16) | (d[p + 1] << 8) | d[p + 2];
      elev[(oy + j) * g.W + ox + i] =
        v === 0x800000 ? Number.NaN : (v < 0x800000 ? v : v - 0x1000000) * 0.01;
    }
}
