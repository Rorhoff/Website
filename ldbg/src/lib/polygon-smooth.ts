import type { InterpretFeature } from "@/lib/interpret-schema";
import type { GeorefDisplayContext } from "@/lib/georef-display";
import {
  createProjectedGeometryFromPx,
  geometryToPxPoints,
  isNormalizedGeometry,
  isProjectedGeometry,
} from "@/lib/feature-georef";
import type { PxPoint } from "@/lib/feature-geometry";
import { pxToNorm } from "@/lib/feature-geometry";

const STROKE_EDGE_THRESHOLD_PX = 28;
const MIN_STROKE_POINTS = 3;
const MIN_STROKE_LENGTH_PX = 12;

function dist(a: PxPoint, b: PxPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function distPointToSegment(p: PxPoint, a: PxPoint, b: PxPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return dist(p, proj);
}

function minDistStrokeToSegment(stroke: PxPoint[], a: PxPoint, b: PxPoint): number {
  let best = Infinity;
  for (const p of stroke) {
    best = Math.min(best, distPointToSegment(p, a, b));
  }
  return best;
}

function strokeLength(stroke: PxPoint[]): number {
  let len = 0;
  for (let i = 1; i < stroke.length; i++) {
    len += dist(stroke[i - 1], stroke[i]);
  }
  return len;
}

/** Longest contiguous run of marked edges on a closed ring. */
function longestEdgeRun(marked: Set<number>, edgeCount: number): number[] {
  if (marked.size === 0) return [];
  let best: number[] = [];
  for (const start of marked) {
    const run = [start];
    let e = start;
    while (marked.has((e + 1) % edgeCount)) {
      e = (e + 1) % edgeCount;
      run.push(e);
    }
    if (run.length > best.length) best = run;
  }
  return best;
}

function extractChain(verts: PxPoint[], start: number, end: number): PxPoint[] {
  const n = verts.length;
  const chain: PxPoint[] = [];
  let i = start;
  chain.push(verts[i]);
  while (i !== end) {
    i = (i + 1) % n;
    chain.push(verts[i]);
  }
  return chain;
}

function replaceChain(
  verts: PxPoint[],
  start: number,
  end: number,
  replacement: PxPoint[]
): PxPoint[] {
  if (start <= end) {
    return [...verts.slice(0, start), ...replacement, ...verts.slice(end + 1)];
  }
  return [...replacement, ...verts.slice(end + 1, start)];
}

function densifyChain(chain: PxPoint[], targetCount = 8): PxPoint[] {
  if (chain.length >= targetCount) return chain;
  const out: PxPoint[] = [chain[0]];
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i];
    const b = chain[i + 1];
    const steps = Math.max(2, Math.ceil(targetCount / chain.length));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    }
    out.push(b);
  }
  return out;
}

/** Chaikin corner-cutting; keeps first and last points fixed. */
function chaikinSmooth(chain: PxPoint[], iterations = 2): PxPoint[] {
  let pts = densifyChain(chain, 8);
  for (let iter = 0; iter < iterations; iter++) {
    const next: PxPoint[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      next.push(
        { x: 0.75 * p0.x + 0.25 * p1.x, y: 0.75 * p0.y + 0.25 * p1.y },
        { x: 0.25 * p0.x + 0.75 * p1.x, y: 0.25 * p0.y + 0.75 * p1.y }
      );
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

function setFeaturePxPoints(
  feature: InterpretFeature,
  pxPoints: PxPoint[],
  displayW: number,
  displayH: number,
  georefCtx?: GeorefDisplayContext
): InterpretFeature {
  if (georefCtx && isProjectedGeometry(feature.geometry)) {
    return {
      ...feature,
      geometry: createProjectedGeometryFromPx(
        feature.geometry.kind === "polyline" ? "polyline" : "polygon",
        pxPoints,
        georefCtx
      ),
    };
  }
  if (isNormalizedGeometry(feature.geometry)) {
    return {
      ...feature,
      geometry: {
        ...feature.geometry,
        points: pxPoints.map((p) => pxToNorm(p, displayW, displayH)),
      },
    };
  }
  return feature;
}

/**
 * Smooth a contiguous section of a polygon boundary touched by a user stroke.
 * Returns null if the stroke does not match any edge closely enough.
 */
export function smoothPolygonEdgeWithStroke(
  feature: InterpretFeature,
  stroke: PxPoint[],
  displayW: number,
  displayH: number,
  georefCtx?: GeorefDisplayContext,
  thresholdPx = STROKE_EDGE_THRESHOLD_PX
): InterpretFeature | null {
  if (feature.geometry.kind !== "polygon") return null;
  if (stroke.length < MIN_STROKE_POINTS || strokeLength(stroke) < MIN_STROKE_LENGTH_PX) {
    return null;
  }

  const verts = geometryToPxPoints(feature, displayW, displayH, georefCtx);
  if (verts.length < 3) return null;

  const marked = new Set<number>();
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    if (minDistStrokeToSegment(stroke, a, b) <= thresholdPx) {
      marked.add(i);
    }
  }

  const edgeRun = longestEdgeRun(marked, verts.length);
  if (edgeRun.length === 0) return null;

  const startEdge = edgeRun[0];
  const endEdge = edgeRun[edgeRun.length - 1];
  const startVertex = startEdge;
  const endVertex = (endEdge + 1) % verts.length;

  const chain = extractChain(verts, startVertex, endVertex);
  if (chain.length < 2) return null;

  const smoothed = chaikinSmooth(chain);
  const nextVerts = replaceChain(verts, startVertex, endVertex, smoothed);
  if (nextVerts.length < 3) return null;

  return setFeaturePxPoints(feature, nextVerts, displayW, displayH, georefCtx);
}

export function appendStrokePoint(
  stroke: PxPoint[],
  point: PxPoint,
  minGapPx = 4
): PxPoint[] {
  if (stroke.length === 0) return [point];
  const last = stroke[stroke.length - 1];
  if (dist(last, point) < minGapPx) return stroke;
  return [...stroke, point];
}
