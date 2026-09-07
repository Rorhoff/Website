import { describe, expect, it } from "vitest";
import { assertArenaSymmetry, GEM_SPAWNS, HOARD_SHELF_Y, PLATFORMS, TUNING, W } from "./arena-layout";

/** Max vertical rise from a standing jump (px), with a small safety margin. */
function maxJumpRise() {
  const v = Math.abs(TUNING.whelpJump);
  const g = TUNING.gravity;
  return (v * v) / (2 * g) - 8;
}

/**
 * Can a whelp on platform A reach platform B with one standing jump?
 * Uses platform tops as stand/feet positions (matches sim standingY).
 */
function canJumpBetween(fromTop: number, toTop: number) {
  return fromTop - toTop <= maxJumpRise();
}

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

describe("ledge reachability", () => {
  const tops = [...new Set(PLATFORMS.map(([, y]) => y))].sort((a, b) => b - a);

  it("every ledge is reachable from ground or a lower rung via one hop per rise", () => {
    const ground = PLATFORMS[0][1];
    const reachable = new Set<number>([ground]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const top of tops) {
        if (reachable.has(top)) continue;
        const from = tops.filter((t) => t > top && reachable.has(t));
        if (from.some((t) => canJumpBetween(t, top))) {
          reachable.add(top);
          grew = true;
        }
      }
    }
    const missed = tops.filter((t) => !reachable.has(t));
    expect(missed, `unreachable ledges at y=${missed.join(", ")}`).toEqual([]);
  });

  it("outer ladder rungs are linked through ~100px hops (not straight from the floor)", () => {
    expect(canJumpBetween(HOARD_SHELF_Y, 490)).toBe(true);
    expect(canJumpBetween(490, 400)).toBe(true);
    expect(canJumpBetween(400, 310)).toBe(true);
    expect(canJumpBetween(310, 225)).toBe(true);
  });

  it("centre stack rungs are linked the same way", () => {
    expect(canJumpBetween(570, 450)).toBe(true);
    expect(canJumpBetween(450, 330)).toBe(true);
  });
});
