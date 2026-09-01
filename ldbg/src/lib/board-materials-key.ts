import type { LegendEntry } from "@/config/legend";
import { isPlantPointFeatureType } from "@/config/utah-plants";
import type { FeatureFillEntry } from "@/lib/feature-fill-schema";
import { labelForFeatureType } from "@/lib/feature-styles";
import type { InterpretFeature } from "@/lib/interpret-schema";

export type MaterialsKeyRow = {
  featureId: string;
  label: string;
  swatchUrl?: string;
  swatchColor?: string;
};

/** Legend key rows using AI feature-fill previews when available (matches plan appearance). */
export function buildMaterialsKeyRows(
  features: InterpretFeature[],
  legend: LegendEntry[],
  featureFills: Record<string, FeatureFillEntry> | undefined,
  featureFillImageUrl: ((filename: string) => string) | undefined
): MaterialsKeyRow[] {
  const design = features.filter(
    (f) =>
      !f.existing &&
      f.featureType !== "property_boundary" &&
      !isPlantPointFeatureType(f.featureType) &&
      f.geometry.kind !== "point"
  );

  return design.map((f) => {
    const fill = featureFills?.[f.id];
    const entry = legend.find((e) => e.featureType === f.featureType);
    const label = f.label || labelForFeatureType(f.featureType, legend);
    const swatchColor =
      entry?.renderStyle.fill && entry.renderStyle.fill !== "none"
        ? entry.renderStyle.fill
        : "#e7e5e4";

    let swatchUrl: string | undefined;
    if (fill?.status === "filled" && featureFillImageUrl) {
      const preview = fill.cropPreviewFilename ?? fill.imageFilename;
      if (preview) swatchUrl = featureFillImageUrl(preview);
    }

    return { featureId: f.id, label, swatchUrl, swatchColor };
  });
}
