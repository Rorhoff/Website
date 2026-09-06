import Phaser from "phaser";
import {
  ATLAS_MANIFEST,
  GEM_ANCHOR_FALLBACK,
  IMAGE_MANIFEST,
  REMOTE_ART_ENABLED,
  SPRITE_SCALE,
  type AtlasManifestEntry,
} from "./asset-manifest";
import { buildProceduralTexture } from "./arena";
import type { Role, Team } from "./net";

export type AssetLoadState = "loaded" | "procedural" | "pending";

export type AtlasStatus = {
  key: string;
  state: AssetLoadState;
  expectedTags: string[];
  foundTags: string[];
  missingTags: string[];
};

const atlasStatus = new Map<string, AtlasStatus>();
const gemAnchors = new Map<string, { x: number; y: number }>();
const failedKeys = new Set<string>();

export function getAtlasStatuses(): AtlasStatus[] {
  return ATLAS_MANIFEST.map((entry) => {
    const s = atlasStatus.get(entry.key);
    return (
      s ?? {
        key: entry.key,
        state: "pending" as const,
        expectedTags: entry.expectedTags,
        foundTags: [],
        missingTags: entry.expectedTags,
      }
    );
  });
}

export function isAtlasLoaded(key: string): boolean {
  return atlasStatus.get(key)?.state === "loaded";
}

export function queueAssetLoads(load: Phaser.Loader.LoaderPlugin) {
  if (!REMOTE_ART_ENABLED) return;

  for (const entry of ATLAS_MANIFEST) {
    load.aseprite(
      entry.key,
      `assets/${entry.png}`,
      `assets/${entry.json}`
    );
  }
  for (const img of IMAGE_MANIFEST) {
    load.image(img.key, `assets/${img.png}`);
  }

  load.on("loaderror", (file: Phaser.Loader.File) => {
    failedKeys.add(file.key);
  });
}

export function finalizeAssets(scene: Phaser.Scene) {
  for (const entry of ATLAS_MANIFEST) {
    if (failedKeys.has(entry.key) || !scene.textures.exists(entry.key)) {
      buildProceduralTexture(scene, entry.proceduralKey);
      atlasStatus.set(entry.key, {
        key: entry.key,
        state: "procedural",
        expectedTags: entry.expectedTags,
        foundTags: [],
        missingTags: entry.expectedTags,
      });
      continue;
    }

    scene.anims.createFromAseprite(entry.key);
    const foundTags = collectTags(scene, entry);
    const missingTags = entry.expectedTags.filter((t) => !foundTags.includes(t));
    atlasStatus.set(entry.key, {
      key: entry.key,
      state: "loaded",
      expectedTags: entry.expectedTags,
      foundTags,
      missingTags,
    });
    readGemAnchor(scene, entry);
  }

  for (const img of IMAGE_MANIFEST) {
    if (failedKeys.has(img.key) || !scene.textures.exists(img.key)) {
      atlasStatus.set(img.key, {
        key: img.key,
        state: "procedural",
        expectedTags: [],
        foundTags: [],
        missingTags: [],
      });
    } else {
      atlasStatus.set(img.key, {
        key: img.key,
        state: "loaded",
        expectedTags: [],
        foundTags: [],
        missingTags: [],
      });
    }
  }

  if (!scene.textures.exists("gem")) {
    buildProceduralTexture(scene, "gem");
  }
}

function collectTags(scene: Phaser.Scene, entry: AtlasManifestEntry): string[] {
  return entry.expectedTags.filter((tag) => scene.anims.exists(tag));
}

function readGemAnchor(scene: Phaser.Scene, entry: AtlasManifestEntry) {
  if (!entry.key.startsWith("whelp_")) return;
  const texture = scene.textures.get(entry.key);
  const data = texture.customData as { slices?: Record<string, { center?: { x: number; y: number } }> };
  const slice = data?.slices?.gem_anchor?.center;
  if (slice) {
    gemAnchors.set(entry.key, { x: slice.x, y: slice.y });
  }
}

export function getGemAnchor(atlasKey: string): { x: number; y: number } {
  return gemAnchors.get(atlasKey) ?? GEM_ANCHOR_FALLBACK;
}

export function actorAtlasKey(role: Role, team: Team): string {
  return `${role === "mother" ? "mother" : "whelp"}_${team}`;
}

/** Texture key for spawning an actor sprite. */
export function actorTextureKey(role: Role, team: Team): string {
  const atlas = actorAtlasKey(role, team);
  if (isAtlasLoaded(atlas)) return atlas;
  return `${role === "mother" ? "mother" : "whelp"}-${team}`;
}

export function wyrmTextureKey(): string {
  return isAtlasLoaded("wyrm") ? "wyrm" : "wyrm-seg";
}

export function gemTextureKey(): string {
  return isAtlasLoaded("props") ? "props" : "gem";
}

export function applySpriteScale(sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image) {
  sprite.setScale(SPRITE_SCALE);
}

export function tryPlayAnim(
  sprite: Phaser.GameObjects.Sprite,
  atlasKey: string,
  tagSuffix: string,
  ignoreIfPlaying = true
) {
  if (!isAtlasLoaded(atlasKey)) return;
  const animKey = `${atlasKey}_${tagSuffix}`;
  // createFromAseprite registers tags on the scene's animation manager.
  // sprite.anims.exists only reports animations created on that one sprite, so
  // it answered false for every tag and no animation ever played — every actor
  // sat on frame 0 for the whole match.
  if (!sprite.scene.anims.exists(animKey)) return;
  if (ignoreIfPlaying && sprite.anims.currentAnim?.key === animKey) return;
  sprite.play(animKey, true);
}

export function mountBackground(scene: Phaser.Scene): Phaser.GameObjects.Image | null {
  if (!scene.textures.exists("background")) return null;
  const bg = scene.add
    .image(0, 0, "background")
    .setOrigin(0, 0)
    .setScale(SPRITE_SCALE)
    .setDepth(-100);
  return bg;
}
