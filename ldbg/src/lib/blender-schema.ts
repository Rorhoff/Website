import { z } from "zod";

export const BLENDER_CAMERA_PRESETS = [
  "front_elevation",
  "rear_hero",
  "oblique_45",
  "back_door_eye",
] as const;

export type BlenderCameraPreset = (typeof BLENDER_CAMERA_PRESETS)[number];

export const BlenderCameraPresetSchema = z.enum(BLENDER_CAMERA_PRESETS);

export const BlenderSunSettingsSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  hour: z.number().min(0).max(24).default(18),
  dayOfYear: z.number().int().min(1).max(366).default(172),
  energy: z.number().positive().optional(),
});

export const BlenderRenderSettingsSchema = z.object({
  resolution: z.tuple([z.number().int().positive(), z.number().int().positive()]).default([1920, 1080]),
  samples: z.number().int().positive().default(48),
  engine: z.enum(["BLENDER_EEVEE_NEXT", "CYCLES"]).default("BLENDER_EEVEE_NEXT"),
  sun: BlenderSunSettingsSchema.optional(),
});

export const BlenderRenderEntrySchema = z.object({
  filename: z.string(),
  preset: BlenderCameraPresetSchema,
  renderedAt: z.string(),
  slot: z.string().optional(),
});

export const BlenderRendersSchema = z.record(z.string(), BlenderRenderEntrySchema);

export type BlenderRenderSettings = z.infer<typeof BlenderRenderSettingsSchema>;
export type BlenderRenderEntry = z.infer<typeof BlenderRenderEntrySchema>;
export type BlenderRenders = z.infer<typeof BlenderRendersSchema>;

export function blenderFilenameForSlot(slot: string): string {
  return `render-blender-${slot}.png`;
}

/** Default camera preset per board render slot. */
export const SLOT_BLENDER_PRESET: Record<
  "hero" | "entry" | "fire_pit" | "hero_dusk",
  BlenderCameraPreset
> = {
  hero: "oblique_45",
  entry: "front_elevation",
  fire_pit: "back_door_eye",
  hero_dusk: "rear_hero",
};

export const PRESET_LABELS: Record<BlenderCameraPreset, string> = {
  front_elevation: "Front elevation",
  rear_hero: "Rear yard hero",
  oblique_45: "Oblique 45° overhead",
  back_door_eye: "Eye-level from back door",
};
