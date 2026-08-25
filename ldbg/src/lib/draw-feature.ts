import type { LegendEntry } from "@/config/legend";
import { createProjectedGeometryFromPx } from "@/lib/feature-georef";
import type { NormPoint } from "@/lib/feature-geometry";
import { newFeatureId, normToPx } from "@/lib/feature-geometry";
import type { GeorefDisplayContext } from "@/lib/georef-display";
import type { InterpretFeature } from "@/lib/interpret-schema";

export type DrawShapeKind = "polygon" | "rectangle" | "circle" | "polyline" | "point";

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

export function circleNormPoints(
  center: NormPoint,
  edge: NormPoint,
  segments = 32
): NormPoint[] {
  const dx = edge.x - center.x;
  const dy = edge.y - center.y;
  const r = Math.hypot(dx, dy);
  if (r < 0.0005) return [];
  const points: NormPoint[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    points.push({
      x: Math.min(1, Math.max(0, center.x + Math.cos(t) * r)),
      y: Math.min(1, Math.max(0, center.y + Math.sin(t) * r)),
    });
  }
  return points;
}

export function normalizedRadius(
  center: NormPoint,
  edge: NormPoint
): number {
  return Math.min(1, Math.hypot(edge.x - center.x, edge.y - center.y));
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
  } = options;
  const prefix = featureType.replace(/_/g, "-");
  const entry = legend.find((l) => l.featureType === featureType);
  const pxPoints = points.map((p) => normToPx(p, displayW, displayH));

  return {
    id: newFeatureId(prefix, features),
    featureType,
    label: entry?.label ?? featureType,
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
    notes: "",
  };
}
