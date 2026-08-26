import { z } from "zod";

export const PLAN_RENDER_PROMPT_VERSION = 1;

export const PlanRenderColorMapEntrySchema = z.object({
  hex: z.string(),
  featureType: z.string(),
  featureIds: z.array(z.string()),
});

export const PlanRenderCacheEntrySchema = z.object({
  hash: z.string(),
  maskFilename: z.string(),
  renderFilename: z.string(),
  previewFilename: z.string().optional(),
  colorMap: z.record(z.string(), PlanRenderColorMapEntrySchema),
  registrationDisplacementPct: z.number().optional(),
  registrationPassed: z.boolean(),
  quality: z.enum(["draft", "final"]),
  generatedAt: z.string(),
  estimatedCostUsd: z.number().nonnegative().optional(),
  model: z.string().optional(),
});

export type PlanRenderCacheEntry = z.infer<typeof PlanRenderCacheEntrySchema>;

export const PlanRenderJobSchema = z.object({
  status: z.enum(["idle", "running", "complete", "error"]),
  progress: z.number().min(0).max(100),
  step: z.string().optional(),
  error: z.string().optional(),
});

export type PlanRenderJob = z.infer<typeof PlanRenderJobSchema>;

export function planRenderFilenames(hash: string, preview = false): string {
  return preview ? `plan-render-${hash}-preview.png` : `plan-render-${hash}.png`;
}

export function planMaskFilename(hash: string): string {
  return `plan-mask-${hash}.png`;
}
