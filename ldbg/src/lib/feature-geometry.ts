import type { InterpretFeature } from "@/lib/interpret-schema";
import type { GeorefDisplayContext } from "@/lib/georef-display";
import {
  featureAreaSqFtGeoref,
  featurePerimeterLfGeoref,
  geometryToPxPoints,
  isNormalizedGeometry,
} from "@/lib/feature-georef";

export type NormPoint = { x: number; y: number };
export type PxPoint = { x: number; y: number };
export type Segment = { a: PxPoint; b: PxPoint };

export function normToPx(p: NormPoint, w: number, h: number): PxPoint {
  return { x: p.x * w, y: p.y * h };
}

export function pxToNorm(p: PxPoint, w: number, h: number): NormPoint {
  return {
    x: Math.min(1, Math.max(0, p.x / w)),
    y: Math.min(1, Math.max(0, p.y / h)),
  };
}

export function flatNormPoints(points: NormPoint[], w: number, h: number): number[] {
  return points.flatMap((p) => {
    const px = normToPx(p, w, h);
    return [px.x, px.y];
  });
}

export function polygonAreaPx(points: PxPoint[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    sum += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return Math.abs(sum) / 2;
}

export function polylineLengthPx(points: PxPoint[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += dist(points[i - 1], points[i]);
  }
  return len;
}

export function polygonPerimeterPx(points: PxPoint[]): number {
  if (points.length < 2) return 0;
  let len = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    len += dist(points[i], points[j]);
  }
  return len;
}

function dist(a: PxPoint, b: PxPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function flatPxPoints(points: PxPoint[]): number[] {
  return points.flatMap((p) => [p.x, p.y]);
}

export function flatFeaturePoints(
  feature: InterpretFeature,
  imageW: number,
  imageH: number,
  ctx?: GeorefDisplayContext
): number[] {
  return flatPxPoints(geometryToPxPoints(feature, imageW, imageH, ctx));
}

export function featureAreaSqFt(
  feature: InterpretFeature,
  imageW: number,
  imageH: number,
  pixelsPerFoot?: number,
  _ctx?: GeorefDisplayContext
): number | null {
  const georef = featureAreaSqFtGeoref(feature);
  if (georef != null) return georef;

  if (pixelsPerFoot == null || !isNormalizedGeometry(feature.geometry)) return null;

  const pxf = pixelsPerFoot * pixelsPerFoot;
  const pts = feature.geometry.points.map((p) => normToPx(p, imageW, imageH));

  if (feature.geometry.kind === "polygon") {
    return polygonAreaPx(pts) / pxf;
  }
  if (feature.geometry.kind === "point" && feature.geometry.radius) {
    const rPx = feature.geometry.radius * Math.max(imageW, imageH);
    return (Math.PI * rPx * rPx) / pxf;
  }
  return null;
}

export function featurePerimeterLf(
  feature: InterpretFeature,
  imageW: number,
  imageH: number,
  pixelsPerFoot?: number,
  _ctx?: GeorefDisplayContext
): number | null {
  const georef = featurePerimeterLfGeoref(feature);
  if (georef != null) return georef;

  if (pixelsPerFoot == null || !isNormalizedGeometry(feature.geometry)) return null;

  const pts = feature.geometry.points.map((p) => normToPx(p, imageW, imageH));

  if (feature.geometry.kind === "polygon") {
    return polygonPerimeterPx(pts) / pixelsPerFoot;
  }
  if (feature.geometry.kind === "polyline") {
    return polylineLengthPx(pts) / pixelsPerFoot;
  }
  if (feature.geometry.kind === "point" && feature.geometry.radius) {
    const rPx = feature.geometry.radius * Math.max(imageW, imageH);
    return (2 * Math.PI * rPx) / pixelsPerFoot;
  }
  return null;
}

export function centroidNorm(points: NormPoint[]): NormPoint {
  if (points.length === 0) return { x: 0.5, y: 0.5 };
  if (points.length === 1) return { ...points[0] };
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

export function moveFeature(
  feature: InterpretFeature,
  dx: number,
  dy: number
): InterpretFeature {
  if (!isNormalizedGeometry(feature.geometry)) return feature;
  return {
    ...feature,
    geometry: {
      ...feature.geometry,
      points: feature.geometry.points.map((p) => ({
        x: Math.min(1, Math.max(0, p.x + dx)),
        y: Math.min(1, Math.max(0, p.y + dy)),
      })),
    },
  };
}

export function transformFeaturePoints(
  feature: InterpretFeature,
  imageW: number,
  imageH: number,
  center: NormPoint,
  scaleX: number,
  scaleY: number,
  rotationDeg: number
): InterpretFeature {
  if (!isNormalizedGeometry(feature.geometry)) return feature;
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = center.x * imageW;
  const cy = center.y * imageH;

  const points = feature.geometry.points.map((p) => {
    const dx = (p.x * imageW - cx) * scaleX;
    const dy = (p.y * imageH - cy) * scaleY;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    return pxToNorm({ x: cx + rx, y: cy + ry }, imageW, imageH);
  });

  let radius = feature.geometry.radius;
  if (radius != null) {
    const avgScale = (Math.abs(scaleX) + Math.abs(scaleY)) / 2;
    radius = Math.min(1, radius * avgScale);
  }

  return {
    ...feature,
    geometry: { ...feature.geometry, points, radius },
  };
}

export function insertVertexAt(
  feature: InterpretFeature,
  edgeIndex: number
): InterpretFeature {
  if (!isNormalizedGeometry(feature.geometry)) return feature;
  const pts = feature.geometry.points;
  if (pts.length < 2) return feature;
  const a = pts[edgeIndex];
  const b = pts[(edgeIndex + 1) % pts.length];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const next = [...pts];
  next.splice(edgeIndex + 1, 0, mid);
  return { ...feature, geometry: { ...feature.geometry, points: next } };
}

export function deleteVertexAt(
  feature: InterpretFeature,
  vertexIndex: number
): InterpretFeature | null {
  if (!isNormalizedGeometry(feature.geometry)) return null;
  const min =
    feature.geometry.kind === "polygon" ? 3 : feature.geometry.kind === "polyline" ? 2 : 1;
  if (feature.geometry.points.length <= min) return null;
  const next = feature.geometry.points.filter((_, i) => i !== vertexIndex);
  return { ...feature, geometry: { ...feature.geometry, points: next } };
}

export function updateVertex(
  feature: InterpretFeature,
  vertexIndex: number,
  point: NormPoint
): InterpretFeature {
  if (!isNormalizedGeometry(feature.geometry)) return feature;
  const next = feature.geometry.points.map((p, i) =>
    i === vertexIndex ? point : p
  );
  return { ...feature, geometry: { ...feature.geometry, points: next } };
}

export function collectSnapSegments(
  features: InterpretFeature[],
  imageW: number,
  imageH: number,
  ctx?: GeorefDisplayContext
): Segment[] {
  const segs: Segment[] = [];
  for (const f of features) {
    if (!f.existing) continue;
    const pts = geometryToPxPoints(f, imageW, imageH, ctx);
    if (f.geometry.kind === "polygon") {
      for (let i = 0; i < pts.length; i++) {
        segs.push({ a: pts[i], b: pts[(i + 1) % pts.length] });
      }
    } else if (f.geometry.kind === "polyline") {
      for (let i = 0; i < pts.length - 1; i++) {
        segs.push({ a: pts[i], b: pts[i + 1] });
      }
    }
  }
  return segs;
}

export function snapPxPoint(
  point: PxPoint,
  segments: Segment[],
  thresholdPx: number
): PxPoint {
  let best = point;
  let bestDist = thresholdPx;
  for (const seg of segments) {
    const proj = projectPointOnSegment(point, seg.a, seg.b);
    const d = dist(point, proj);
    if (d < bestDist) {
      bestDist = d;
      best = proj;
    }
  }
  return best;
}

function projectPointOnSegment(p: PxPoint, a: PxPoint, b: PxPoint): PxPoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { ...a };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

export function newFeatureId(prefix: string, features: InterpretFeature[]): string {
  let n = features.length + 1;
  while (features.some((f) => f.id === `${prefix}-${String(n).padStart(2, "0")}`)) {
    n++;
  }
  return `${prefix}-${String(n).padStart(2, "0")}`;
}

export function cloneFeatures(features: InterpretFeature[]): InterpretFeature[] {
  return JSON.parse(JSON.stringify(features)) as InterpretFeature[];
}
