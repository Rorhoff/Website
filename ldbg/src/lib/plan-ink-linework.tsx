import type { ReactElement } from "react";
import type { GeorefDisplayContext } from "@/lib/georef-display";
import { geometryRadiusPx, geometryToPxPoints } from "@/lib/feature-georef";
import type { InterpretFeature } from "@/lib/interpret-schema";
import { pxPointsAttr } from "@/lib/plan-layout";

const INK = "#1a1510";
const INK_LIGHT = "#3d3428";

function seedFromId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rngFor(id: string): () => number {
  let s = seedFromId(id);
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isTreeType(featureType: string): boolean {
  return featureType === "tree" || featureType === "tree_specimen";
}

function isOrnamentalGrassType(featureType: string): boolean {
  return (
    featureType === "ornamental_grass" ||
    featureType === "lavender" ||
    featureType === "blue_grass" ||
    featureType === "sagebrush" ||
    featureType === "rabbitbrush" ||
    featureType === "manzanita" ||
    featureType === "lantana"
  );
}

function isLawnAccentType(featureType: string): boolean {
  return featureType === "lawn" || featureType === "planting_bed";
}

function isBoulderStoneType(featureType: string): boolean {
  return (
    featureType === "boulder_edge" ||
    featureType === "boulder_retaining_edge" ||
    featureType === "rock_retaining_wall" ||
    featureType === "flagstone_paving"
  );
}

function isHardscapeType(featureType: string): boolean {
  return (
    featureType === "paver_patio" ||
    featureType === "paver_path" ||
    featureType === "flagstone_paving" ||
    featureType === "fire_pit_terrace" ||
    featureType === "steps" ||
    featureType === "bridge" ||
    featureType === "water_feature" ||
    featureType === "putting_green"
  );
}

type Pt = { x: number; y: number };

function principalAxisAngle(pts: Pt[]): number {
  if (pts.length < 2) return Math.PI / 4;
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= pts.length;
  cy /= pts.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  return 0.5 * Math.atan2(2 * sxy, sxx - syy);
}

function perpendicular(dx: number, dy: number): Pt {
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

function handDrawnPath(
  pts: Pt[],
  id: string,
  baseWidth: number,
  wobblePx: number
): { d: string; strokeWidth: number } {
  const rand = rngFor(id);
  if (pts.length < 2) {
    const p = pts[0] ?? { x: 0, y: 0 };
    return { d: `M ${p.x} ${p.y}`, strokeWidth: baseWidth };
  }

  const closed = pts.length > 2;
  const work = closed ? [...pts, pts[0]!] : pts;
  const parts: string[] = [];
  const widthMul = 0.8 + rand() * 0.5;

  for (let i = 0; i < work.length - 1; i++) {
    const a = work[i]!;
    const b = work[i + 1]!;
    const perp = perpendicular(b.x - a.x, b.y - a.y);
    const wobble = wobblePx * (0.4 + rand() * 0.6);
    const ax = a.x + perp.x * wobble * (rand() - 0.5) * 2;
    const ay = a.y + perp.y * wobble * (rand() - 0.5) * 2;
    const bx = b.x + perp.x * wobble * (rand() - 0.5) * 2;
    const by = b.y + perp.y * wobble * (rand() - 0.5) * 2;
    if (i === 0) parts.push(`M ${ax.toFixed(1)} ${ay.toFixed(1)}`);
    parts.push(`L ${bx.toFixed(1)} ${by.toFixed(1)}`);
  }

  return { d: parts.join(" "), strokeWidth: baseWidth * widthMul };
}

function treeInk(
  f: InterpretFeature,
  w: number,
  h: number,
  georefCtx?: GeorefDisplayContext,
  spanPx = 1000
) {
  const rand = rngFor(f.id);
  const pxPts = geometryToPxPoints(f, w, h, georefCtx);
  const c = pxPts[0] ?? { x: w / 2, y: h / 2 };
  const r =
    geometryRadiusPx(f, w, h, georefCtx) ?? 0.025 * Math.max(w, h);
  const wobble = Math.max(1.5, spanPx * 0.002);
  const baseW = Math.max(1.2, spanPx * 0.0025);
  const spokeCount = 6 + Math.floor(rand() * 5);
  const spokeLen = r * (1.05 + rand() * 0.15);
  const offsetR = r * (0.08 + rand() * 0.06);
  const ox = c.x + offsetR * (rand() - 0.5);
  const oy = c.y + offsetR * (rand() - 0.5);

  const spokes: ReactElement[] = [];
  for (let i = 0; i < spokeCount; i++) {
    const ang = (i / spokeCount) * Math.PI * 2 + (rand() - 0.5) * 0.25;
    const sx = c.x + Math.cos(ang) * r * 0.15;
    const sy = c.y + Math.sin(ang) * r * 0.15;
    const ex = c.x + Math.cos(ang) * spokeLen;
    const ey = c.y + Math.sin(ang) * spokeLen;
    spokes.push(
      <line
        key={i}
        x1={sx}
        y1={sy}
        x2={ex}
        y2={ey}
        stroke={INK}
        strokeWidth={baseW * (0.85 + rand() * 0.4)}
        strokeLinecap="round"
      />
    );
  }

  const circlePath = handDrawnPath(
    Array.from({ length: 24 }, (_, i) => {
      const t = (i / 24) * Math.PI * 2;
      return {
        x: c.x + Math.cos(t) * r * (0.96 + rand() * 0.06),
        y: c.y + Math.sin(t) * r * (0.96 + rand() * 0.06),
      };
    }),
    `${f.id}-canopy`,
    baseW,
    wobble
  );

  const lightCircle = handDrawnPath(
    Array.from({ length: 20 }, (_, i) => {
      const t = (i / 20) * Math.PI * 2;
      return {
        x: ox + Math.cos(t) * r * 0.92,
        y: oy + Math.sin(t) * r * 0.92,
      };
    }),
    `${f.id}-light`,
    baseW * 0.65,
    wobble * 0.6
  );

  return (
    <g key={f.id}>
      {spokes}
      <path
        d={circlePath.d}
        fill="none"
        stroke={INK}
        strokeWidth={circlePath.strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d={lightCircle.d}
        fill="none"
        stroke={INK_LIGHT}
        strokeWidth={lightCircle.strokeWidth}
        strokeLinejoin="round"
        opacity={0.55}
      />
    </g>
  );
}

function grassTicks(
  f: InterpretFeature,
  w: number,
  h: number,
  georefCtx?: GeorefDisplayContext,
  spanPx = 1000
) {
  const rand = rngFor(f.id);
  const pxPts = geometryToPxPoints(f, w, h, georefCtx);
  if (pxPts.length < 3) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pxPts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const tickLen = Math.max(3, spanPx * 0.004);
  const baseW = Math.max(0.8, spanPx * 0.0018);
  const clusterCount = 8 + Math.floor(rand() * 14);
  const ticks: ReactElement[] = [];

  for (let i = 0; i < clusterCount; i++) {
    const cx = minX + rand() * (maxX - minX);
    const cy = minY + rand() * (maxY - minY);
    const clusterSize = 2 + Math.floor(rand() * 4);
    for (let j = 0; j < clusterSize; j++) {
      const ang = rand() * Math.PI * 2;
      const px = cx + (rand() - 0.5) * tickLen * 2;
      const py = cy + (rand() - 0.5) * tickLen * 2;
      ticks.push(
        <line
          key={`${i}-${j}`}
          x1={px}
          y1={py}
          x2={px + Math.cos(ang) * tickLen}
          y2={py + Math.sin(ang) * tickLen}
          stroke={INK}
          strokeWidth={baseW * (0.8 + rand() * 0.5)}
          strokeLinecap="round"
          opacity={0.85}
        />
      );
    }
  }

  return <g key={f.id}>{ticks}</g>;
}

function boulderStoneInk(
  f: InterpretFeature,
  w: number,
  h: number,
  georefCtx?: GeorefDisplayContext,
  spanPx = 1000
) {
  const rand = rngFor(f.id);
  const pxPts = geometryToPxPoints(f, w, h, georefCtx);
  const wobble = Math.max(2, spanPx * 0.003);
  const baseW = Math.max(1.5, spanPx * 0.0028);

  if (f.geometry.kind === "polyline" && pxPts.length >= 2) {
    const { d, strokeWidth } = handDrawnPath(pxPts, f.id, baseW, wobble);
    return (
      <g key={f.id}>
        <path d={d} fill="none" stroke={INK} strokeWidth={strokeWidth} strokeLinecap="round" />
      </g>
    );
  }

  if (pxPts.length < 3) return null;

  const irregular = pxPts.map((p, i) => {
    const n = perpendicular(
      pxPts[(i + 1) % pxPts.length]!.x - p.x,
      pxPts[(i + 1) % pxPts.length]!.y - p.y
    );
    const j = wobble * (rand() - 0.5) * 1.5;
    return { x: p.x + n.x * j, y: p.y + n.y * j };
  });

  const outer = handDrawnPath(irregular, f.id, baseW, wobble * 0.5);
  const contours: ReactElement[] = [];
  const contourCount = 1 + Math.floor(rand() * 2);
  let cx = 0;
  let cy = 0;
  for (const p of pxPts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= pxPts.length;
  cy /= pxPts.length;

  for (let c = 0; c < contourCount; c++) {
    const shrink = 0.55 + c * 0.15 + rand() * 0.1;
    const inner = pxPts.map((p) => ({
      x: cx + (p.x - cx) * shrink + (rand() - 0.5) * wobble,
      y: cy + (p.y - cy) * shrink + (rand() - 0.5) * wobble,
    }));
    const line = handDrawnPath(inner, `${f.id}-c${c}`, baseW * 0.7, wobble * 0.4);
    contours.push(
      <path
        key={c}
        d={line.d}
        fill="none"
        stroke={INK_LIGHT}
        strokeWidth={line.strokeWidth}
        strokeLinecap="round"
        opacity={0.7}
      />
    );
  }

  return (
    <g key={f.id}>
      <path
        d={outer.d}
        fill="none"
        stroke={INK}
        strokeWidth={outer.strokeWidth}
        strokeLinejoin="round"
      />
      {contours}
    </g>
  );
}

function hardscapeHatching(
  f: InterpretFeature,
  w: number,
  h: number,
  georefCtx?: GeorefDisplayContext,
  spanPx = 1000
) {
  const rand = rngFor(f.id);
  const pxPts = geometryToPxPoints(f, w, h, georefCtx);
  if (pxPts.length < 3) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pxPts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  const axis = principalAxisAngle(pxPts);
  const hatchAngle = axis + Math.PI / 4;
  const dx = Math.cos(hatchAngle);
  const dy = Math.sin(hatchAngle);
  const perpX = -dy;
  const perpY = dx;
  const spacing = Math.max(6, spanPx * 0.012);
  const baseW = Math.max(0.7, spanPx * 0.0014);
  const diag = Math.hypot(maxX - minX, maxY - minY);
  const clipId = `ink-hatch-clip-${f.id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const lines: ReactElement[] = [];
  const count = Math.ceil(diag / spacing) + 4;

  for (let i = -count; i <= count; i++) {
    const ox = (minX + maxX) / 2 + perpX * i * spacing;
    const oy = (minY + maxY) / 2 + perpY * i * spacing;
    const len = diag * 1.2;
    const x1 = ox - dx * len;
    const y1 = oy - dy * len;
    const x2 = ox + dx * len;
    const y2 = oy + dy * len;
    lines.push(
      <line
        key={i}
        x1={x1 + (rand() - 0.5) * 2}
        y1={y1 + (rand() - 0.5) * 2}
        x2={x2 + (rand() - 0.5) * 2}
        y2={y2 + (rand() - 0.5) * 2}
        stroke={INK_LIGHT}
        strokeWidth={baseW * (0.85 + rand() * 0.35)}
        clipPath={`url(#${clipId})`}
        opacity={0.65}
      />
    );
  }

  const boundary = handDrawnPath(
    pxPts,
    `${f.id}-edge`,
    Math.max(1.2, spanPx * 0.002),
    Math.max(1.5, spanPx * 0.002)
  );

  return (
    <g key={f.id}>
      <defs>
        <clipPath id={clipId}>
          <polygon points={pxPointsAttr(pxPts)} />
        </clipPath>
      </defs>
      {lines}
      <path
        d={boundary.d}
        fill="none"
        stroke={INK}
        strokeWidth={boundary.strokeWidth}
        strokeLinejoin="round"
      />
    </g>
  );
}

function defaultBoundaryInk(
  f: InterpretFeature,
  w: number,
  h: number,
  georefCtx?: GeorefDisplayContext,
  spanPx = 1000
) {
  const pxPts = geometryToPxPoints(f, w, h, georefCtx);
  const wobble = Math.max(1.5, spanPx * 0.0025);
  const baseW = Math.max(1, spanPx * 0.0022);

  if (f.geometry.kind === "polyline" && pxPts.length >= 2) {
    const { d, strokeWidth } = handDrawnPath(pxPts, f.id, baseW, wobble);
    return (
      <path
        key={f.id}
        d={d}
        fill="none"
        stroke={INK}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    );
  }

  if (pxPts.length >= 3) {
    const { d, strokeWidth } = handDrawnPath(pxPts, f.id, baseW, wobble);
    return (
      <path
        key={f.id}
        d={d}
        fill="none"
        stroke={INK}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    );
  }

  return null;
}

type Props = {
  features: InterpretFeature[];
  imageW: number;
  imageH: number;
  georefCtx?: GeorefDisplayContext;
  spanPx?: number;
};

export function PlanInkLinework({ features, imageW, imageH, georefCtx, spanPx }: Props) {
  const span = spanPx ?? Math.max(imageW, imageH);
  const design = features.filter((f) => !f.existing && f.featureType !== "property_boundary");

  return (
    <g className="plan-ink-linework" aria-hidden>
      {design.map((f) => {
        if (isTreeType(f.featureType) || f.geometry.kind === "point") {
          return treeInk(f, imageW, imageH, georefCtx, span);
        }
        if (isOrnamentalGrassType(f.featureType) || isLawnAccentType(f.featureType)) {
          return grassTicks(f, imageW, imageH, georefCtx, span);
        }
        if (isBoulderStoneType(f.featureType)) {
          return boulderStoneInk(f, imageW, imageH, georefCtx, span);
        }
        if (isHardscapeType(f.featureType)) {
          return hardscapeHatching(f, imageW, imageH, georefCtx, span);
        }
        return defaultBoundaryInk(f, imageW, imageH, georefCtx, span);
      })}
    </g>
  );
}
