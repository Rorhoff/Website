import { z } from "zod";

export const InterpretPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const InterpretGeometrySchema = z.object({
  kind: z.enum(["polygon", "point", "polyline"]),
  points: z.array(InterpretPointSchema).min(1),
  radius: z.number().min(0).max(1).optional(),
});

export const InterpretFeatureSchema = z.object({
  id: z.string().min(1),
  featureType: z.string().min(1),
  label: z.string(),
  geometry: InterpretGeometrySchema,
  existing: z.boolean(),
  confidence: z.number().min(0).max(1),
  notes: z.string(),
});

export const InterpretationResultSchema = z.object({
  imageSize: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  features: z.array(InterpretFeatureSchema),
  siteObservations: z.array(z.string()),
  ambiguities: z.array(z.string()),
});

export type InterpretationResult = z.infer<typeof InterpretationResultSchema>;
export type InterpretFeature = z.infer<typeof InterpretFeatureSchema>;

export const InterpretationMetaSchema = z.object({
  interpretedAt: z.string(),
  model: z.string(),
  downscaleFactor: z.number().positive().optional(),
  tokenUsage: z
    .object({
      input: z.number().int().nonnegative(),
      output: z.number().int().nonnegative(),
    })
    .optional(),
  estimatedCostUsd: z.number().nonnegative().optional(),
  reviewClearedAt: z.string().optional(),
});

export const StoredInterpretationSchema = InterpretationResultSchema.merge(
  InterpretationMetaSchema
);

export type StoredInterpretation = z.infer<typeof StoredInterpretationSchema>;

export const REVIEW_CONFIDENCE_THRESHOLD = 0.6;

export function needsReview(result: InterpretationResult): boolean {
  if (result.ambiguities.length > 0) return true;
  return result.features.some((f) => f.confidence < REVIEW_CONFIDENCE_THRESHOLD);
}

export function reviewItems(result: InterpretationResult): string[] {
  const items: string[] = [...result.ambiguities];
  for (const f of result.features) {
    if (f.confidence < REVIEW_CONFIDENCE_THRESHOLD) {
      items.push(
        `Low confidence (${f.confidence.toFixed(2)}): ${f.label || f.featureType} (${f.id})`
      );
    }
  }
  return items;
}

/** Ensure imageSize reflects the full-resolution annotated orthophoto. */
export function normalizeInterpretationToOriginal(
  result: InterpretationResult,
  originalWidth: number,
  originalHeight: number
): InterpretationResult {
  return {
    ...result,
    imageSize: { width: originalWidth, height: originalHeight },
  };
}
