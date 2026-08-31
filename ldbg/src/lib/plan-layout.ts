import type { LegendEntry } from "@/config/legend";
import type { GeorefDisplayContext } from "@/lib/georef-display";
import {
  centroidNormFromFeature,
} from "@/lib/feature-georef";
import {
  featureAreaSqFt,
  normToPx,
} from "@/lib/feature-geometry";
import type { InterpretFeature } from "@/lib/interpret-schema";
import { isPlantPointFeatureType } from "@/config/utah-plants";
import { computeFeaturePxBounds } from "@/lib/plan-bounds";

/** Point plant markers share one legend number per species (e.g. all lavender → 9). */
function calloutGroupKey(
  f: InterpretFeature,
  legend: LegendEntry[]
): string | null {
  if (f.geometry.kind !== "point") return null;
  if (isPlantPointFeatureType(f.featureType)) {
    return f.featureType;
  }
  const entry = legend.find((e) => e.featureType === f.featureType);
  return (f.label || entry?.label || f.featureType).trim().toLowerCase();
}

export type Callout = {
  featureId: string;
  number: number;
  x: number;
  y: number;
  label: string;
  featureType: string;
  areaSqFt: number | null;
  /** Badge radius in image pixel space (varies per feature size). */
  radiusPx: number;
};

export type LegendRow = {
  number: number;
  label: string;
  featureType: string;
  featureId: string;
  areaSqFt: number | null;
};

/** 24×36 sheet at 300 DPI (portrait). */
export const SHEET_WIDTH_PX = 7200;
export const SHEET_HEIGHT_PX = 10800;

/** @deprecated Prefer calloutRadiusForSpan — fixed radius was too large on cropped board plans. */
const CALLOUT_RADIUS = 28;

/** Scale callout badges to visible plan span (image px). Keeps numbers legible without covering features. */
export function calloutRadiusForSpan(spanPx: number): number {
  const span = Math.max(spanPx, 100);
  return Math.max(3, Math.min(5, span * 0.004));
}

/** Cap callout badge radius so it fits inside a feature's bounding box (e.g. small patio rectangles). */
export function calloutRadiusForFeatureBounds(
  width: number,
  height: number,
  globalCapPx: number
): number {
  const minDim = Math.min(width, height);
  if (!Number.isFinite(minDim) || minDim <= 0) return globalCapPx;
  const fitRadius = minDim * 0.36;
  return Math.max(2.5, Math.min(globalCapPx, fitRadius));
}

/** Fixed callout size on the 24×36 sheet (inside the scaled plan group, divide by fitScale). */
export function calloutRadiusSheetPx(): number {
  return 8;
}

export function calloutRadiusInPlanGroup(fitScale: number): number {
  return calloutRadiusSheetPx() / Math.max(fitScale, 0.001);
}

/** Whether this feature gets a numbered callout on the plan (not legend-only linework). */
export function featureEligibleForCallout(
  f: InterpretFeature,
  legend: LegendEntry[]
): boolean {
  if (f.existing) return false;
  if (f.featureType === "property_boundary") return false;
  const entry = legend.find((e) => e.featureType === f.featureType);
  if (entry?.unit === "lf") return false;
  if (f.geometry.kind === "polyline") {
    return entry?.unit === "sqft" || entry?.unit === "each";
  }
  return true;
}

export function calloutMinDistForRadius(radius: number): number {
  return radius * 2.5;
}

export function orderFeaturesForLegend(
  features: InterpretFeature[],
  legend: LegendEntry[],
  imageW: number,
  imageH: number,
  pixelsPerFoot?: number,
  georefCtx?: GeorefDisplayContext
): InterpretFeature[] {
  const typeOrder = new Map(legend.map((e, i) => [e.featureType, i]));
  const canMeasure = georefCtx != null || pixelsPerFoot != null;

  return [...features].sort((a, b) => {
    const ta = typeOrder.get(a.featureType) ?? 999;
    const tb = typeOrder.get(b.featureType) ?? 999;
    if (ta !== tb) return ta - tb;
    const aa =
      canMeasure
        ? featureAreaSqFt(a, imageW, imageH, pixelsPerFoot, georefCtx) ?? 0
        : 0;
    const bb =
      canMeasure
        ? featureAreaSqFt(b, imageW, imageH, pixelsPerFoot, georefCtx) ?? 0
        : 0;
    return bb - aa;
  });
}

export function buildCalloutsAndLegend(
  features: InterpretFeature[],
  legend: LegendEntry[],
  imageW: number,
  imageH: number,
  pixelsPerFoot?: number,
  options?: {
    includeExisting?: boolean;
    georefCtx?: GeorefDisplayContext;
    obstacles?: CalloutObstacle[];
    /** Smallest side of the visible plan crop — scales callout badge size. */
    planSpanPx?: number;
    /** Explicit callout radius in image px (overrides planSpanPx). */
    calloutRadiusPx?: number;
  }
): { callouts: Callout[]; legendRows: LegendRow[] } {
  const includeExisting = options?.includeExisting ?? false;
  const georefCtx = options?.georefCtx;
  const canMeasure = georefCtx != null || pixelsPerFoot != null;
  const eligible = features.filter(
    (f) => (includeExisting || !f.existing) && featureEligibleForCallout(f, legend)
  );
  const ordered = orderFeaturesForLegend(
    eligible,
    legend,
    imageW,
    imageH,
    pixelsPerFoot,
    georefCtx
  );

  const globalCalloutR =
    options?.calloutRadiusPx ??
    (options?.planSpanPx != null
      ? calloutRadiusForSpan(options.planSpanPx)
      : CALLOUT_RADIUS);

  const numberByGroup = new Map<string, number>();
  const numberByFeatureId = new Map<string, number>();
  let nextNumber = 1;
  for (const f of ordered) {
    const groupKey = calloutGroupKey(f, legend);
    if (groupKey != null) {
      if (!numberByGroup.has(groupKey)) {
        numberByGroup.set(groupKey, nextNumber++);
      }
    } else {
      numberByFeatureId.set(f.id, nextNumber++);
    }
  }

  let callouts: Callout[] = ordered.map((f) => {
    const c = centroidNormFromFeature(f, imageW, imageH, georefCtx);
    const px = normToPx(c, imageW, imageH);
    const entry = legend.find((e) => e.featureType === f.featureType);
    const bounds = computeFeaturePxBounds(f, imageW, imageH, georefCtx);
    const radiusPx = calloutRadiusForFeatureBounds(
      bounds.width,
      bounds.height,
      globalCalloutR
    );
    const groupKey = calloutGroupKey(f, legend);
    const number =
      groupKey != null
        ? numberByGroup.get(groupKey)!
        : numberByFeatureId.get(f.id)!;
    return {
      featureId: f.id,
      number,
      x: px.x,
      y: px.y,
      label: f.label || entry?.label || f.featureType,
      featureType: f.featureType,
      areaSqFt:
        canMeasure
          ? featureAreaSqFt(f, imageW, imageH, pixelsPerFoot, georefCtx)
          : null,
      radiusPx,
    };
  });

  callouts = nudgeCallouts(callouts, options?.obstacles ?? []);

  const legendRows: LegendRow[] = [];
  const seenGroups = new Set<string>();
  for (const f of ordered) {
    const groupKey = calloutGroupKey(f, legend);
    if (groupKey != null) {
      if (seenGroups.has(groupKey)) continue;
      seenGroups.add(groupKey);
      const members = ordered.filter(
        (m) => calloutGroupKey(m, legend) === groupKey
      );
      const first = members[0];
      const entry = legend.find((e) => e.featureType === first.featureType);
      let areaSum: number | null = null;
      if (canMeasure) {
        areaSum = 0;
        for (const m of members) {
          const a = featureAreaSqFt(m, imageW, imageH, pixelsPerFoot, georefCtx);
          if (a != null) areaSum += a;
        }
      }
      legendRows.push({
        number: numberByGroup.get(groupKey)!,
        label: first.label || entry?.label || first.featureType,
        featureType: first.featureType,
        featureId: first.id,
        areaSqFt: areaSum,
      });
    } else {
      const entry = legend.find((e) => e.featureType === f.featureType);
      legendRows.push({
        number: numberByFeatureId.get(f.id)!,
        label: f.label || entry?.label || f.featureType,
        featureType: f.featureType,
        featureId: f.id,
        areaSqFt:
          canMeasure
            ? featureAreaSqFt(f, imageW, imageH, pixelsPerFoot, georefCtx)
            : null,
      });
    }
  }
  legendRows.sort((a, b) => a.number - b.number);

  return { callouts, legendRows };
}

export type CalloutObstacle = {
  x: number;
  y: number;
  radius: number;
};

export function nudgeCallouts(
  callouts: Callout[],
  obstacles: CalloutObstacle[] = []
): Callout[] {
  const out = callouts.map((c) => ({ ...c }));
  for (let iter = 0; iter < 24; iter++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (const obs of obstacles) {
        const dx = out[i].x - obs.x;
        const dy = out[i].y - obs.y;
        const d = Math.hypot(dx, dy);
        const need = out[i].radiusPx + obs.radius;
        if (d < need && d > 0.001) {
          const push = need - d;
          out[i].x += (dx / d) * push;
          out[i].y += (dy / d) * push;
          moved = true;
        } else if (d <= 0.001) {
          out[i].x += need;
          moved = true;
        }
      }
      for (let j = i + 1; j < out.length; j++) {
        const dx = out[j].x - out[i].x;
        const dy = out[j].y - out[i].y;
        const d = Math.hypot(dx, dy);
        const minDist = out[i].radiusPx + out[j].radiusPx + 2;
        if (d < minDist && d > 0.001) {
          const push = (minDist - d) / 2;
          out[i].x -= (dx / d) * push;
          out[i].y -= (dy / d) * push;
          out[j].x += (dx / d) * push;
          out[j].y += (dy / d) * push;
          moved = true;
        } else if (d <= 0.001) {
          out[j].x += minDist * 0.5;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return out;
}

export function pickScaleBarFeet(
  planWidthPx: number,
  pixelsPerFoot: number,
  targetBarPx: number
): number {
  const rawFeet = targetBarPx / pixelsPerFoot;
  const nice = [5, 10, 20, 25, 50, 100, 200];
  let best = nice[0];
  for (const n of nice) {
    if (Math.abs(n - rawFeet) < Math.abs(best - rawFeet)) best = n;
  }
  return best;
}

const ARCH_SCALES: { label: string; inchesPerFoot: number }[] = [
  { label: '1" = 10\'-0"', inchesPerFoot: 0.1 },
  { label: '1" = 20\'-0"', inchesPerFoot: 0.05 },
  { label: '1" = 30\'-0"', inchesPerFoot: 1 / 30 },
  { label: '1/4" = 1\'-0"', inchesPerFoot: 0.25 },
  { label: '1/8" = 1\'-0"', inchesPerFoot: 0.125 },
  { label: '1/16" = 1\'-0"', inchesPerFoot: 0.0625 },
];

/** Derive closest architectural scale text from fitted plan width on sheet (300 DPI). */
export function computeArchScaleLabel(
  contentWidthPx: number,
  pixelsPerFoot: number,
  fittedWidthSheetPx: number,
  dpi = 300
): string {
  const planWidthFeet = contentWidthPx / pixelsPerFoot;
  if (planWidthFeet <= 0) return "Scale N/A";
  const printPlanWidthInches = fittedWidthSheetPx / dpi;
  const inchesPerFoot = printPlanWidthInches / planWidthFeet;
  let best = ARCH_SCALES[0];
  let bestDiff = Math.abs(inchesPerFoot - best.inchesPerFoot);
  for (const s of ARCH_SCALES) {
    const diff = Math.abs(inchesPerFoot - s.inchesPerFoot);
    if (diff < bestDiff) {
      best = s;
      bestDiff = diff;
    }
  }
  return best.label;
}

export function pxPointsAttr(points: { x: number; y: number }[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

export function polygonPointsAttr(
  points: { x: number; y: number }[],
  w: number,
  h: number
): string {
  return points.map((p) => {
    const px = normToPx(p, w, h);
    return `${px.x},${px.y}`;
  }).join(" ");
}

export { CALLOUT_RADIUS };
