import { describe, expect, it } from "vitest";
import { jumpArcPoints, jumpReachable, maxJumpRise, sourceFeetY } from "./jump-arc";

describe("jump arc", () => {
  it("reports whelp peak rise around 137px", () => {
    expect(maxJumpRise()).toBeGreaterThan(125);
    expect(maxJumpRise()).toBeLessThan(140);
  });

  it("curves from the arena-center side of a platform", () => {
    const groundFeetY = 690 - 24;
    const plat = { x: 900, y: 500, w: 96, h: 16 };
    const pts = jumpArcPoints(plat, [plat], groundFeetY);
    expect(pts.length).toBeGreaterThan(10);
    expect(pts[0]!.x).toBeLessThan(plat.x);
  });

  it("marks low platforms reachable and high ones not", () => {
    const groundFeetY = 690 - 24;
    const ground = { x: 0, y: 690, w: 1280, h: 16 };
    const low = { x: 400, y: 580, w: 96, h: 16 };
    const high = { x: 400, y: 420, w: 96, h: 16 };
    expect(jumpReachable(low, [ground, low], groundFeetY)).toBe(true);
    expect(jumpReachable(high, [ground, high], groundFeetY)).toBe(false);
  });

  it("finds stand height below a target lip", () => {
    const groundFeetY = 690 - 24;
    const ground = { x: 0, y: 690, w: 1280, h: 16 };
    expect(sourceFeetY(400, 580, [ground], groundFeetY)).toBe(690 - 24);
  });
});
