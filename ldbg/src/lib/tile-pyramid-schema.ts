import { z } from "zod";

export const TilePyramidSchema = z.object({
  root: z.string(),
  tileSize: z.number().int().positive().default(256),
  minZoom: z.number().int().nonnegative().default(0),
  maxZoom: z.number().int().nonnegative(),
  fullWidthPx: z.number().int().positive(),
  fullHeightPx: z.number().int().positive(),
  builtAt: z.string(),
});

export const PrintOrthoSchema = z.object({
  filename: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  longEdgePx: z.number().int().positive(),
  sourceWidthPx: z.number().int().positive(),
  sourceHeightPx: z.number().int().positive(),
  downscaleFactor: z.number().positive(),
  exportedAt: z.string(),
});

export type TilePyramid = z.infer<typeof TilePyramidSchema>;
export type PrintOrtho = z.infer<typeof PrintOrthoSchema>;

export const PRINT_ORTHO_FILENAME = "print-ortho.jpg";
export const DEFAULT_PRINT_LONG_EDGE = 12000;

/** Source pixels covered by one tile edge at zoom z. */
export function pixelsPerTileAtZoom(pyramid: TilePyramid, z: number): number {
  return pyramid.tileSize * 2 ** (pyramid.maxZoom - z);
}

/** Pick pyramid zoom for editor display scale. */
export function pickTileZoom(
  pyramid: TilePyramid,
  fullWidth: number,
  displayWidth: number
): number {
  if (displayWidth <= 0 || fullWidth <= 0) return pyramid.maxZoom;
  const scale = displayWidth / fullWidth;
  const raw = pyramid.maxZoom + Math.log2(Math.max(scale, 1e-6));
  const z = Math.round(raw);
  return Math.min(pyramid.maxZoom, Math.max(pyramid.minZoom, z));
}

export function tileIndicesForViewport(
  pyramid: TilePyramid,
  z: number,
  viewX: number,
  viewY: number,
  viewW: number,
  viewH: number
): { x: number; y: number }[] {
  const ppt = pixelsPerTileAtZoom(pyramid, z);
  const x0 = Math.max(0, Math.floor(viewX / ppt));
  const y0 = Math.max(0, Math.floor(viewY / ppt));
  const x1 = Math.floor((viewX + viewW) / ppt);
  const y1 = Math.floor((viewY + viewH) / ppt);
  const maxX = Math.ceil(pyramid.fullWidthPx / ppt);
  const maxY = Math.ceil(pyramid.fullHeightPx / ppt);
  const out: { x: number; y: number }[] = [];
  for (let ty = y0; ty <= y1 && ty < maxY; ty++) {
    for (let tx = x0; tx <= x1 && tx < maxX; tx++) {
      out.push({ x: tx, y: ty });
    }
  }
  return out;
}
