import { describe, expect, it } from "vitest";
import { PALETTE_MARKERS, applyPaletteSwap } from "./palette";
import { defaultArenaMap } from "./default-map";
import { mirrorPlatformX, mirrorPointX, snapGem, validateMap, wrapPlatformHorizontal } from "./schema";
import { W } from "./constants";

describe("map symmetry validation", () => {
  it("default arena map passes mirror-lock validation", () => {
    const doc = defaultArenaMap();
    const issues = validateMap(doc, true);
    const errors = issues.filter((i) => i.level === "error");
    expect(errors, errors.map((e) => e.message).join("\n")).toEqual([]);
  });

  it("mirrorPlatformX reflects across center", () => {
    expect(mirrorPlatformX(200, 150)).toBe(W - 200 - 150);
  });

  it("mirrorPointX reflects gem coordinates", () => {
    expect(mirrorPointX(180)).toBe(W - 180);
  });

  it("snapGem aligns to editor grid intersections", () => {
    expect(snapGem(165.4, 8)).toBe(168);
    expect(snapGem(203.6, 8)).toBe(200);
  });

  it("wrapPlatformHorizontal moves past-right platforms to the left seam", () => {
    expect(wrapPlatformHorizontal(1272, 96)).toBe(-8);
  });

  it("wrapPlatformHorizontal keeps left-straddling platforms", () => {
    expect(wrapPlatformHorizontal(-88, 96)).toBe(-88);
  });
});

describe("palette swap", () => {
  it("replaces marker colors in image data", () => {
    const data = {
      data: new Uint8ClampedArray([255, 0, 110, 255, 0, 0, 0, 255]),
    } as ImageData;
    applyPaletteSwap(data, {
      base: "#112233",
      shadow: "#000000",
      highlight: "#ffffff",
      trim: "#aabbcc",
    });
    expect(data.data[0]).toBe(0x11);
    expect(data.data[1]).toBe(0x22);
    expect(data.data[2]).toBe(0x33);
  });

  it("documents marker colors for artists", () => {
    expect(PALETTE_MARKERS.base).toBe("#ff006e");
  });
});
