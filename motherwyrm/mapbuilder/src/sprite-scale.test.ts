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
    expect(previewDisplayHeightForSpriteSlot("wyrm")).toBe(38);
  });

  it("TV game uses the same flat pixel heights as map builder preview", () => {
    expect(displayHeightForRole("mother")).toBe(94);
    expect(displayHeightForRole("whelp")).toBe(44);
    expect(displayHeightForRole("cow")).toBe(38);
  });
});
