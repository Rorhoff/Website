import { z } from "zod";

const AffineTransformSchema = z.object({
  a: z.number(),
  b: z.number(),
  c: z.number(),
  d: z.number(),
  e: z.number(),
  f: z.number(),
});

const BoundingBoxSchema = z.object({
  minX: z.number(),
  minY: z.number(),
  maxX: z.number(),
  maxY: z.number(),
});

export const DtmCacheSchema = z.object({
  crs: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  cellSizeMeters: z.number().positive(),
  transform: AffineTransformSchema,
  boundsProjected: BoundingBoxSchema,
  nodata: z.number().nullable().optional(),
  minElevationMeters: z.number(),
  maxElevationMeters: z.number(),
  builtAt: z.string(),
  filename: z.string().default("dtm-cache.json"),
});

export const ElevationRangeFeetSchema = z.object({
  min: z.number(),
  max: z.number(),
  mean: z.number(),
});

export const SlopeRangeSchema = z.object({
  min: z.number(),
  max: z.number(),
  mean: z.number(),
});

export const CutFillSchema = z.object({
  cutCubicYards: z.number().nonnegative(),
  fillCubicYards: z.number().nonnegative(),
  netCubicYards: z.number(),
});

export const WaterFeatureHeadSchema = z.object({
  topElevationFeet: z.number(),
  bottomElevationFeet: z.number(),
  headFeet: z.number(),
});

export const RetainingWallSampleSchema = z.object({
  x: z.number(),
  y: z.number(),
  exposedHeightFeet: z.number(),
  flag: z.string().optional(),
});

export const RetainingWallAnalysisSchema = z.object({
  samples: z.array(RetainingWallSampleSchema),
});

export const FeatureElevationAnalysisSchema = z.object({
  featureId: z.string(),
  featureType: z.string(),
  label: z.string(),
  elevationFeet: ElevationRangeFeetSchema,
  slopePct: SlopeRangeSchema,
  flags: z.array(z.string()),
  targetElevationFeet: z.number().optional(),
  cutFill: CutFillSchema.optional(),
  waterFeatureHead: WaterFeatureHeadSchema.optional(),
  retainingWall: RetainingWallAnalysisSchema.optional(),
});

export const ContourLineSchema = z.object({
  elevationFeet: z.number(),
  major: z.boolean(),
  coordinates: z.array(z.object({ x: z.number(), y: z.number() })).min(2),
});

export const DrainageArrowSchema = z.object({
  x: z.number(),
  y: z.number(),
  dx: z.number(),
  dy: z.number(),
  slopePct: z.number(),
});

export const ContourSettingsSchema = z.object({
  minorFeet: z.number().positive(),
  majorFeet: z.number().positive(),
});

export const ElevationAnalysisResultSchema = z.object({
  crs: z.string().optional(),
  dtmBounds: BoundingBoxSchema.optional(),
  features: z.array(FeatureElevationAnalysisSchema),
  contours: z.array(ContourLineSchema),
  drainageArrows: z.array(DrainageArrowSchema),
  contourSettings: ContourSettingsSchema,
});

export const ElevationAnalysisMetaSchema = z.object({
  analyzedAt: z.string(),
  dtmSource: z.string().optional(),
});

export const StoredElevationAnalysisSchema =
  ElevationAnalysisResultSchema.merge(ElevationAnalysisMetaSchema);

export type DtmCache = z.infer<typeof DtmCacheSchema>;
export type FeatureElevationAnalysis = z.infer<typeof FeatureElevationAnalysisSchema>;
export type ElevationAnalysisResult = z.infer<typeof ElevationAnalysisResultSchema>;
export type StoredElevationAnalysis = z.infer<typeof StoredElevationAnalysisSchema>;
export type ContourLine = z.infer<typeof ContourLineSchema>;
export type DrainageArrow = z.infer<typeof DrainageArrowSchema>;
