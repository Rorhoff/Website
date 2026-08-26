import type { GeorefDisplayContext } from "@/lib/georef-display";
import { geometryToPxPoints } from "@/lib/feature-georef";
import type { InterpretFeature } from "@/lib/interpret-schema";

export type PxPoint = { x: number; y: number };

/** Half-width in pixels for a polyline feature (centerline → strip polygon). */
export function polylineHalfWidthPx(
  feature: InterpretFeature,
  widthFt: number,
  imageW: number,
  imageH: number,
  pixelsPerFoot?: number,
  georefCtx?: GeorefDisplayContext
): number {
  if (georefCtx && pixelsPerFoot && pixelsPerFoot > 0) {
    return (widthFt * pixelsPerFoot) / 2;
  }
  if (pixelsPerFoot && pixelsPerFoot > 0) {
    return (widthFt * pixelsPerFoot) / 2;
  }
  return (widthFt / 10) * Math.max(imageW, imageH) * 0.01;
}

/** Buffer an open polyline into a closed polygon (pixel space). */
export function bufferPolylinePx(points: PxPoint[], halfWidth: number): PxPoint[] {
  if (points.length < 2 || halfWidth <= 0) return [];

  const left: PxPoint[] = [];
  const right: PxPoint[] = [];

  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)];
    const curr = points[i];
    const next = points[Math.min(points.length - 1, i + 1)];

    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;

    let nx = 0;
    let ny = 0;
    if (i === 0) {
      const len = Math.hypot(dx2, dy2) || 1;
      nx = -dy2 / len;
      ny = dx2 / len;
    } else if (i === points.length - 1) {
      const len = Math.hypot(dx1, dy1) || 1;
      nx = -dy1 / len;
      ny = dx1 / len;
    } else {
      const len1 = Math.hypot(dx1, dy1) || 1;
      const len2 = Math.hypot(dx2, dy2) || 1;
      const n1x = -dy1 / len1;
      const n1y = dx1 / len1;
      const n2x = -dy2 / len2;
      const n2y = dx2 / len2;
      nx = n1x + n2x;
      ny = n1y + n2y;
      const nlen = Math.hypot(nx, ny) || 1;
      nx /= nlen;
      ny /= nlen;
    }

    left.push({ x: curr.x + nx * halfWidth, y: curr.y + ny * halfWidth });
    right.push({ x: curr.x - nx * halfWidth, y: curr.y - ny * halfWidth });
  }

  return [...left, ...right.reverse()];
}

export function featureToRenderPolygonsPx(
  feature: InterpretFeature,
  imageW: number,
  imageH: number,
  pixelsPerFoot?: number,
  georefCtx?: GeorefDisplayContext,
  widthFt?: number
): PxPoint[][] {
  const pts = geometryToPxPoints(feature, imageW, imageH, georefCtx);

  if (feature.geometry.kind === "polyline") {
    const w = widthFt ?? 4;
    const half = polylineHalfWidthPx(feature, w, imageW, imageH, pixelsPerFoot, georefCtx);
    const buf = bufferPolylinePx(pts, half);
    return buf.length >= 3 ? [buf] : [];
  }

  if (feature.geometry.kind === "polygon" && pts.length >= 3) {
    return [pts];
  }

  if (feature.geometry.kind === "point") {
    const r =
      (feature.geometry.radius ?? 0.02) * Math.max(imageW, imageH);
    const c = pts[0] ?? { x: imageW / 2, y: imageH / 2 };
    const segs = 24;
    const ring: PxPoint[] = [];
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      ring.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
    }
    return [ring];
  }

  return [];
}

export function pxPolygonToAttr(points: PxPoint[]): string {
  return points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
}
