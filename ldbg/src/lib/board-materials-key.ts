import type { LegendEntry } from "@/config/legend";
import { isPlantPointFeatureType } from "@/config/utah-plants";
import { labelForFeatureType } from "@/lib/feature-styles";
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

  return design.map((f) => {
    const entry = legend.find((e) => e.featureType === f.featureType);
    const label = f.label || labelForFeatureType(f.featureType, legend);
    const fill =
      entry?.renderStyle.fill && entry.renderStyle.fill !== "none"
        ? entry.renderStyle.fill
        : "#e7e5e4";

    return {
      featureId: f.id,
      label,
      fill,
      stroke: entry?.renderStyle.stroke,
      patternId: entry?.renderStyle.patternId,
    };
  });
}
