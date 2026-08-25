import type { LegendEntry } from "@/config/legend";
import { DEFAULT_EXISTING_RENDER_STYLE } from "@/config/legend";

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

export function styleForFeatureType(
  featureType: string,
  legend: LegendEntry[],
  existing: boolean
): {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  patternId?: string;
} {
  if (existing || featureType.startsWith("existing")) {
    return existingStyleForFeatureType(featureType, legend);
  }
  const entry = legend.find((e) => e.featureType === featureType);
  if (!entry) return { ...FALLBACK, patternId: undefined };
  const rs = entry.renderStyle;
  return {
    fill: rs.fill === "none" ? "transparent" : rs.fill,
    stroke: rs.stroke,
    strokeWidth: rs.strokeWidth ?? 1.5,
    opacity: rs.opacity ?? 0.75,
    patternId: rs.patternId,
  };
}

export function labelForFeatureType(featureType: string, legend: LegendEntry[]): string {
  const entry = legend.find((e) => e.featureType === featureType);
  if (entry) return entry.label;
  return featureType.replace(/_/g, " ");
}
