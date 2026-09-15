import type { LegendEntry } from "@/config/legend";
import { isPlantPointFeatureType } from "@/config/utah-plants";
import { labelForFeatureType, styleForFeature } from "@/lib/feature-styles";
import type { InterpretFeature } from "@/lib/interpret-schema";

export type MaterialsKeyRow = {
  featureId: string;
  label: string;
  fill: string;
  stroke?: string;
  patternId?: string;
};

/** Materials key rows using the same legend patterns as the plan drawing. */
export function buildMaterialsKeyRows(
  features: InterpretFeature[],
  legend: LegendEntry[]
): MaterialsKeyRow[] {
  const design = features.filter(
    (f) =>
      !f.existing &&
      f.featureType !== "property_boundary" &&
      !isPlantPointFeatureType(f.featureType) &&
      f.geometry.kind !== "point"
  );

  const rows: MaterialsKeyRow[] = design.map((f) => {
    const style = styleForFeature(f, legend);
    const label = f.label || labelForFeatureType(f.featureType, legend);
    const fill =
      style.fill && style.fill !== "none" && style.fill !== "transparent"
        ? style.fill
        : "#e7e5e4";

    return {
      featureId: f.id,
      label,
      fill,
      stroke: style.stroke,
      patternId: style.patternId,
    };
  });

  const seen = new Set<string>();
  const unique: MaterialsKeyRow[] = [];
  for (const row of rows) {
    const key = row.label.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}
