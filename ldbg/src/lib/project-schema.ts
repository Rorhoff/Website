import { z } from "zod";
import { StoredInterpretationSchema, InterpretFeatureSchema } from "@/lib/interpret-schema";
import { StoredDesignContentSchema } from "@/lib/design-content-schema";

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
  baseMode: z.enum(["orthophoto", "white"]).default("orthophoto"),
  orthophotoOpacity: z.number().min(0.05).max(1).default(0.4),
});

export const RenderSlotsSchema = z.object({
  hero: z.string().optional(),
  entry: z.string().optional(),
  fire_pit: z.string().optional(),
  hero_dusk: z.string().optional(),
});

export const RenderMetaEntrySchema = z.object({
  source: z.enum(["generated", "upload"]),
  generatedAt: z.string().optional(),
  provider: z.enum(["gemini", "flux", "openai"]).optional(),
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
  }),
  calibration: CalibrationSchema.optional(),
  northRotationDeg: z.number(),
  interpretation: StoredInterpretationSchema.optional(),
  features: z.array(InterpretFeatureSchema).optional(),
  editorSettings: EditorSettingsSchema.optional(),
  planSettings: PlanSettingsSchema.optional(),
  designContent: StoredDesignContentSchema.optional(),
  renderSlots: RenderSlotsSchema.optional(),
  renderMeta: RenderMetaSchema.optional(),
  renderSettings: RenderSettingsSchema.optional(),
  boardSettings: BoardSettingsSchema.optional(),
});

export type Project = z.infer<typeof ProjectSchema>;
export type ProjectMetadata = z.infer<typeof ProjectMetadataSchema>;
export type Calibration = z.infer<typeof CalibrationSchema>;

export const ProjectSummarySchema = z.object({
  id: z.string().uuid(),
  projectTitle: z.string(),
  clientName: z.string(),
  updatedAt: z.string(),
  hasAnnotated: z.boolean(),
  calibrated: z.boolean(),
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
