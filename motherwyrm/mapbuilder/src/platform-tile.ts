import { applyPaletteSwap, PALETTE_MARKERS } from "./palette";
import type { PlatformPalette } from "./types";

const TILE_W = 96;
const TILE_H = 16;

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

  ctx.fillStyle = PALETTE_MARKERS.highlight;
  ctx.fillRect(0, 0, TILE_W, 3);

  ctx.fillStyle = PALETTE_MARKERS.trim;
  ctx.fillRect(0, 3, TILE_W, 2);

  ctx.fillStyle = PALETTE_MARKERS.base;
  ctx.fillRect(0, 5, TILE_W, TILE_H - 8);

  ctx.fillStyle = PALETTE_MARKERS.shadow;
  ctx.fillRect(0, TILE_H - 3, TILE_W, 3);

  ctx.fillStyle = PALETTE_MARKERS.trim;
  ctx.fillRect(2, 6, 6, 4);
  ctx.fillRect(TILE_W - 8, 6, 6, 4);

  sourceCanvas = c;
  return c;
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
  const tile = getRecoloredTile(palette);
  const tw = tile.width;
  const th = tile.height;
  const bodyH = Math.max(h, th);

  let dx = x;
  const right = x + w;
  while (dx < right) {
    const sliceW = Math.min(tw, right - dx);
    ctx.drawImage(tile, 0, 0, sliceW, th, dx, y, sliceW, th);
    dx += tw;
  }

  if (bodyH > th) {
    ctx.fillStyle = palette.base;
    ctx.fillRect(x, y + th, w, bodyH - th);
    ctx.fillStyle = palette.shadow;
    ctx.fillRect(x, y + bodyH - 2, w, 2);
  }
}

export { TILE_W, TILE_H };
