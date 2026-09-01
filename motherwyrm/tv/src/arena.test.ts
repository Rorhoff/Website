import { describe, expect, it } from "vitest";
import { assertArenaSymmetry, GEM_SPAWNS, PLATFORMS, W } from "./arena-layout";

describe("arena symmetry", () => {
  it("mirrors platforms, gem spawns, hoards, and team spawns", () => {
    const { ok, errors } = assertArenaSymmetry();
    expect(errors, errors.join("\n")).toEqual([]);
    expect(ok).toBe(true);
  });

  it("generates 30 mirrored gem clusters", () => {
    expect(GEM_SPAWNS.length).toBe(30);
    const left = GEM_SPAWNS.filter(([x]) => x < W / 2);
    expect(left.length).toBe(15);
    for (const [x, y] of left) {
      expect(GEM_SPAWNS.some(([gx, gy]) => gx === W - x && gy === y)).toBe(true);
    }
  });

  it("mirrors side platforms across center", () => {
    const side = PLATFORMS.filter(([x, , w]) => x + w / 2 !== W / 2).slice(1);
    for (const [x, y, w, h] of side) {
      if (x + w / 2 < W / 2) {
        const mirrorX = W - x - w;
        expect(PLATFORMS.some(([ox, oy, ow, oh]) => ox === mirrorX && oy === y && ow === w && oh === h)).toBe(
          true
        );
      }
    }
  });
});
