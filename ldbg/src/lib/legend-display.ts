import { getDecorativeObjectByFeatureType } from "@/config/decorative-objects";
import type { LegendEntry } from "@/config/legend";
import { isPlantPointFeatureType } from "@/config/utah-plants";
import type { LegendRow } from "@/lib/plan-layout";

export const LEGEND_ESTIMATE_DISCLAIMER =
  "Quantities and areas shown are preliminary estimates and may change during design development and construction.";

/** Area features show a ±1 sq ft band around the scaled measurement. */
const AREA_RANGE_TYPES = new Set([
  "putting_green",
  "water_feature",
  "paver_path",
  "paver_patio",
  "flagstone_paving",
]);

function formatSqFtMeasure(areaSqFt: number, featureType: string): string {
  const center = Math.round(areaSqFt);
  if (AREA_RANGE_TYPES.has(featureType)) {
    const low = Math.max(0, center - 1);
    const high = center + 1;
    return ` — ~${low.toLocaleString()}–${high.toLocaleString()} sq ft`;
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
  legend: LegendEntry[]
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
    return formatSqFtMeasure(row.areaSqFt, row.featureType);
  }

  if (unit === "lf" && row.lengthLf != null) {
    return ` — ~${Math.round(row.lengthLf).toLocaleString()} LF`;
  }

  return "";
}

export function formatFeatureAreaLabel(
  areaSqFt: number,
  featureType: string
): string {
  const footprint = decorativeFootprintSuffix(featureType);
  if (footprint) return footprint.replace(/^ — /, "");
  if (AREA_RANGE_TYPES.has(featureType)) {
    const center = Math.round(areaSqFt);
    const low = Math.max(0, center - 1);
    const high = center + 1;
    return `${low.toLocaleString()}–${high.toLocaleString()} sq ft`;
  }
  return `${Math.round(areaSqFt).toLocaleString()} sq ft`;
}

