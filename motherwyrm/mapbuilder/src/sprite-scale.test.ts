import { describe, expect, it } from "vitest";
import {
  PREVIEW_MOTHER_DISPLAY_H,
  PREVIEW_WHELP_DISPLAY_H,
  displayHeightForRole,
  previewDisplayHeightForRole,
  previewDisplayHeightForSpriteSlot,
} from "../../shared/sprite-scale";

describe("sprite-scale", () => {
  it("map builder preview uses flat pixel heights", () => {
    expect(PREVIEW_WHELP_DISPLAY_H).toBe(44);
    expect(PREVIEW_MOTHER_DISPLAY_H).toBe(94);
    expect(previewDisplayHeightForRole("whelp")).toBe(44);
    expect(previewDisplayHeightForRole("mother")).toBe(94);
    expect(previewDisplayHeightForSpriteSlot("mother_blue_idle")).toBe(94);
    expect(previewDisplayHeightForSpriteSlot("whelp_red")).toBe(44);
    expect(previewDisplayHeightForSpriteSlot("wyrm")).toBe(44);
  });

  it("TV game still uses frame × scale heights", () => {
    expect(displayHeightForRole("mother")).toBe(256);
    expect(displayHeightForRole("whelp")).toBe(110);
    expect(displayHeightForRole("cow")).toBe(110);
  });
});
