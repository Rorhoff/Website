/**
 * tryPlayAnim has to consult the scene's animation manager. Aseprite tags land
 * there via registerAsepriteAnims; sprite.anims.exists only ever reports
 * animations created on that single sprite, and guarding on it silently
 * swallowed every play call, freezing every actor on frame 0.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("phaser", () => ({ default: {} }));
vi.mock("./arena", () => ({ buildProceduralTexture: () => {} }));

import { MOTHER_TAGS } from "./asset-manifest";
import { finalizeAssets, isAtlasLoaded, tryPlayAnim } from "./assets";

/** Tags the real export produces for the mothers, as registered on the scene. */
const SCENE_TAGS = MOTHER_TAGS.map((t) => `mother_blue_${t}`);

function fakeScene(tags: string[], texturesExist = true) {
  return {
    textures: {
      exists: () => texturesExist,
      get: () => ({ customData: {} }),
    },
    cache: {
      json: { get: () => undefined },
    },
    anims: {
      exists: (k: string) => tags.includes(k),
      remove: vi.fn(),
      create: vi.fn(),
    },
  };
}

function fakeSprite(scene: ReturnType<typeof fakeScene>, playing?: string) {
  return {
    scene,
    // Mirrors Phaser: a local-only lookup that knows nothing about scene tags.
    anims: {
      exists: () => false,
      currentAnim: playing ? { key: playing } : null,
    },
    play: vi.fn(),
  };
}

describe("tryPlayAnim", () => {
  let scene: ReturnType<typeof fakeScene>;

  beforeEach(() => {
    scene = fakeScene(SCENE_TAGS);
    finalizeAssets(scene as never);
  });

  it("treats the atlas as loaded once its tags are registered", () => {
    expect(isAtlasLoaded("mother_blue")).toBe(true);
  });

  it("plays a tag registered on the scene rather than on the sprite", () => {
    const s = fakeSprite(scene);
    tryPlayAnim(s as never, "mother_blue", "dive");
    expect(s.play).toHaveBeenCalledWith("mother_blue_dive", true);
  });

  it("plays every tag the mother actually uses", () => {
    for (const tag of MOTHER_TAGS) {
      const s = fakeSprite(scene);
      tryPlayAnim(s as never, "mother_blue", tag);
      expect(s.play, `tag ${tag}`).toHaveBeenCalledWith(`mother_blue_${tag}`, true);
    }
  });

  it("skips a tag the scene does not have", () => {
    const s = fakeSprite(scene);
    tryPlayAnim(s as never, "mother_blue", "somersault");
    expect(s.play).not.toHaveBeenCalled();
  });

  it("does not restart the animation already playing", () => {
    const s = fakeSprite(scene, "mother_blue_dive");
    tryPlayAnim(s as never, "mother_blue", "dive");
    expect(s.play).not.toHaveBeenCalled();
  });

  it("restarts when told to ignore the playing state", () => {
    const s = fakeSprite(scene, "mother_blue_dive");
    tryPlayAnim(s as never, "mother_blue", "dive", false);
    expect(s.play).toHaveBeenCalledWith("mother_blue_dive", true);
  });

  it("does nothing when the atlas fell back to procedural art", () => {
    const bare = fakeScene([], false);
    finalizeAssets(bare as never);
    expect(isAtlasLoaded("mother_blue")).toBe(false);
    const s = fakeSprite(bare);
    tryPlayAnim(s as never, "mother_blue", "dive");
    expect(s.play).not.toHaveBeenCalled();
  });
});
