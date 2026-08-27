/** Style pass presets for plan rendering (Stage 4). */

export type StylePresetId =
  | "off"
  | "watercolor-plan"
  | "ink-only"
  | "marker"
  | "photoreal";

export const STYLE_CONSTRAINT_BLOCK = `Preserve the exact aerial camera angle, roof footprint, paths, garden boundaries, terrain, and overall composition. Keep the scene unpopulated. Do not add buildings, structures, water features, or landscape elements not present in the base image. Do not add text, labels, watermarks, numbers, or annotations of any kind.`;

export type StylePreset = {
  id: StylePresetId;
  label: string;
  prompt: string;
  /** Optional reference images under /public/styles/{filename} */
  referenceImages?: string[];
};

export const STYLE_PRESETS: Record<StylePresetId, StylePreset> = {
  off: {
    id: "off",
    label: "No style pass (composite only)",
    prompt: "",
  },
  "watercolor-plan": {
    id: "watercolor-plan",
    label: "Watercolor plan",
    prompt:
      "Hand-drawn architectural landscape plan, ink linework with watercolor wash, " +
      "drawn tree symbols, outlined stone, white paper ground.",
    referenceImages: ["watercolor-plan-ref.jpg"],
  },
  "ink-only": {
    id: "ink-only",
    label: "Ink only",
    prompt: "Pen and ink line drawing, no color wash, hatching for materials.",
    referenceImages: ["ink-only-ref.jpg"],
  },
  marker: {
    id: "marker",
    label: "Marker rendering",
    prompt:
      "Architectural marker rendering, bold flat color, visible stroke edges.",
    referenceImages: ["marker-ref.jpg"],
  },
  photoreal: {
    id: "photoreal",
    label: "Photoreal aerial",
    prompt:
      "Photorealistic aerial, diffuse neutral daylight, gentle shadows, legible material textures.",
  },
};

export const STYLE_PRESET_IDS = Object.keys(STYLE_PRESETS) as StylePresetId[];

export function presetUsesStylePass(preset: StylePresetId): boolean {
  return preset !== "off";
}

export function buildStylePassPrompt(preset: StylePresetId): string | null {
  const p = STYLE_PRESETS[preset];
  if (!p.prompt) return null;
  return `${p.prompt}\n\n${STYLE_CONSTRAINT_BLOCK}`;
}

export function stylePresetReferencePaths(preset: StylePresetId): string[] {
  const refs = STYLE_PRESETS[preset].referenceImages ?? [];
  return refs.map((f) => `/styles/${f}`);
}
