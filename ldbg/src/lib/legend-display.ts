import { getDecorativeObjectByFeatureType } from "@/config/decorative-objects";
import type { LegendEntry } from "@/config/legend";
import { isPlantPointFeatureType } from "@/config/utah-plants";
import type { LegendRow } from "@/lib/plan-layout";

export const LEGEND_ESTIMATE_DISCLAIMER =
  "Quantities and areas shown are preliminary estimates and may change during design development and construction.";

/** Area features show a band derived from ±1 ft on the calibration reference distance. */
const AREA_RANGE_TYPES = new Set([
  "putting_green",
  "water_feature",
  "paver_path",
  "paver_patio",
  "flagstone_paving",
]);

export type AreaMeasureOptions = {
  /** Manual calibration reference distance (ft) used for ±1 ft scale band. */
  calibrationDistanceFeet?: number;
};

function areaRangeFromCalibration(
  areaSqFt: number,
  distanceFeet: number
): { low: number; high: number } | null {
  if (distanceFeet <= 1) return null;
  const low = areaSqFt * ((distanceFeet - 1) / distanceFeet) ** 2;
  const high = areaSqFt * ((distanceFeet + 1) / distanceFeet) ** 2;
  return {
    low: Math.max(0, Math.round(low)),
    high: Math.round(high),
  };
}

function formatSqFtMeasure(
  areaSqFt: number,
  featureType: string,
  options?: AreaMeasureOptions
): string {
  const center = Math.round(areaSqFt);
  if (AREA_RANGE_TYPES.has(featureType)) {
    const dist = options?.calibrationDistanceFeet;
    if (dist != null && dist > 1) {
      const range = areaRangeFromCalibration(areaSqFt, dist);
      if (range) {
        return ` — ~${range.low.toLocaleString()}–${range.high.toLocaleString()} sq ft`;
      }
    }
    return ` — ~${center.toLocaleString()} sq ft`;
  }
  return ` — ~${center.toLocaleString()} sq ft`;
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
    return formatSqFtMeasure(row.areaSqFt, row.featureType, options);
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
  if (AREA_RANGE_TYPES.has(featureType)) {
    const dist = options?.calibrationDistanceFeet;
    if (dist != null && dist > 1) {
      const range = areaRangeFromCalibration(areaSqFt, dist);
      if (range) {
        return `${range.low.toLocaleString()}–${range.high.toLocaleString()} sq ft`;
      }
    }
    return `${Math.round(areaSqFt).toLocaleString()} sq ft`;
  }
  return `${Math.round(areaSqFt).toLocaleString()} sq ft`;
}
