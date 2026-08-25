const FEET_TO_M = 0.3048;

/** Normalized canopy radius from mature diameter in feet. */
export function canopyRadiusNorm(
  canopyDiameterFt: number,
  displayW: number,
  displayH: number,
  pixelsPerFoot?: number
): number {
  const radiusFt = canopyDiameterFt / 2;
  if (pixelsPerFoot != null && pixelsPerFoot > 0) {
    const radiusPx = radiusFt * pixelsPerFoot;
    return Math.min(0.45, radiusPx / Math.max(displayW, displayH));
  }
  // Uncalibrated: scale relative to a ~20 ft reference canopy (~8% of image width).
  const refNorm = (canopyDiameterFt / 20) * 0.08;
  return Math.min(0.18, Math.max(0.006, refNorm / 2));
}

/** Canopy radius in image pixels (for georeferenced geometry). */
export function canopyRadiusPx(
  canopyDiameterFt: number,
  pixelsPerFoot?: number,
  displayW?: number,
  displayH?: number
): number {
  const radiusFt = canopyDiameterFt / 2;
  if (pixelsPerFoot != null && pixelsPerFoot > 0) {
    return radiusFt * pixelsPerFoot;
  }
  const norm = canopyRadiusNorm(
    canopyDiameterFt,
    displayW ?? 1000,
    displayH ?? 750
  );
  return norm * Math.max(displayW ?? 1000, displayH ?? 750);
}

/** Ground radius in metres for projected point geometry. */
export function canopyRadiusMeters(canopyDiameterFt: number): number {
  return (canopyDiameterFt / 2) * FEET_TO_M;
}

export function plantNotes(plant: {
  botanicalName: string;
  sun: string;
  water: string;
  canopyDiameterFt: number;
}): string {
  return `${plant.botanicalName} · ~${plant.canopyDiameterFt} ft canopy · ${plant.sun} · ${plant.water}`;
}
