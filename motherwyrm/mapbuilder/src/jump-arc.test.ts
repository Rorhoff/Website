import { describe, expect, it } from "vitest";
import { jumpArcPoints, maxJumpRise } from "./jump-arc";

describe("jump arc", () => {
  it("reports whelp peak rise around 137px", () => {
    expect(maxJumpRise()).toBeGreaterThan(125);
    expect(maxJumpRise()).toBeLessThan(140);
  });

  it("curves horizontally from a platform lip", () => {
    const plat = { x: 400, y: 500, w: 96, h: 16 };
    const pts = jumpArcPoints(plat, [plat]);
    expect(pts.length).toBeGreaterThan(10);
    const end = pts[pts.length - 1]!;
    expect(end.x).not.toBe(pts[0]!.x);
  });
});
