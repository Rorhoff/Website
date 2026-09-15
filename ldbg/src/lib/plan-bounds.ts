import type { LegendEntry } from "@/config/legend";
import type { InterpretFeature } from "@/lib/interpret-schema";
import type { GeorefDisplayContext } from "@/lib/georef-display";
import { geometryRadiusPx, geometryToPxPoints } from "@/lib/feature-georef";
import {
  featureToRenderPolygonsPx,
  polylineStripWidthFt,
} from "@/lib/polyline-buffer";

export type PlanContentBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const MARGIN_RATIO = 0.05;

/** Bounding box of all visible plan features in image pixel space, plus 5% margin. */
export type PlanBoundsContext = {
  georefCtx?: GeorefDisplayContext;
  legend?: LegendEntry[];
  pixelsPerFoot?: number;
};

function expandPointsIntoBounds(
  pts: { x: number; y: number }[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): [number, number, number, number] {
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return [minX, minY, maxX, maxY];
}

export function computePlanContentBounds(
  features: InterpretFeature[],
  imageW: number,
  imageH: number,
  georefCtx?: GeorefDisplayContext,
  layout?: PlanBoundsContext
): PlanContentBounds {
  const ctx = layout?.georefCtx ?? georefCtx;
  const legend = layout?.legend;
  const pixelsPerFoot = layout?.pixelsPerFoot;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const f of features) {
    const pts = geometryToPxPoints(f, imageW, imageH, ctx);
    if (f.geometry.kind === "polyline" && legend) {
      const widthFt = polylineStripWidthFt(f, legend);
      const rings = featureToRenderPolygonsPx(
        f,
        imageW,
        imageH,
        widthFt,
        pixelsPerFoot,
        ctx
      );
      for (const ring of rings) {
        [minX, minY, maxX, maxY] = expandPointsIntoBounds(ring, minX, minY, maxX, maxY);
      }
      if (rings.length > 0) continue;
    }
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    if (f.geometry.kind === "point" || f.geometry.radius != null) {
      const c = pts[0];
      if (c) {
        const r =
          geometryRadiusPx(f, imageW, imageH, ctx) ??
          0.025 * Math.max(imageW, imageH);
        minX = Math.min(minX, c.x - r);
        maxX = Math.max(maxX, c.x + r);
        minY = Math.min(minY, c.y - r);
        maxY = Math.max(maxY, c.y + r);
      }
    }
  }

  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, width: imageW, height: imageH };
  }

  const rawW = Math.max(1, maxX - minX);
  const rawH = Math.max(1, maxY - minY);
  const padX = rawW * MARGIN_RATIO;
  const padY = rawH * MARGIN_RATIO;

  const x = Math.max(0, minX - padX);
  const y = Math.max(0, minY - padY);
  const width = Math.min(imageW - x, rawW + padX * 2);
  const height = Math.min(imageH - y, rawH + padY * 2);

  return { x, y, width: Math.max(1, width), height: Math.max(1, height) };
}

/** Axis-aligned bounds of one feature in image pixel space. */
export function computeFeaturePxBounds(
  f: InterpretFeature,
  imageW: number,
  imageH: number,
  georefCtx?: GeorefDisplayContext,
  layout?: Pick<PlanBoundsContext, "legend" | "pixelsPerFoot">
): PlanContentBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const legend = layout?.legend;
  const pixelsPerFoot = layout?.pixelsPerFoot;

  if (f.geometry.kind === "polyline" && legend) {
    const widthFt = polylineStripWidthFt(f, legend);
    const rings = featureToRenderPolygonsPx(
      f,
      imageW,
      imageH,
      widthFt,
      pixelsPerFoot,
      georefCtx
    );
    for (const ring of rings) {
      [minX, minY, maxX, maxY] = expandPointsIntoBounds(ring, minX, minY, maxX, maxY);
    }
  } else {
    const pts = geometryToPxPoints(f, imageW, imageH, georefCtx);
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    if (f.geometry.kind === "point" || f.geometry.radius != null) {
      const c = pts[0];
      if (c) {
        const r =
          geometryRadiusPx(f, imageW, imageH, georefCtx) ??
          0.025 * Math.max(imageW, imageH);
        minX = Math.min(minX, c.x - r);
        maxX = Math.max(maxX, c.x + r);
        minY = Math.min(minY, c.y - r);
        maxY = Math.max(maxY, c.y + r);
      }
    }
  }

  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, width: imageW, height: imageH };
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/** Sheet pixels at 300 DPI for a given inch measurement. */
export function sheetPxFromInches(inches: number, dpi = 300): number {
  return inches * dpi;
}
