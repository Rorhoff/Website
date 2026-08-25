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

export type Callout = {
  featureId: string;
  number: number;
  x: number;
  y: number;
  label: string;
  featureType: string;
  areaSqFt: number | null;
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

const CALLOUT_RADIUS = 28;
const CALLOUT_MIN_DIST = CALLOUT_RADIUS * 2.4;

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
  }
): { callouts: Callout[]; legendRows: LegendRow[] } {
  const includeExisting = options?.includeExisting ?? false;
  const georefCtx = options?.georefCtx;
  const canMeasure = georefCtx != null || pixelsPerFoot != null;
  const eligible = features.filter((f) => includeExisting || !f.existing);
  const ordered = orderFeaturesForLegend(
    eligible,
    legend,
    imageW,
    imageH,
    pixelsPerFoot,
    georefCtx
  );

  let callouts: Callout[] = ordered.map((f, i) => {
    const c = centroidNormFromFeature(f, imageW, imageH, georefCtx);
    const px = normToPx(c, imageW, imageH);
    const entry = legend.find((e) => e.featureType === f.featureType);
    return {
      featureId: f.id,
      number: i + 1,
      x: px.x,
      y: px.y,
      label: f.label || entry?.label || f.featureType,
      featureType: f.featureType,
      areaSqFt:
        canMeasure
          ? featureAreaSqFt(f, imageW, imageH, pixelsPerFoot, georefCtx)
          : null,
    };
  });

  callouts = nudgeCallouts(callouts, CALLOUT_MIN_DIST, options?.obstacles ?? []);

  const legendRows: LegendRow[] = callouts.map((c) => ({
    number: c.number,
    label: c.label,
    featureType: c.featureType,
    featureId: c.featureId,
    areaSqFt: c.areaSqFt,
  }));

  return { callouts, legendRows };
}

export type CalloutObstacle = {
  x: number;
  y: number;
  radius: number;
};

export function nudgeCallouts(
  callouts: Callout[],
  minDist: number,
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
        const need = CALLOUT_RADIUS + obs.radius;
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
