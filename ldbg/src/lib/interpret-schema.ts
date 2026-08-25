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
  /** CV palette match distance (Lab space); advisory when high. */
  paletteMatchDistance: z.number().optional(),
});

/** Claude vision output — always normalized image coordinates. */
export const ClaudeInterpretFeatureSchema = InterpretFeatureSchema.omit({
  paletteMatchDistance: true,
}).extend({
  geometry: NormalizedGeometrySchema,
  paletteMatchDistance: z.number().optional(),
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
  /** cv = mask-diff pipeline; claude-vision = legacy full-scene interpret */
  method: z.enum(["cv", "claude-vision"]).optional(),
  importMaskFilename: z.string().optional(),
});

export const StoredInterpretationSchema = InterpretationResultSchema.merge(
  InterpretationMetaSchema
);

export type StoredInterpretation = z.infer<typeof StoredInterpretationSchema>;

export const REVIEW_CONFIDENCE_THRESHOLD = 0.6;
export const REVIEW_PALETTE_DISTANCE_WARN = 28;
export const REVIEW_MAX_FRAME_FRACTION = 0.25;

export function featureFrameFraction(
  f: InterpretFeature,
  imageWidth: number,
  imageHeight: number
): number | null {
  if (f.geometry.kind !== "polygon" || !("points" in f.geometry)) return null;
  const pts = f.geometry.points;
  if (pts.length < 3) return null;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const x1 = pts[i].x * imageWidth;
    const y1 = pts[i].y * imageHeight;
    const x2 = pts[(i + 1) % pts.length].x * imageWidth;
    const y2 = pts[(i + 1) % pts.length].y * imageHeight;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) * 0.5 / (imageWidth * imageHeight);
}

function geometryVertexCount(f: InterpretFeature): number {
  if ("points" in f.geometry) return f.geometry.points.length;
  if ("coordinates" in f.geometry) return f.geometry.coordinates.length;
  return 0;
}

export function needsReview(result: InterpretationResult): boolean {
  if (result.ambiguities.length > 0) return true;
  if (result.features.some((f) => f.confidence < REVIEW_CONFIDENCE_THRESHOLD)) return true;
  if (
    result.features.some(
      (f) =>
        (f.paletteMatchDistance ?? 0) > REVIEW_PALETTE_DISTANCE_WARN ||
        (f.geometry.kind === "polyline" && geometryVertexCount(f) < 3)
    )
  ) {
    return true;
  }
  const w = result.imageSize.width;
  const h = result.imageSize.height;
  return result.features.some((f) => {
    const frac = featureFrameFraction(f, w, h);
    return frac != null && frac > REVIEW_MAX_FRAME_FRACTION;
  });
}

export function reviewItems(result: InterpretationResult): string[] {
  const items: string[] = [...result.ambiguities];
  const w = result.imageSize.width;
  const h = result.imageSize.height;
  for (const f of result.features) {
    if (f.confidence < REVIEW_CONFIDENCE_THRESHOLD) {
      items.push(
        `Low confidence (${f.confidence.toFixed(2)}): ${f.label || f.featureType} (${f.id})`
      );
    }
    if ((f.paletteMatchDistance ?? 0) > REVIEW_PALETTE_DISTANCE_WARN) {
      items.push(
        `Weak palette match (ΔE ${f.paletteMatchDistance?.toFixed(1)}): ${f.label || f.featureType}`
      );
    }
    if (f.geometry.kind === "polyline" && geometryVertexCount(f) < 3) {
      items.push(`Line feature has fewer than 3 vertices: ${f.label || f.featureType}`);
    }
    const frac = featureFrameFraction(f, w, h);
    if (frac != null && frac > REVIEW_MAX_FRAME_FRACTION) {
      items.push(
        `Large feature (${(frac * 100).toFixed(0)}% of frame): ${f.label || f.featureType}`
      );
    }
  }
  const labels = result.features.map((f) => f.label);
  const dup = labels.find((l, i) => labels.indexOf(l) !== i);
  if (dup) items.push(`Duplicate feature label: ${dup}`);
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
