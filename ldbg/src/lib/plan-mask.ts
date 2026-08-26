import sharp from "sharp";
import type { LegendEntry } from "@/config/legend";
import type { GeorefDisplayContext } from "@/lib/georef-display";
import { featureAreaSqFt } from "@/lib/feature-geometry";
import type { InterpretFeature } from "@/lib/interpret-schema";
import { assignMaskColors, type MaskColorAssignment } from "@/lib/plan-mask-colors";
import {
  featureToRenderPolygonsPx,
  pxPolygonToAttr,
  type PxPoint,
} from "@/lib/polyline-buffer";

export type PlanMaskResult = {
  png: Buffer;
  width: number;
  height: number;
  colorMap: Record<string, MaskColorAssignment>;
};

function insetPolygonPx(points: PxPoint[], insetPx: number): PxPoint[] {
  if (points.length < 3 || insetPx <= 0) return points;
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= points.length;
  cy /= points.length;
  return points.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy) || 1;
    const scale = Math.max(0, (d - insetPx) / d);
    return { x: cx + dx * scale, y: cy + dy * scale };
  });
}

export function buildPlanMaskSvg(
  features: InterpretFeature[],
  legend: LegendEntry[],
  imageW: number,
  imageH: number,
  pixelsPerFoot?: number,
  georefCtx?: GeorefDisplayContext
): { svg: string; colorMap: Record<string, MaskColorAssignment> } {
  const proposed = features.filter((f) => !f.existing && f.featureType !== "property_boundary");
  const typeColor = assignMaskColors(proposed.map((f) => f.featureType));

  const colorMap: Record<string, MaskColorAssignment> = {};
  for (const [ft, hex] of typeColor) {
    colorMap[hex] = { hex, featureType: ft, featureIds: [] };
  }

  const polygons: { hex: string; points: string }[] = [];

  for (const f of proposed) {
    const hex = typeColor.get(f.featureType) ?? "#FF00FF";
    colorMap[hex]?.featureIds.push(f.id);

    const entry = legend.find((e) => e.featureType === f.featureType);
    const widthFt = f.widthFt ?? entry?.defaultWidthFt;

    if (f.featureType === "putting_green" && f.fringeWidthIn != null && f.fringeWidthIn > 0) {
      const insetPx =
        pixelsPerFoot && pixelsPerFoot > 0
          ? (f.fringeWidthIn / 12) * pixelsPerFoot
          : (f.fringeWidthIn / 12) * (imageW / 80);
      const outer = featureToRenderPolygonsPx(f, imageW, imageH, pixelsPerFoot, georefCtx, widthFt);
      for (const ring of outer) {
        polygons.push({ hex: "#FF00FF", points: pxPolygonToAttr(ring) });
        const inner = insetPolygonPx(ring, insetPx);
        if (inner.length >= 3) {
          polygons.push({ hex: "#7CFC7C", points: pxPolygonToAttr(inner) });
        }
      }
      continue;
    }

    const rings = featureToRenderPolygonsPx(
      f,
      imageW,
      imageH,
      pixelsPerFoot,
      georefCtx,
      widthFt
    );
    for (const ring of rings) {
      if (ring.length >= 3) {
        polygons.push({ hex, points: pxPolygonToAttr(ring) });
      }
    }
  }

  const body = polygons
    .map((p) => `<polygon points="${p.points}" fill="${p.hex}" stroke="none"/>`)
    .join("\n");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${imageW}" height="${imageH}" viewBox="0 0 ${imageW} ${imageH}">
  <rect width="100%" height="100%" fill="#000000"/>
  ${body}
</svg>`;

  return { svg, colorMap };
}

export async function generatePlanMaskPng(
  features: InterpretFeature[],
  legend: LegendEntry[],
  imageW: number,
  imageH: number,
  pixelsPerFoot?: number,
  georefCtx?: GeorefDisplayContext
): Promise<PlanMaskResult> {
  const { svg, colorMap } = buildPlanMaskSvg(
    features,
    legend,
    imageW,
    imageH,
    pixelsPerFoot,
    georefCtx
  );

  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const meta = await sharp(png).metadata();
  const width = meta.width ?? imageW;
  const height = meta.height ?? imageH;

  if (width !== imageW || height !== imageH) {
    throw new Error(`Mask dimensions ${width}x${height} != ${imageW}x${imageH}`);
  }

  return { png, width, height, colorMap };
}

export function maskFeatureAreasForPrompt(
  features: InterpretFeature[],
  legend: LegendEntry[],
  imageW: number,
  imageH: number,
  pixelsPerFoot?: number,
  georefCtx?: GeorefDisplayContext
): { featureType: string; hex: string; areaSqFt: number; material: string }[] {
  const proposed = features.filter((f) => !f.existing && f.featureType !== "property_boundary");
  const typeColor = assignMaskColors(proposed.map((f) => f.featureType));
  const byType = new Map<string, { area: number; material: string }>();

  for (const f of proposed) {
    const entry = legend.find((e) => e.featureType === f.featureType);
    const area =
      featureAreaSqFt(f, imageW, imageH, pixelsPerFoot, georefCtx) ?? 0;
    const prev = byType.get(f.featureType);
    byType.set(f.featureType, {
      area: (prev?.area ?? 0) + area,
      material: entry?.defaultMaterial ?? f.featureType,
    });
  }

  return [...byType.entries()].map(([featureType, { area, material }]) => ({
    featureType,
    hex: typeColor.get(featureType) ?? "#FFFFFF",
    areaSqFt: Math.round(area),
    material,
  }));
}
