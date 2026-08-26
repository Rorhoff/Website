import { z } from "zod";
import { StoredInterpretationSchema, InterpretFeatureSchema } from "@/lib/interpret-schema";
import { StoredDesignContentSchema } from "@/lib/design-content-schema";
import { BlenderRenderSettingsSchema, BlenderRendersSchema } from "@/lib/blender-schema";
import { DtmCacheSchema, StoredElevationAnalysisSchema } from "@/lib/elevation-schema";
import {
  WatercolorCacheEntrySchema,
  WatercolorParamsSchema,
  WatercolorPresetIdSchema,
} from "@/lib/watercolor-schema";
import { PlanRenderCacheEntrySchema } from "@/lib/plan-render-schema";
import { PrintOrthoSchema, TilePyramidSchema } from "@/lib/tile-pyramid-schema";

export const DesignStyleSchema = z.enum([
  "Modern",
  "Traditional",
  "Xeriscape",
  "Mountain Modern",
  "Mediterranean",
]);

export type DesignStyle = z.infer<typeof DesignStyleSchema>;

const ImageAssetSchema = z.object({
  filename: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const AffineTransformSchema = z.object({
  a: z.number(),
  b: z.number(),
  c: z.number(),
  d: z.number(),
  e: z.number(),
  f: z.number(),
});

export type AffineTransform = z.infer<typeof AffineTransformSchema>;

export const BoundingBoxSchema = z.object({
  minX: z.number(),
  minY: z.number(),
  maxX: z.number(),
  maxY: z.number(),
});

export const GeoreferenceSchema = z.object({
  crs: z.string(),
  epsg: z.number().int().optional(),
  affine: AffineTransformSchema,
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  gsdMeters: z.number().positive(),
  gsdInches: z.number().positive(),
  boundsProjected: BoundingBoxSchema,
  boundsWgs84: BoundingBoxSchema,
  pixelsPerFoot: z.number().positive(),
});

export const WebodmFileCheckSchema = z.object({
  key: z.string(),
  label: z.string(),
  relativePath: z.string(),
  required: z.boolean(),
  expected: z.boolean().optional(),
  found: z.boolean(),
  storedAs: z.string().optional(),
});

export const WebodmIngestSchema = z.object({
  sourceFolder: z.string().optional(),
  ingestedAt: z.string(),
  checklist: z.array(WebodmFileCheckSchema),
  georeferencingMode: z.enum(["gcp", "gps"]),
  gcpCount: z.number().int().optional(),
  orthophotoStoredAs: z.string(),
  projStoredAs: z.string().optional(),
});

export const AnnotationBaseSchema = z.object({
  filename: z.string(),
  metaFilename: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  longEdgePx: z.number().int().positive(),
  downscaleFactor: z.number().positive(),
  affine: AffineTransformSchema,
  pixelsPerFoot: z.number().positive(),
  crs: z.string().optional(),
  fullWidthPx: z.number().int().positive(),
  fullHeightPx: z.number().int().positive(),
  exportedAt: z.string(),
});

const NormalizedPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

export const CalibrationSchema = z.object({
  pointA: NormalizedPointSchema,
  pointB: NormalizedPointSchema,
  distanceFeet: z.number().positive(),
  pixelsPerFoot: z.number().positive(),
});

export const ScaleVerificationSchema = z.object({
  description: z.string(),
  pointA: NormalizedPointSchema,
  pointB: NormalizedPointSchema,
  expectedFeet: z.number().positive(),
  measuredFeet: z.number().positive(),
  ratio: z.number().positive(),
  passed: z.boolean(),
  verifiedAt: z.string(),
});

export const ProjectMetadataSchema = z.object({
  clientName: z.string(),
  propertyAddress: z.string(),
  projectTitle: z.string(),
  designStyle: DesignStyleSchema,
  climateZone: z.string(),
  notes: z.string(),
});

export const EditorSettingsSchema = z.object({
  hiddenFeatureTypes: z.array(z.string()).default([]),
});

export const PlanSettingsSchema = z.object({
  baseMode: z.enum(["orthophoto", "white", "ai_render"]).default("orthophoto"),
  basePreset: WatercolorPresetIdSchema.default("off"),
  orthophotoOpacity: z.number().min(0.05).max(1).default(0.4),
  showFeatureOutlines: z.boolean().default(true),
  watercolorParamOverrides: WatercolorParamsSchema.partial().optional(),
  showContours: z.boolean().default(false),
  showDrainageArrows: z.boolean().default(false),
  contourMinorFt: z.number().positive().default(1),
  contourMajorFt: z.number().positive().default(5),
});

export const RenderSlotsSchema = z.object({
  hero: z.string().optional(),
  entry: z.string().optional(),
  fire_pit: z.string().optional(),
  hero_dusk: z.string().optional(),
});

export const RenderMetaEntrySchema = z.object({
  source: z.enum(["generated", "upload", "blender", "blender+gemini"]),
  generatedAt: z.string().optional(),
  provider: z.enum(["gemini", "flux", "openai"]).optional(),
  blenderBase: z.string().optional(),
});

export const RenderMetaSchema = z.object({
  hero: RenderMetaEntrySchema.optional(),
  entry: RenderMetaEntrySchema.optional(),
  fire_pit: RenderMetaEntrySchema.optional(),
  hero_dusk: RenderMetaEntrySchema.optional(),
});

export const RenderSettingsSchema = z.object({
  provider: z.enum(["gemini", "flux", "openai"]).optional(),
});

export const BoardSettingsSchema = z.object({
  pageSize: z.enum(["24x36", "18x24", "11x17"]).default("24x36"),
  sheetNumber: z.string().default("C-100"),
  revision: z.string().default("Rev 1"),
  designer: z.string().default(""),
  issueDate: z.string().optional(),
  enabledNoteIds: z.array(z.string()).optional(),
});

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  version: z.literal(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  metadata: ProjectMetadataSchema,
  images: z.object({
    annotated: ImageAssetSchema.optional(),
    clean: ImageAssetSchema.optional(),
    preview: ImageAssetSchema.optional(),
  }),
  georeference: GeoreferenceSchema.optional(),
  webodm: WebodmIngestSchema.optional(),
  annotationBase: AnnotationBaseSchema.optional(),
  scaleVerification: ScaleVerificationSchema.optional(),
  calibration: CalibrationSchema.optional(),
  northRotationDeg: z.number().default(0),
  interpretation: StoredInterpretationSchema.optional(),
  features: z.array(InterpretFeatureSchema).optional(),
  editorSettings: EditorSettingsSchema.optional(),
  planSettings: PlanSettingsSchema.optional(),
  dtmCache: DtmCacheSchema.optional(),
  tilePyramid: TilePyramidSchema.optional(),
  printOrtho: PrintOrthoSchema.optional(),
  watercolorCache: z.record(z.string(), z.lazy(() => WatercolorCacheEntrySchema)).optional(),
  planRenderCache: z.record(z.string(), z.lazy(() => PlanRenderCacheEntrySchema)).optional(),
  elevationAnalysis: StoredElevationAnalysisSchema.optional(),
  blenderRenders: BlenderRendersSchema.optional(),
  blenderSettings: BlenderRenderSettingsSchema.optional(),
  designContent: StoredDesignContentSchema.optional(),
  renderSlots: RenderSlotsSchema.optional(),
  renderMeta: RenderMetaSchema.optional(),
  renderSettings: RenderSettingsSchema.optional(),
  boardSettings: BoardSettingsSchema.optional(),
});

export type Project = z.infer<typeof ProjectSchema>;
export type ProjectMetadata = z.infer<typeof ProjectMetadataSchema>;
export type Calibration = z.infer<typeof CalibrationSchema>;
export type ScaleVerification = z.infer<typeof ScaleVerificationSchema>;
export type Georeference = z.infer<typeof GeoreferenceSchema>;
export type WebodmIngest = z.infer<typeof WebodmIngestSchema>;
export type WebodmFileCheck = z.infer<typeof WebodmFileCheckSchema>;
export type AnnotationBase = z.infer<typeof AnnotationBaseSchema>;

export const ProjectSummarySchema = z.object({
  id: z.string().uuid(),
  projectTitle: z.string(),
  clientName: z.string(),
  updatedAt: z.string(),
  hasAnnotated: z.boolean(),
  hasWebodm: z.boolean(),
  calibrated: z.boolean(),
  scaleVerified: z.boolean(),
});

export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export type EditorSettings = z.infer<typeof EditorSettingsSchema>;
export type PlanSettings = z.infer<typeof PlanSettingsSchema>;
export type RenderSlots = z.infer<typeof RenderSlotsSchema>;
export type RenderMeta = z.infer<typeof RenderMetaSchema>;
export type RenderSettings = z.infer<typeof RenderSettingsSchema>;
export type BoardSettings = z.infer<typeof BoardSettingsSchema>;

export function defaultMetadata(): ProjectMetadata {
  return {
    clientName: "",
    propertyAddress: "",
    projectTitle: "",
    designStyle: "Mountain Modern",
    climateZone: "USDA 6b/7a, Salt Lake Valley",
    notes: "",
  };
}

export function createEmptyProject(id: string): Project {
  const now = new Date().toISOString();
  return {
    id,
    version: 1,
    createdAt: now,
    updatedAt: now,
    metadata: defaultMetadata(),
    images: {},
    northRotationDeg: 0,
  };
}
