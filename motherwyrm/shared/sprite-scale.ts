/**
 * Shared sprite sizing for the TV game (frame × scale) and map builder preview
 * (flat pixel heights). Gameplay hitboxes may differ from drawn sprite size.
 */

export const MOTHER_FRAME_H = 128;
export const WHELP_FRAME_H = 110;
/** Cow atlas sourceSize height (feet box), not trimmed frame height. */
export const COW_FRAME_H = 44;

export const MOTHER_SPRITE_SCALE = 2;
export const WHELP_SPRITE_SCALE = 1;
export const COW_SPRITE_SCALE = 2.5;

/** Map builder preview — flat drawn heights in world pixels (feet on y). */
export const PREVIEW_WHELP_DISPLAY_H = 44;
export const PREVIEW_MOTHER_ABOVE_WHELP = 50;
export const PREVIEW_MOTHER_DISPLAY_H = PREVIEW_WHELP_DISPLAY_H + PREVIEW_MOTHER_ABOVE_WHELP;
export const PREVIEW_COW_DISPLAY_H = 44;

export type ActorRole = "mother" | "whelp" | "cow";

/** TV game — drawn sprite height on the 1280×720 arena (feet anchored at y). */
export function displayHeightForRole(role: ActorRole): number {
  switch (role) {
    case "mother":
      return MOTHER_FRAME_H * MOTHER_SPRITE_SCALE;
    case "whelp":
      return WHELP_FRAME_H * WHELP_SPRITE_SCALE;
    case "cow":
      return COW_FRAME_H * COW_SPRITE_SCALE;
  }
}

export function roleFromSpriteSlot(slot: string): ActorRole | null {
  if (slot.startsWith("mother_")) return "mother";
  if (slot.startsWith("whelp_")) return "whelp";
  if (slot === "wyrm") return "cow";
  return null;
}

export function displayHeightForSpriteSlot(slot: string): number {
  const role = roleFromSpriteSlot(slot);
  if (!role) return WHELP_FRAME_H * WHELP_SPRITE_SCALE;
  return displayHeightForRole(role);
}

/** Map builder preview — fixed heights, not frame × scale. */
export function previewDisplayHeightForRole(role: ActorRole): number {
  switch (role) {
    case "mother":
      return PREVIEW_MOTHER_DISPLAY_H;
    case "whelp":
      return PREVIEW_WHELP_DISPLAY_H;
    case "cow":
      return PREVIEW_COW_DISPLAY_H;
  }
}

export function previewDisplayHeightForSpriteSlot(slot: string): number {
  const role = roleFromSpriteSlot(slot);
  if (!role) return PREVIEW_WHELP_DISPLAY_H;
  return previewDisplayHeightForRole(role);
}

/** 1× source height used for scale math (may differ from trimmed PNG crop). */
export function sourceHeightForSpriteSlot(slot: string, trimmedFrameH: number): number {
  const role = roleFromSpriteSlot(slot);
  if (role === "mother") return MOTHER_FRAME_H;
  if (role === "whelp") return WHELP_FRAME_H;
  if (role === "cow") return COW_FRAME_H;
  return trimmedFrameH;
}
