import type { RenderProviderId } from "@/config/features";

export type RenderSlotKey = "hero" | "entry" | "fire_pit" | "hero_dusk";

export const RENDER_SLOT_KEYS: RenderSlotKey[] = [
  "hero",
  "entry",
  "fire_pit",
  "hero_dusk",
];

/** Maps board slot → design-content renderPrompt id (hero uses hero_dusk prompt). */
export const SLOT_TO_PROMPT_ID: Record<
  RenderSlotKey,
  "entry" | "fire_pit" | "hero_dusk"
> = {
  hero: "hero_dusk",
  entry: "entry",
  fire_pit: "fire_pit",
  hero_dusk: "hero_dusk",
};

export const SLOT_LABELS: Record<RenderSlotKey, string> = {
  hero: "Hero perspective (right rail)",
  entry: "Entry / pathway (supporting)",
  fire_pit: "Fire pit & pergola (supporting)",
  hero_dusk: "Hero dusk (supporting)",
};

export function renderFilenameForSlot(slot: RenderSlotKey, ext = "png"): string {
  return `render-${slot}.${ext}`;
}

export function isRenderSlotKey(value: string): value is RenderSlotKey {
  return (RENDER_SLOT_KEYS as string[]).includes(value);
}

export type RenderSlotMeta = {
  slot: RenderSlotKey;
  filename?: string;
  source?: "generated" | "upload";
  generatedAt?: string;
  provider?: RenderProviderId;
};
