import { z } from "zod";
import { WatercolorPresetId } from "@/config/watercolor";

export const WatercolorParamsSchema = z.object({
  bilateral: z.object({
    d: z.number().int().positive(),
    sigmaColor: z.number().positive(),
    sigmaSpace: z.number().positive(),
  }),
  stylization: z.object({
    method: z.enum(["stylization", "kuwahara"]),
    sigmaS: z.number().positive(),
    sigmaR: z.number().positive(),
    kuwaharaRadius: z.number().int().positive(),
  }),
  posterize: z.object({
    levels: z.number().int().min(12).max(255),
  }),
  hsv: z.object({
    saturationMultiplier: z.number().positive(),
    valueFloor: z.number().min(0).max(1),
  }),
  edgeDarkening: z.object({
    enabled: z.boolean(),
    opacity: z.number().min(0).max(1),
    cannyLow: z.number().positive(),
    cannyHigh: z.number().positive(),
    blurRadius: z.number().int().positive(),
  }),
  granulation: z.object({
    amplitude: z.number().min(0).max(0.2),
    seed: z.number().int(),
  }),
  paperTexture: z.object({
    opacity: z.number().min(0).max(1),
  }),
  edgeFeather: z.object({
    marginFraction: z.number().min(0).max(0.5),
    noiseScale: z.number().positive(),
    seed: z.number().int(),
  }),
  previewLongEdge: z.number().int().positive(),
});

export const WatercolorCacheEntrySchema = z.object({
  preset: z.string(),
  hash: z.string(),
  fullFilename: z.string(),
  previewFilename: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sourceFilename: z.string(),
  filteredAt: z.string(),
});

export const WatercolorJobSchema = z.object({
  status: z.enum(["idle", "running", "complete", "error"]),
  preset: z.string().optional(),
  progress: z.number().min(0).max(100).default(0),
  step: z.string().optional(),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  cacheHash: z.string().optional(),
});

export type WatercolorCacheEntry = z.infer<typeof WatercolorCacheEntrySchema>;
export type WatercolorJob = z.infer<typeof WatercolorJobSchema>;

export const WatercolorPresetIdSchema = z.enum([
  "off",
  "desaturated",
  "watercolor-soft",
  "watercolor-heavy",
  "ink-wash",
]) satisfies z.ZodType<WatercolorPresetId>;
