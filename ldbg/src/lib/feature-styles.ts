import type { LegendEntry } from "@/config/legend";
import { DEFAULT_EXISTING_RENDER_STYLE } from "@/config/legend";
import type { InterpretFeature } from "@/lib/interpret-schema";

const FALLBACK = {
  fill: "rgba(148, 163, 184, 0.45)",
  stroke: "#64748b",
  strokeWidth: 1.5,
  opacity: 1,
};

export function existingStyleForFeatureType(
  featureType: string,
  legend: LegendEntry[]
): {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  patternId?: string;
} {
  const entry = legend.find((e) => e.featureType === featureType);
  const rs = entry?.existingRenderStyle ?? DEFAULT_EXISTING_RENDER_STYLE;
  return {
    fill: rs.fill === "none" ? "transparent" : rs.fill,
    stroke: rs.stroke,
    strokeWidth: rs.strokeWidth ?? 0.35,
    opacity: rs.opacity ?? 1,
    patternId: rs.patternId,
  };
}

export type FeatureRenderStyle = {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  patternId?: string;
};

/** Plan hatch / photo texture for gravel areas (legend may omit patternId). */
export function planPatternIdForMaterial(
  featureType: string,
  label?: string,
  explicitPatternId?: string
): string | undefined {
  if (explicitPatternId === "dark-gravel" || explicitPatternId === "light-gravel") {
    return explicitPatternId;
  }
  const hay = `${featureType} ${label ?? ""}`.toLowerCase().replace(/[_-]/g, " ");
  if (/dark/.test(hay) && /gravel/.test(hay)) return "dark-gravel";
  if (/light/.test(hay) && /gravel/.test(hay)) return "light-gravel";
  if (explicitPatternId === "gravel") {
    return /dark/.test(hay) ? "dark-gravel" : "light-gravel";
  }
  return explicitPatternId;
}

export function styleForFeatureType(
  featureType: string,
  legend: LegendEntry[],
  existing: boolean,
  featureLabel?: string
): FeatureRenderStyle {
  if (existing || featureType.startsWith("existing")) {
    return existingStyleForFeatureType(featureType, legend);
  }
  const entry = legend.find((e) => e.featureType === featureType);
  if (!entry) return { ...FALLBACK, patternId: undefined };
  const rs = entry.renderStyle;
  const label = featureLabel ?? entry.label;
  return {
    fill: rs.fill === "none" ? "transparent" : rs.fill,
    stroke: rs.stroke,
    strokeWidth: rs.strokeWidth ?? 1.5,
    opacity: rs.opacity ?? 0.75,
    patternId: planPatternIdForMaterial(featureType, label, rs.patternId),
  };
}

export function styleForFeature(f: InterpretFeature, legend: LegendEntry[]): FeatureRenderStyle {
  return styleForFeatureType(f.featureType, legend, f.existing, f.label);
}

export function labelForFeatureType(featureType: string, legend: LegendEntry[]): string {
  const entry = legend.find((e) => e.featureType === featureType);
  if (entry) return entry.label;
  return featureType.replace(/_/g, " ");
}
