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
  pipelineSteps: z
    .array(
      z.object({
        step: z.string(),
        progress: z.number().optional(),
        executed: z.boolean(),
      })
    )
    .optional(),
  paramsUsed: WatercolorParamsSchema.partial().optional(),
  paperTextureApplied: z.boolean().optional(),
  /** Bump when Python lightening contract changes — stale entries are ignored. */
  pipelineVersion: z.number().int().positive().optional(),
});

export const WatercolorJobSchema = z.object({
  status: z.enum(["idle", "running", "complete", "failed", "error"]),
  preset: z.string().optional(),
  progress: z.number().min(0).max(100).default(0),
  step: z.string().optional(),
  error: z.string().optional(),
  pythonInterpreter: z.string().optional(),
  commandLine: z.string().optional(),
  stderr: z.string().optional(),
  stdout: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  cacheHash: z.string().optional(),
  sourceKind: z.enum(["annotated", "display", "print"]).optional(),
});

/** Normalize legacy job files (`error` status → `failed`). */
export function normalizeWatercolorJob(raw: unknown): WatercolorJob {
  const parsed = WatercolorJobSchema.parse(raw);
  if (parsed.status === "error") {
    return { ...parsed, status: "failed" };
  }
  return parsed;
}

export type WatercolorCacheEntry = z.infer<typeof WatercolorCacheEntrySchema>;
export type WatercolorJob = z.infer<typeof WatercolorJobSchema>;

export const WatercolorPresetIdSchema = z.enum([
  "off",
  "desaturated",
  "watercolor-soft",
  "watercolor-heavy",
  "ink-wash",
]) satisfies z.ZodType<WatercolorPresetId>;
