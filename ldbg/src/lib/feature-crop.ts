import sharp from "sharp";
import type { GeorefDisplayContext } from "@/lib/georef-display";
import type { InterpretFeature } from "@/lib/interpret-schema";
import { computeFeaturePxBounds, type PlanContentBounds } from "@/lib/plan-bounds";

export type FeatureCropBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function expandFeatureBounds(
  bounds: PlanContentBounds,
  imageW: number,
  imageH: number,
  marginFraction = 0.1
): FeatureCropBox {
  const padX = bounds.width * marginFraction;
  const padY = bounds.height * marginFraction;
  const x = Math.max(0, Math.floor(bounds.x - padX));
  const y = Math.max(0, Math.floor(bounds.y - padY));
  const width = Math.min(imageW - x, Math.ceil(bounds.width + padX * 2));
  const height = Math.min(imageH - y, Math.ceil(bounds.height + padY * 2));
  return { x, y, width: Math.max(1, width), height: Math.max(1, height) };
}

export function computeFeatureCropBox(
  feature: InterpretFeature,
  imageW: number,
  imageH: number,
  georefCtx?: GeorefDisplayContext,
  marginFraction = 0.1
): FeatureCropBox {
  const bounds = computeFeaturePxBounds(feature, imageW, imageH, georefCtx);
  return expandFeatureBounds(bounds, imageW, imageH, marginFraction);
}

export async function cropFeatureFromImage(
  sourceBuffer: Buffer,
  box: FeatureCropBox
): Promise<Buffer> {
  return sharp(sourceBuffer)
    .extract({
      left: Math.round(box.x),
      top: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    })
    .jpeg({ quality: 92 })
    .toBuffer();
}

export async function upscaleCropLongEdge(
  cropBuffer: Buffer,
  minLongEdge = 1024
): Promise<Buffer> {
  const meta = await sharp(cropBuffer).metadata();
  const w = meta.width ?? 1;
  const h = meta.height ?? 1;
  const long = Math.max(w, h);
  if (long >= minLongEdge) return cropBuffer;
  const scale = minLongEdge / long;
  return sharp(cropBuffer)
    .resize({
      width: Math.round(w * scale),
      height: Math.round(h * scale),
      fit: "fill",
    })
    .png()
    .toBuffer();
}
