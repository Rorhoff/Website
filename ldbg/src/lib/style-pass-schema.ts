import { z } from "zod";
import type { StylePresetId } from "@/config/styles";

export const RegistrationResultSchema = z.object({
  inlierCount: z.number().int().nonnegative(),
  residualPct: z.number().nonnegative(),
  passed: z.boolean(),
  labelMode: z.enum(["inline", "callouts", "failed"]),
  error: z.string().optional(),
});

export type RegistrationResult = z.infer<typeof RegistrationResultSchema>;

export const StylePassCacheEntrySchema = z.object({
  preset: z.string(),
  hash: z.string(),
  compositeFilename: z.string(),
  styledFilename: z.string(),
  registeredFilename: z.string(),
  previewFilename: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  registration: RegistrationResultSchema,
  generatedAt: z.string(),
  estimatedCostUsd: z.number().nonnegative().optional(),
});

export type StylePassCacheEntry = z.infer<typeof StylePassCacheEntrySchema>;

export const StylePassJobSchema = z.object({
  status: z.enum(["idle", "running", "complete", "error"]),
  preset: z.string().optional(),
  progress: z.number().min(0).max(100).default(0),
  step: z.string().optional(),
  error: z.string().optional(),
  pythonInterpreter: z.string().optional(),
  cacheHash: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

export type StylePassJob = z.infer<typeof StylePassJobSchema>;

export const StylePresetIdSchema = z.enum([
  "off",
  "watercolor-plan",
  "ink-only",
  "marker",
  "photoreal",
]) satisfies z.ZodType<StylePresetId>;

export function stylePassFilenames(hash: string) {
  const base = `derived/style-${hash}`;
  return {
    composite: `${base}-composite.png`,
    styled: `${base}-styled.png`,
    registered: `${base}-registered.png`,
    preview: `${base}-preview.png`,
  };
}
