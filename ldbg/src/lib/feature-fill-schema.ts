import { z } from "zod";

export const FEATURE_FILL_PROMPT_VERSION = 1;

export const FeatureFillStatusSchema = z.enum([
  "none",
  "generating",
  "filled",
  "failed",
]);

export type FeatureFillStatus = z.infer<typeof FeatureFillStatusSchema>;

export const FeatureFillEntrySchema = z.object({
  featureId: z.string(),
  status: FeatureFillStatusSchema,
  imageFilename: z.string().optional(),
  cropPreviewFilename: z.string().optional(),
  cropBox: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional(),
  prompt: z.string().optional(),
  hash: z.string().optional(),
  error: z.string().optional(),
  generatedAt: z.string().optional(),
  estimatedCostUsd: z.number().nonnegative().optional(),
});

export type FeatureFillEntry = z.infer<typeof FeatureFillEntrySchema>;

export function featureFillImageFilename(featureId: string, hash: string): string {
  return `feature-fill-${featureId.slice(0, 8)}-${hash}.png`;
}

export function featureCropPreviewFilename(featureId: string): string {
  return `feature-crop-${featureId.slice(0, 8)}.jpg`;
}
