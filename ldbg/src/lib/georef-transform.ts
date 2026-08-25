import type { AffineTransform } from "@/lib/project-schema";

export type ProjectedPoint = { x: number; y: number; z?: number };
export type PixelPoint = { x: number; y: number };

/** Rasterio affine: worldX = a*col + b*row + c, worldY = d*col + e*row + f */
export function pixelToProjected(
  col: number,
  row: number,
  affine: AffineTransform
): ProjectedPoint {
  return {
    x: affine.a * col + affine.b * row + affine.c,
    y: affine.d * col + affine.e * row + affine.f,
  };
}

export function projectedToPixel(
  x: number,
  y: number,
  affine: AffineTransform
): PixelPoint {
  const det = affine.a * affine.e - affine.b * affine.d;
  if (Math.abs(det) < 1e-12) {
    throw new Error("Singular affine transform");
  }
  const dx = x - affine.c;
  const dy = y - affine.f;
  const col = (affine.e * dx - affine.b * dy) / det;
  const row = (-affine.d * dx + affine.a * dy) / det;
  return { x: col, y: row };
}

/** Scale affine for a downsampled raster (full pixels → display pixels). */
export function scaleAffine(affine: AffineTransform, factor: number): AffineTransform {
  return {
    a: affine.a * factor,
    b: affine.b * factor,
    c: affine.c,
    d: affine.d * factor,
    e: affine.e * factor,
    f: affine.f,
  };
}

export function projectedDistanceMeters(a: ProjectedPoint, b: ProjectedPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function polygonAreaSqMeters(coords: ProjectedPoint[]): number {
  if (coords.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    sum += coords[i].x * coords[j].y - coords[j].x * coords[i].y;
  }
  return Math.abs(sum) / 2;
}

export function polylineLengthMeters(coords: ProjectedPoint[]): number {
  let len = 0;
  for (let i = 1; i < coords.length; i++) {
    len += projectedDistanceMeters(coords[i - 1], coords[i]);
  }
  return len;
}

export function polygonPerimeterMeters(coords: ProjectedPoint[]): number {
  if (coords.length < 2) return 0;
  let len = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    len += projectedDistanceMeters(coords[i], coords[j]);
  }
  return len;
}

export const SQ_METERS_TO_SQ_FT = 10.76391041671;
export const METERS_TO_FEET = 3.280839895;

export function sqMetersToSqFt(m2: number): number {
  return m2 * SQ_METERS_TO_SQ_FT;
}

export function metersToFeet(m: number): number {
  return m * METERS_TO_FEET;
}
