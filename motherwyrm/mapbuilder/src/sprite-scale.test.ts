import { describe, expect, it } from "vitest";
import { displayHeightForRole, displayHeightForSpriteSlot } from "../../shared/sprite-scale";

describe("sprite-scale", () => {
  it("matches TV game display heights", () => {
    expect(displayHeightForRole("mother")).toBe(256);
    expect(displayHeightForRole("whelp")).toBe(110);
    expect(displayHeightForRole("cow")).toBe(110);
  });

  it("maps map-builder slots to roles", () => {
    expect(displayHeightForSpriteSlot("mother_blue_idle")).toBe(256);
    expect(displayHeightForSpriteSlot("whelp_red")).toBe(110);
    expect(displayHeightForSpriteSlot("wyrm")).toBe(110);
  });
});
