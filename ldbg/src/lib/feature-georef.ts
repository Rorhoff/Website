import type {
  InterpretFeature,
  InterpretGeometry,
  NormalizedGeometry,
  ProjectedGeometry,
} from "@/lib/interpret-schema";
import type { GeorefDisplayContext } from "@/lib/georef-display";
import {
  pixelToProjected,
  polygonAreaSqMeters,
  polygonPerimeterMeters,
  polylineLengthMeters,
  projectedDistanceMeters,
  projectedToPixel,
  sqMetersToSqFt,
  metersToFeet,
  type ProjectedPoint,
} from "@/lib/georef-transform";
import type { NormPoint, PxPoint } from "@/lib/feature-geometry";
import { normToPx, pxToNorm } from "@/lib/feature-geometry";

export function isProjectedGeometry(
  g: InterpretGeometry
): g is ProjectedGeometry {
  return "coordinates" in g && Array.isArray(g.coordinates);
}

export function isNormalizedGeometry(
  g: InterpretGeometry
): g is NormalizedGeometry {
  return "points" in g && Array.isArray(g.points);
}

export function normToProjectedPoint(
  p: NormPoint,
  imageW: number,
  imageH: number,
  ctx: GeorefDisplayContext
): ProjectedPoint {
  const col = p.x * imageW;
  const row = p.y * imageH;
  return pixelToProjected(col, row, ctx.affine);
}

export function pxToProjectedPoint(
  p: PxPoint,
  ctx: GeorefDisplayContext
): ProjectedPoint {
  return pixelToProjected(p.x, p.y, ctx.affine);
}

export function projectedToPxPoint(
  p: ProjectedPoint,
  ctx: GeorefDisplayContext
): PxPoint {
  return projectedToPixel(p.x, p.y, ctx.affine);
}

export function normRadiusToMeters(
  radiusNorm: number,
  center: NormPoint,
  imageW: number,
  imageH: number,
  ctx: GeorefDisplayContext
): number {
  const cx = center.x * imageW;
  const cy = center.y * imageH;
  const rPx = radiusNorm * Math.max(imageW, imageH);
  const c = pixelToProjected(cx, cy, ctx.affine);
  const edge = pixelToProjected(cx + rPx, cy, ctx.affine);
  return projectedDistanceMeters(c, edge);
}

export function convertFeatureToProjected(
  feature: InterpretFeature,
  imageW: number,
  imageH: number,
  ctx: GeorefDisplayContext
): InterpretFeature {
  if (isProjectedGeometry(feature.geometry)) return feature;

  const coords = feature.geometry.points.map((p) =>
    normToProjectedPoint(p, imageW, imageH, ctx)
  );

  let radius: number | undefined;
  if (feature.geometry.radius != null && feature.geometry.kind === "point") {
    radius = normRadiusToMeters(
      feature.geometry.radius,
      feature.geometry.points[0],
      imageW,
      imageH,
      ctx
    );
  }

  return {
    ...feature,
    geometry: {
      kind: feature.geometry.kind,
      crs: ctx.crs,
      coordinates: coords,
      radius,
    },
  };
}

export function convertFeaturesToProjected(
  features: InterpretFeature[],
  imageW: number,
  imageH: number,
  ctx: GeorefDisplayContext
): InterpretFeature[] {
  return features.map((f) => convertFeatureToProjected(f, imageW, imageH, ctx));
}

export function geometryToPxPoints(
  feature: InterpretFeature,
  imageW: number,
  imageH: number,
  ctx?: GeorefDisplayContext
): PxPoint[] {
  const g = feature.geometry;
  if (isProjectedGeometry(g) && ctx) {
    return g.coordinates.map((c) => projectedToPxPoint(c, ctx));
  }
  if (isNormalizedGeometry(g)) {
    return g.points.map((p) => normToPx(p, imageW, imageH));
  }
  return [];
}

export function geometryRadiusPx(
  feature: InterpretFeature,
  imageW: number,
  imageH: number,
  ctx?: GeorefDisplayContext
): number | undefined {
  const g = feature.geometry;
  if (isProjectedGeometry(g) && g.radius != null && ctx) {
    const center = projectedToPxPoint(g.coordinates[0], ctx);
    const edge = projectedToPxPoint(
      {
        x: g.coordinates[0].x + g.radius,
        y: g.coordinates[0].y,
      },
      ctx
    );
    return Math.hypot(edge.x - center.x, edge.y - center.y);
  }
  if (isNormalizedGeometry(g) && g.radius != null) {
    return g.radius * Math.max(imageW, imageH);
  }
  return undefined;
}

export function updateFeatureVertexGeoref(
  feature: InterpretFeature,
  vertexIndex: number,
  px: PxPoint,
  ctx: GeorefDisplayContext
): InterpretFeature {
  if (!isProjectedGeometry(feature.geometry)) {
    return feature;
  }
  const next = feature.geometry.coordinates.map((c, i) =>
    i === vertexIndex ? pxToProjectedPoint(px, ctx) : c
  );
  return {
    ...feature,
    geometry: { ...feature.geometry, coordinates: next },
  };
}

export function moveFeatureGeoref(
  feature: InterpretFeature,
  dxPx: number,
  dyPx: number,
  ctx: GeorefDisplayContext
): InterpretFeature {
  if (!isProjectedGeometry(feature.geometry)) return feature;
  const next = feature.geometry.coordinates.map((c) => {
    const px = projectedToPxPoint(c, ctx);
    return pxToProjectedPoint({ x: px.x + dxPx, y: px.y + dyPx }, ctx);
  });
  return { ...feature, geometry: { ...feature.geometry, coordinates: next } };
}

export function insertVertexAtGeoref(
  feature: InterpretFeature,
  edgeIndex: number,
  _ctx: GeorefDisplayContext
): InterpretFeature {
  if (!isProjectedGeometry(feature.geometry)) return feature;
  const pts = feature.geometry.coordinates;
  if (pts.length < 2) return feature;
  const a = pts[edgeIndex];
  const b = pts[(edgeIndex + 1) % pts.length];
  const mid = {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: a.z ?? b.z,
  };
  const next = [...pts];
  next.splice(edgeIndex + 1, 0, mid);
  return { ...feature, geometry: { ...feature.geometry, coordinates: next } };
}

export function deleteVertexAtGeoref(
  feature: InterpretFeature,
  vertexIndex: number
): InterpretFeature | null {
  if (!isProjectedGeometry(feature.geometry)) return null;
  const min =
    feature.geometry.kind === "polygon"
      ? 3
      : feature.geometry.kind === "polyline"
        ? 2
        : 1;
  if (feature.geometry.coordinates.length <= min) return null;
  const next = feature.geometry.coordinates.filter((_, i) => i !== vertexIndex);
  return { ...feature, geometry: { ...feature.geometry, coordinates: next } };
}

export function centroidPx(
  feature: InterpretFeature,
  imageW: number,
  imageH: number,
  ctx?: GeorefDisplayContext
): PxPoint {
  const pts = geometryToPxPoints(feature, imageW, imageH, ctx);
  if (pts.length === 0) return { x: imageW / 2, y: imageH / 2 };
  if (pts.length === 1) return pts[0];
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / pts.length, y: sy / pts.length };
}

export function centroidNormFromFeature(
  feature: InterpretFeature,
  imageW: number,
  imageH: number,
  ctx?: GeorefDisplayContext
): NormPoint {
  const c = centroidPx(feature, imageW, imageH, ctx);
  return pxToNorm(c, imageW, imageH);
}

export function featureAreaSqFtGeoref(feature: InterpretFeature): number | null {
  const g = feature.geometry;
  if (!isProjectedGeometry(g)) return null;
  if (g.kind === "polygon") {
    return sqMetersToSqFt(polygonAreaSqMeters(g.coordinates));
  }
  if (g.kind === "point" && g.radius != null) {
    return sqMetersToSqFt(Math.PI * g.radius * g.radius);
  }
  return null;
}

export function featurePerimeterLfGeoref(feature: InterpretFeature): number | null {
  const g = feature.geometry;
  if (!isProjectedGeometry(g)) return null;
  if (g.kind === "polygon") {
    return metersToFeet(polygonPerimeterMeters(g.coordinates));
  }
  if (g.kind === "polyline") {
    return metersToFeet(polylineLengthMeters(g.coordinates));
  }
  if (g.kind === "point" && g.radius != null) {
    return metersToFeet(2 * Math.PI * g.radius);
  }
  return null;
}

export function createProjectedGeometryFromPx(
  kind: ProjectedGeometry["kind"],
  pxPoints: PxPoint[],
  ctx: GeorefDisplayContext,
  radiusPx?: number
): ProjectedGeometry {
  const coordinates = pxPoints.map((p) => pxToProjectedPoint(p, ctx));
  let radius: number | undefined;
  if (radiusPx != null && coordinates.length > 0) {
    const c = coordinates[0];
    const edge = pxToProjectedPoint(
      { x: pxPoints[0].x + radiusPx, y: pxPoints[0].y },
      ctx
    );
    radius = projectedDistanceMeters(c, edge);
  }
  return {
    kind,
    crs: ctx.crs,
    coordinates,
    radius,
  };
}

export function geometryVertexCount(feature: InterpretFeature): number {
  const g = feature.geometry;
  if (isProjectedGeometry(g)) return g.coordinates.length;
  if (isNormalizedGeometry(g)) return g.points.length;
  return 0;
}

export function transformFeatureGeoref(
  feature: InterpretFeature,
  imageW: number,
  imageH: number,
  center: NormPoint,
  scaleX: number,
  scaleY: number,
  rotationDeg: number,
  ctx: GeorefDisplayContext
): InterpretFeature {
  if (!isProjectedGeometry(feature.geometry)) return feature;

  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = center.x * imageW;
  const cy = center.y * imageH;

  const pxPoints = feature.geometry.coordinates.map((c) =>
    projectedToPxPoint(c, ctx)
  );
  const nextPx = pxPoints.map((p) => {
    const dx = (p.x - cx) * scaleX;
    const dy = (p.y - cy) * scaleY;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    return { x: cx + rx, y: cy + ry };
  });

  let radiusPx: number | undefined;
  if (feature.geometry.radius != null && feature.geometry.kind === "point") {
    const oldR = geometryRadiusPx(feature, imageW, imageH, ctx);
    if (oldR != null) {
      const avgScale = (Math.abs(scaleX) + Math.abs(scaleY)) / 2;
      radiusPx = oldR * avgScale;
    }
  }

  return {
    ...feature,
    geometry: createProjectedGeometryFromPx(
      feature.geometry.kind,
      nextPx,
      ctx,
      radiusPx
    ),
  };
}
