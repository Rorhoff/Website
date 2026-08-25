import type { LegendEntry } from "@/config/legend";
import { createProjectedGeometryFromPx } from "@/lib/feature-georef";
import type { NormPoint } from "@/lib/feature-geometry";
import { newFeatureId, normToPx, pxToNorm } from "@/lib/feature-geometry";
import type { GeorefDisplayContext } from "@/lib/georef-display";
import type { InterpretFeature } from "@/lib/interpret-schema";

export type DrawShapeKind = "polygon" | "rectangle" | "circle" | "polyline" | "point" | "square";

export const CIRCLE_SEGMENTS = 32;

export function isCirclePolygonFeature(f: { geometry: { kind: string; points?: { x: number; y: number }[] } }): boolean {
  return f.geometry.kind === "polygon" && (f.geometry.points?.length ?? 0) === CIRCLE_SEGMENTS;
}

export function rectangleNormPoints(a: NormPoint, b: NormPoint): NormPoint[] {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

/** Circle polygon in image pixel space so aspect ratio stays round on screen. */
export function circleNormPoints(
  center: NormPoint,
  edge: NormPoint,
  displayW: number,
  displayH: number,
  segments = CIRCLE_SEGMENTS
): NormPoint[] {
  const centerPx = normToPx(center, displayW, displayH);
  const edgePx = normToPx(edge, displayW, displayH);
  const rPx = Math.hypot(edgePx.x - centerPx.x, edgePx.y - centerPx.y);
  if (rPx < 1) return [];
  const points: NormPoint[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    points.push(
      pxToNorm(
        {
          x: centerPx.x + Math.cos(t) * rPx,
          y: centerPx.y + Math.sin(t) * rPx,
        },
        displayW,
        displayH
      )
    );
  }
  return points;
}

export function radiusPx(
  center: NormPoint,
  edge: NormPoint,
  displayW: number,
  displayH: number
): number {
  const centerPx = normToPx(center, displayW, displayH);
  const edgePx = normToPx(edge, displayW, displayH);
  return Math.hypot(edgePx.x - centerPx.x, edgePx.y - centerPx.y);
}

export function normalizedRadius(
  center: NormPoint,
  edge: NormPoint,
  displayW: number,
  displayH: number
): number {
  return Math.min(1, radiusPx(center, edge, displayW, displayH) / Math.max(displayW, displayH));
}

export function squareNormPointsFromFeet(
  center: NormPoint,
  sideFt: number,
  displayW: number,
  displayH: number,
  pixelsPerFoot: number
): NormPoint[] {
  const halfPx = (sideFt * pixelsPerFoot) / 2;
  const c = normToPx(center, displayW, displayH);
  return rectangleNormPoints(
    pxToNorm({ x: c.x - halfPx, y: c.y - halfPx }, displayW, displayH),
    pxToNorm({ x: c.x + halfPx, y: c.y + halfPx }, displayW, displayH)
  );
}

export function createDrawnFeature(options: {
  featureType: string;
  legend: LegendEntry[];
  geometryKind: "polygon" | "polyline" | "point";
  points: NormPoint[];
  radius?: number;
  features: InterpretFeature[];
  georefContext?: GeorefDisplayContext;
  displayW: number;
  displayH: number;
  label?: string;
  notes?: string;
}): InterpretFeature {
  const {
    featureType,
    legend,
    geometryKind,
    points,
    radius,
    features,
    georefContext,
    displayW,
    displayH,
    label: labelOverride,
    notes: notesOverride,
  } = options;
  const prefix = featureType.replace(/_/g, "-");
  const entry = legend.find((l) => l.featureType === featureType);
  const pxPoints = points.map((p) => normToPx(p, displayW, displayH));

  return {
    id: newFeatureId(prefix, features),
    featureType,
    label: labelOverride ?? entry?.label ?? featureType,
    geometry:
      geometryKind === "point"
        ? georefContext
          ? createProjectedGeometryFromPx(
              "point",
              pxPoints,
              georefContext,
              (radius ?? 0.025) * Math.max(displayW, displayH)
            )
          : { kind: "point", points, radius: radius ?? 0.025 }
        : georefContext
          ? createProjectedGeometryFromPx(geometryKind, pxPoints, georefContext)
          : { kind: geometryKind, points },
    existing: false,
    confidence: 1,
    notes: notesOverride ?? "",
  };
}
