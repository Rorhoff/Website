import type { LegendEntry } from "@/config/legend";
import { isPlantPointFeatureType } from "@/config/utah-plants";
import type { LegendRow } from "@/lib/plan-layout";

export const LEGEND_ESTIMATE_DISCLAIMER =
  "Quantities and areas shown are preliminary estimates and may change during design development and construction.";

/** Suffix for a legend row (quantity, sq ft, etc.). */
export function formatLegendRowMeasure(
  row: LegendRow,
  legend: LegendEntry[]
): string {
  const entry = legend.find((e) => e.featureType === row.featureType);
  const unit = entry?.unit;

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
    if (row.areaSqFt != null && row.areaSqFt > 0) {
      return ` — ~${Math.round(row.areaSqFt).toLocaleString()} sq ft`;
    }
    return "";
  }

  if (unit === "sqft" && row.areaSqFt != null) {
    return ` — ~${Math.round(row.areaSqFt).toLocaleString()} sq ft`;
  }

  if (unit === "lf" && row.lengthLf != null) {
    return ` — ~${Math.round(row.lengthLf).toLocaleString()} LF`;
  }

  return "";
}
