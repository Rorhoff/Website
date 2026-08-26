import type { LegendEntry } from "@/config/legend";
import type { InterpretFeature } from "@/lib/interpret-schema";
import { featureAreaSqFt } from "@/lib/feature-geometry";
import type { GeorefDisplayContext } from "@/lib/georef-display";
import { computeFeaturePxBounds } from "@/lib/plan-bounds";

export function materialDescriptionForFeature(
  feature: InterpretFeature,
  legend: LegendEntry[]
): string {
  if (feature.notes?.trim()) return feature.notes.trim();
  const entry = legend.find((e) => e.featureType === feature.featureType);
  return entry?.defaultMaterial ?? feature.label ?? feature.featureType;
}

export function buildFeatureFillPrompt(
  feature: InterpretFeature,
  legend: LegendEntry[],
  imageW: number,
  imageH: number,
  pixelsPerFoot?: number,
  georefCtx?: GeorefDisplayContext
): string {
  const material = materialDescriptionForFeature(feature, legend);
  const bounds = computeFeaturePxBounds(feature, imageW, imageH, georefCtx);
  const area = featureAreaSqFt(feature, imageW, imageH, pixelsPerFoot, georefCtx);

  let scaleHint = "";
  if (pixelsPerFoot && pixelsPerFoot > 0) {
    const widthFt = bounds.width / pixelsPerFoot;
    const heightFt = bounds.height / pixelsPerFoot;
    scaleHint = ` The visible area is approximately ${widthFt.toFixed(0)} by ${heightFt.toFixed(0)} feet.`;
  } else if (area != null && area > 0) {
    scaleHint = ` The visible area is approximately ${Math.round(area)} square feet.`;
  }

  return (
    `Top-down aerial view of ${material}. Photographed from directly ` +
    `overhead. Fill the entire frame with this material. Natural daylight, no ` +
    `shadows from objects outside the frame. Do not add text, labels, furniture, ` +
    `people, or vehicles.${scaleHint}`
  );
}
