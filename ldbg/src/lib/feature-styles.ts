import type { LegendEntry } from "@/config/legend";
import {
  DEFAULT_EXISTING_RENDER_STYLE,
  isLinearFeature,
} from "@/config/legend";
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

function planLineMaterialHint(f: InterpretFeature): string {
  return `${f.featureType} ${f.label ?? ""}`.toLowerCase().replace(/[_-]/g, " ");
}

export const PLAN_COPPER_STROKE = "#B87333";
export const PLAN_FENCE_STROKE = "#ffffff";
export const PLAN_FENCE_HALO_STROKE = "#292524";

export function isPlanFenceFeature(f: InterpretFeature): boolean {
  const hay = planLineMaterialHint(f);
  if (/steel edging|steel ed|landscape edging|edging/.test(hay) && !/fence/.test(hay)) {
    return false;
  }
  if (/vinyl fence|\bfence\b/.test(hay)) return true;
  return f.featureType.includes("fence") && !f.featureType.includes("edging");
}

export function isPlanSteelEdgingFeature(f: InterpretFeature): boolean {
  const hay = planLineMaterialHint(f);
  if (/steel edging|steel ed/.test(hay)) return true;
  return f.featureType === "steel_edging" || f.featureType.includes("steel_edging");
}

/** LF symbols on plan — slightly heavier than gravel/lawn outlines, not install width in feet. */
export function planLineMaterialStrokeWidthPx(areaOutlineStrokeWidth: number): number {
  return areaOutlineStrokeWidth + 1.25;
}

export function planStrokeForLineMaterial(
  f: InterpretFeature,
  fallbackStroke: string
): string {
  if (isPlanSteelEdgingFeature(f)) return PLAN_COPPER_STROKE;
  if (isPlanFenceFeature(f)) return PLAN_FENCE_STROKE;
  return fallbackStroke;
}

/** LF edging/fence — stroke-only on plan (matches feature editor; no gray strip or AI fill). */
export function isStrokeOnlyPlanPolyline(
  f: InterpretFeature,
  legend: LegendEntry[]
): boolean {
  if (f.geometry.kind !== "polyline") return false;
  const style = styleForFeature(f, legend);
  if (style.patternId) return false;
  if (isLinearFeature(f.featureType, legend)) return true;
  const hay = planLineMaterialHint(f);
  if (/vinyl fence|steel edging|steel ed|fence line|landscape edging/.test(hay)) {
    return true;
  }
  return style.fill === "transparent";
}

/** No AI fill raster or filled strip — fences/edging stay linework like the editor. */
export function shouldExcludePlanMaterialFill(
  f: InterpretFeature,
  legend: LegendEntry[]
): boolean {
  if (isStrokeOnlyPlanPolyline(f, legend)) return true;
  const hay = planLineMaterialHint(f);
  if (/vinyl fence|\bfence\b|steel edging|steel ed/.test(hay)) return true;
  if (isLinearFeature(f.featureType, legend)) return true;
  return false;
}

export function labelForFeatureType(featureType: string, legend: LegendEntry[]): string {
  const entry = legend.find((e) => e.featureType === featureType);
  if (entry) return entry.label;
  return featureType.replace(/_/g, " ");
}
