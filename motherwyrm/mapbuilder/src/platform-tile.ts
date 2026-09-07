import { applyPaletteSwap, PALETTE_MARKERS } from "./palette";
import type { PlatformPalette } from "./types";

const TILE_W = 96;
const TILE_H = 16;

/** Layer thicknesses for the 16px reference cap (top → bottom). */
const LAYER_FRAC = {
  highlight: 3 / TILE_H,
  trim: 2 / TILE_H,
  shadow: 3 / TILE_H,
} as const;

let sourceCanvas: HTMLCanvasElement | null = null;

/**
 * Procedural platform cap tile with indexed palette marker colors.
 * Replace with authored PNG art using the same marker colors when ready.
 */
export function getPlatformSourceTile(): HTMLCanvasElement {
  if (sourceCanvas) return sourceCanvas;

  const c = document.createElement("canvas");
  c.width = TILE_W;
  c.height = TILE_H;
  const ctx = c.getContext("2d")!;
  drawLayeredPlatform(ctx, 0, 0, TILE_W, TILE_H, PALETTE_MARKERS, true);
  sourceCanvas = c;
  return c;
}

/** Draw platform layers top→bottom: highlight, trim, base, shadow. */
export function drawLayeredPlatform(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  palette: PlatformPalette,
  trimAccents = false
): void {
  const hi = Math.max(2, Math.round(h * LAYER_FRAC.highlight));
  const trim = Math.max(1, Math.round(h * LAYER_FRAC.trim));
  const shadow = Math.max(2, Math.round(h * LAYER_FRAC.shadow));
  const base = Math.max(1, h - hi - trim - shadow);

  let dy = y;
  ctx.fillStyle = palette.highlight;
  ctx.fillRect(x, dy, w, hi);
  dy += hi;

  ctx.fillStyle = palette.trim;
  ctx.fillRect(x, dy, w, trim);
  dy += trim;

  ctx.fillStyle = palette.base;
  ctx.fillRect(x, dy, w, base);
  if (trimAccents && base >= 4) {
    ctx.fillStyle = palette.trim;
    ctx.fillRect(x + 2, dy + 1, 6, Math.min(4, base - 2));
    ctx.fillRect(x + w - 8, dy + 1, 6, Math.min(4, base - 2));
  }
  dy += base;

  ctx.fillStyle = palette.shadow;
  ctx.fillRect(x, dy, w, shadow);
}

const recolorCache = new Map<string, HTMLCanvasElement>();

export function getRecoloredTile(palette: PlatformPalette): HTMLCanvasElement {
  const key = JSON.stringify(palette);
  const hit = recolorCache.get(key);
  if (hit) return hit;

  const src = getPlatformSourceTile();
  const c = document.createElement("canvas");
  c.width = TILE_W;
  c.height = TILE_H;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, TILE_W, TILE_H);
  applyPaletteSwap(img, palette);
  ctx.putImageData(img, 0, 0);
  recolorCache.set(key, c);
  return c;
}

export function drawPlatformCap(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  palette: PlatformPalette
): void {
  if (h <= TILE_H) {
    const tile = getRecoloredTile(palette);
    let dx = x;
    const right = x + w;
    while (dx < right) {
      const sliceW = Math.min(TILE_W, right - dx);
      ctx.drawImage(tile, 0, 0, sliceW, TILE_H, dx, y, sliceW, h);
      dx += TILE_W;
    }
    return;
  }

  drawLayeredPlatform(ctx, x, y, w, h, palette, true);
}

export { TILE_W, TILE_H };
