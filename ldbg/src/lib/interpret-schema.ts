import { z } from "zod";

export const InterpretPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const NormalizedGeometrySchema = z.object({
  kind: z.enum(["polygon", "point", "polyline"]),
  points: z.array(InterpretPointSchema).min(1),
  radius: z.number().min(0).max(1).optional(),
});

export const ProjectedCoordinateSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number().optional(),
});

export const ProjectedGeometrySchema = z.object({
  kind: z.enum(["polygon", "point", "polyline"]),
  crs: z.string(),
  coordinates: z.array(ProjectedCoordinateSchema).min(1),
  /** Metres (ground plane). */
  radius: z.number().positive().optional(),
});

export const InterpretGeometrySchema = z.union([
  ProjectedGeometrySchema,
  NormalizedGeometrySchema,
]);

export const InterpretFeatureSchema = z.object({
  id: z.string().min(1),
  featureType: z.string().min(1),
  label: z.string(),
  geometry: InterpretGeometrySchema,
  existing: z.boolean(),
  confidence: z.number().min(0).max(1),
  notes: z.string(),
  /** Proposed finish pad elevation (feet, NAVD88 or local vertical datum per DTM). */
  targetElevationFeet: z.number().optional(),
  /** Proposed pad slope (%). */
  targetSlopePct: z.number().optional(),
});

/** Claude vision output — always normalized image coordinates. */
export const ClaudeInterpretFeatureSchema = InterpretFeatureSchema.extend({
  geometry: NormalizedGeometrySchema,
});

export const ClaudeInterpretationResultSchema = z.object({
  imageSize: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  features: z.array(ClaudeInterpretFeatureSchema),
  siteObservations: z.array(z.string()),
  ambiguities: z.array(z.string()),
});

export const InterpretationResultSchema = ClaudeInterpretationResultSchema.extend({
  features: z.array(InterpretFeatureSchema),
});

export type NormalizedGeometry = z.infer<typeof NormalizedGeometrySchema>;
export type ProjectedGeometry = z.infer<typeof ProjectedGeometrySchema>;
export type InterpretGeometry = z.infer<typeof InterpretGeometrySchema>;
export type InterpretFeature = z.infer<typeof InterpretFeatureSchema>;
export type ClaudeInterpretationResult = z.infer<typeof ClaudeInterpretationResultSchema>;
export type InterpretationResult = z.infer<typeof InterpretationResultSchema>;

export const InterpretationMetaSchema = z.object({
  interpretedAt: z.string(),
  model: z.string(),
  downscaleFactor: z.number().positive().optional(),
  /** Pixel space used for normalized→pixel conversion (annotated file bytes, not clean ortho). */
  interpretImageSpace: z
    .object({
      coordWidth: z.number().int().positive(),
      coordHeight: z.number().int().positive(),
      sentWidth: z.number().int().positive(),
      sentHeight: z.number().int().positive(),
      downscaleFactor: z.number().positive(),
      storedAnnotatedWidth: z.number().int().positive().optional(),
      storedAnnotatedHeight: z.number().int().positive().optional(),
    })
    .optional(),
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
  result: ClaudeInterpretationResult,
  originalWidth: number,
  originalHeight: number
): InterpretationResult {
  return {
    ...result,
    imageSize: { width: originalWidth, height: originalHeight },
  };
}
