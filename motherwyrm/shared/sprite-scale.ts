/**
 * Shared sprite sizing for the TV game and map builder preview.
 * Both use the same flat pixel draw heights; gameplay hitboxes may differ.
 */

export const MOTHER_FRAME_H = 128;
export const WHELP_FRAME_H = 110;
/** Cow atlas sourceSize height (feet box), not trimmed frame height. */
export const COW_FRAME_H = 44;

/** Target drawn height on the 1280×720 arena (world pixels, feet on y). */
export const WHELP_DISPLAY_H = 49;
export const MOTHER_ABOVE_WHELP = 50;
export const MOTHER_DISPLAY_H = WHELP_DISPLAY_H + MOTHER_ABOVE_WHELP;
export const COW_DISPLAY_H = 38;

/** Map builder aliases — same heights as the TV game. */
export const PREVIEW_WHELP_DISPLAY_H = WHELP_DISPLAY_H;
export const PREVIEW_MOTHER_ABOVE_WHELP = MOTHER_ABOVE_WHELP;
export const PREVIEW_MOTHER_DISPLAY_H = MOTHER_DISPLAY_H;
export const PREVIEW_COW_DISPLAY_H = COW_DISPLAY_H;

/** Phaser/canvas scale = target height ÷ 1× source frame height. */
export const MOTHER_SPRITE_SCALE = MOTHER_DISPLAY_H / MOTHER_FRAME_H;
export const WHELP_SPRITE_SCALE = WHELP_DISPLAY_H / WHELP_FRAME_H;
export const COW_SPRITE_SCALE = COW_DISPLAY_H / COW_FRAME_H;

export type ActorRole = "mother" | "whelp" | "cow";

export function frameHeightForRole(role: ActorRole): number {
  switch (role) {
    case "mother":
      return MOTHER_FRAME_H;
    case "whelp":
      return WHELP_FRAME_H;
    case "cow":
      return COW_FRAME_H;
  }
}

export function displayHeightForRole(role: ActorRole): number {
  switch (role) {
    case "mother":
      return MOTHER_DISPLAY_H;
    case "whelp":
      return WHELP_DISPLAY_H;
    case "cow":
      return COW_DISPLAY_H;
  }
}

export function renderScaleForRole(role: ActorRole): number {
  return displayHeightForRole(role) / frameHeightForRole(role);
}

export function roleFromSpriteSlot(slot: string): ActorRole | null {
  if (slot.startsWith("mother_")) return "mother";
  if (slot.startsWith("whelp_")) return "whelp";
  if (slot === "wyrm") return "cow";
  return null;
}

export function displayHeightForSpriteSlot(slot: string): number {
  const role = roleFromSpriteSlot(slot);
  if (!role) return WHELP_DISPLAY_H;
  return displayHeightForRole(role);
}

/** Map builder — same flat heights as the TV game. */
export function previewDisplayHeightForRole(role: ActorRole): number {
  return displayHeightForRole(role);
}

export function previewDisplayHeightForSpriteSlot(slot: string): number {
  return displayHeightForSpriteSlot(slot);
}

/** 1× source height used for scale math (may differ from trimmed PNG crop). */
export function sourceHeightForSpriteSlot(slot: string, trimmedFrameH: number): number {
  const role = roleFromSpriteSlot(slot);
  if (role === "mother") return MOTHER_FRAME_H;
  if (role === "whelp") return WHELP_FRAME_H;
  if (role === "cow") return COW_FRAME_H;
  return trimmedFrameH;
}
