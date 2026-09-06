import { getDecorativeObjectByFeatureType } from "@/config/decorative-objects";
import type { LegendEntry } from "@/config/legend";
import { isPlantPointFeatureType } from "@/config/utah-plants";
import type { LegendRow } from "@/lib/plan-layout";

export const LEGEND_ESTIMATE_DISCLAIMER =
  "Quantities and areas shown are preliminary estimates and may change during design " +
  "development and construction. Areas are given as three figures — the scale " +
  "reference measured 1 ft short, as entered, and 1 ft long.";

export type AreaMeasureOptions = {
  /** Manual calibration reference distance (ft) used for ±1 ft scale band. */
  calibrationDistanceFeet?: number;
};

/**
 * Every area on the sheet is only as good as the one distance the plan was
 * calibrated against, and the error squares. A 40 ft reference read 1 ft short
 * moves a 1,500 sq ft lawn by about 75 sq ft, so the low/measured/high triple
 * says plainly how much of the number is scale rather than design.
 */
function areaRangeFromCalibration(
  areaSqFt: number,
  distanceFeet: number
): { low: number; mid: number; high: number } | null {
  if (distanceFeet <= 1) return null;
  const low = areaSqFt * ((distanceFeet - 1) / distanceFeet) ** 2;
  const high = areaSqFt * ((distanceFeet + 1) / distanceFeet) ** 2;
  return {
    low: Math.max(0, Math.round(low)),
    mid: Math.round(areaSqFt),
    high: Math.round(high),
  };
}

/** "1,410 / 1,500 / 1,595 sq ft", or a single figure when scale is unknown. */
function formatSqFt(areaSqFt: number, options?: AreaMeasureOptions): string {
  const dist = options?.calibrationDistanceFeet;
  if (dist != null && dist > 1) {
    const range = areaRangeFromCalibration(areaSqFt, dist);
    if (range) {
      return `~${range.low.toLocaleString()} / ${range.mid.toLocaleString()} / ${range.high.toLocaleString()} sq ft`;
    }
  }
  return `~${Math.round(areaSqFt).toLocaleString()} sq ft`;
}

function decorativeFootprintSuffix(featureType: string): string | null {
  const deco = getDecorativeObjectByFeatureType(featureType);
  if (!deco) return null;
  if (featureType.includes("round") || featureType.endsWith("_round")) {
    return ` — Ø${deco.sizeFt} ft`;
  }
  return ` — ${deco.sizeFt}×${deco.sizeFt} ft`;
}

/** Suffix for a legend row (quantity, sq ft, footprint, etc.). */
export function formatLegendRowMeasure(
  row: LegendRow,
  legend: LegendEntry[],
  options?: AreaMeasureOptions
): string {
  const entry = legend.find((e) => e.featureType === row.featureType);
  const unit = entry?.unit;

  const footprint = decorativeFootprintSuffix(row.featureType);
  if (footprint && unit === "each") {
    return footprint;
  }

  if (
    row.quantity != null &&
    row.quantity > 0 &&
    isPlantPointFeatureType(row.featureType)
  ) {
    return ` — qty ${row.quantity}`;
  }

  if (unit === "each") {
    if (row.quantity != null && row.quantity > 1) {
      return ` — qty ${row.quantity}`;
    }
    return "";
  }

  if (unit === "sqft" && row.areaSqFt != null) {
    return ` — ${formatSqFt(row.areaSqFt, options)}`;
  }

  if (unit === "lf" && row.lengthLf != null) {
    return ` — ~${Math.round(row.lengthLf).toLocaleString()} LF`;
  }

  return "";
}

export function formatFeatureAreaLabel(
  areaSqFt: number,
  featureType: string,
  options?: AreaMeasureOptions
): string {
  const footprint = decorativeFootprintSuffix(featureType);
  if (footprint) return footprint.replace(/^ — /, "");
  return formatSqFt(areaSqFt, options);
}
