import { z } from "zod";

export const PlantEntrySchema = z.object({
  commonName: z.string(),
  botanicalName: z.string(),
  matureSize: z.string(),
  waterNeeds: z.string(),
  sunExposure: z.string(),
  whyChosen: z.string(),
  placement: z.string(),
});

export const MaterialFinishSchema = z.object({
  featureId: z.string(),
  featureType: z.string(),
  label: z.string(),
  material: z.string(),
  description: z.string(),
});

export const TakeoffLineSchema = z.object({
  featureId: z.string(),
  featureType: z.string(),
  label: z.string(),
  unit: z.enum(["sqft", "lf", "each"]),
  quantity: z.number().nonnegative(),
  wasteFactorPct: z.number().nonnegative(),
  quantityWithWaste: z.number().nonnegative(),
  notes: z.string().optional(),
});

export const RenderPromptSchema = z.object({
  id: z.enum(["entry", "fire_pit", "hero_dusk"]),
  title: z.string(),
  prompt: z.string(),
});

export const DesignContentResultSchema = z.object({
  conceptOverview: z.array(z.string()).min(3).max(8),
  plantPalette: z.array(PlantEntrySchema).min(6).max(14),
  materialsAndFinishes: z.array(MaterialFinishSchema),
  takeoff: z.array(TakeoffLineSchema),
  renderPrompts: z.array(RenderPromptSchema).min(3).max(3),
});

export type DesignContentResult = z.infer<typeof DesignContentResultSchema>;
export type PlantEntry = z.infer<typeof PlantEntrySchema>;
export type MaterialFinish = z.infer<typeof MaterialFinishSchema>;
export type TakeoffLine = z.infer<typeof TakeoffLineSchema>;
export type RenderPrompt = z.infer<typeof RenderPromptSchema>;

export const DesignContentMetaSchema = z.object({
  generatedAt: z.string(),
  model: z.string(),
  tokenUsage: z
    .object({
      input: z.number().int().nonnegative(),
      output: z.number().int().nonnegative(),
    })
    .optional(),
  estimatedCostUsd: z.number().nonnegative().optional(),
  approvedAt: z.string().optional(),
});

export const StoredDesignContentSchema = DesignContentResultSchema.merge(
  DesignContentMetaSchema
);

export type StoredDesignContent = z.infer<typeof StoredDesignContentSchema>;

export const DESIGN_CONTENT_JSON_HINT = `{
  "conceptOverview": ["bullet 1", "..."],
  "plantPalette": [{
    "commonName": string,
    "botanicalName": string,
    "matureSize": string,
    "waterNeeds": string,
    "sunExposure": string,
    "whyChosen": string,
    "placement": "feature-id"
  }],
  "materialsAndFinishes": [{
    "featureId": string,
    "featureType": string,
    "label": string,
    "material": string,
    "description": string
  }],
  "renderPrompts": [
    { "id": "entry", "title": string, "prompt": string },
    { "id": "fire_pit", "title": string, "prompt": string },
    { "id": "hero_dusk", "title": string, "prompt": string }
  ]
}`;
