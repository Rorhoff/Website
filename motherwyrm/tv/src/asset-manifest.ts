/** Expected atlases and tags — used for loading, fallbacks, and QA screens. */

export type AtlasManifestEntry = {
  /** Phaser texture / aseprite key (underscore). */
  key: string;
  png: string;
  json: string;
  /** Procedural fallback texture key (hyphenated). */
  proceduralKey: string;
  /** Tags after palette-swap export (prefixed with atlas key). */
  expectedTags: string[];
};

export type ImageManifestEntry = {
  key: string;
  png: string;
};

/** Set true once PNG atlases live under /mw/assets/ (see art export pipeline). */
export const REMOTE_ART_ENABLED = true;

/** Pixel-art sprites render at 2×; world coords stay 1280×720. */
export const SPRITE_SCALE = 2;

/** Fallback gem attach point (1× canvas px) when gem_anchor slice is absent. */
export const GEM_ANCHOR_FALLBACK = { x: 14, y: -8 };

export const ATLAS_MANIFEST: AtlasManifestEntry[] = [
  {
    key: "whelp_blue",
    png: "whelp_blue.png",
    json: "whelp_blue.json",
    proceduralKey: "whelp-blue",
    expectedTags: ["idle", "run", "jump", "fall", "punt", "stun", "death"].map(
      (t) => `whelp_blue_${t}`
    ),
  },
  {
    key: "whelp_red",
    png: "whelp_red.png",
    json: "whelp_red.json",
    proceduralKey: "whelp-red",
    expectedTags: ["idle", "run", "jump", "fall", "punt", "stun", "death"].map(
      (t) => `whelp_red_${t}`
    ),
  },
  {
    key: "mother_blue",
    png: "mother_blue.png",
    json: "mother_blue.json",
    proceduralKey: "mother-blue",
    expectedTags: ["idle", "flap", "dive", "claw", "hurt", "death"].map(
      (t) => `mother_blue_${t}`
    ),
  },
  {
    key: "mother_red",
    png: "mother_red.png",
    json: "mother_red.json",
    proceduralKey: "mother-red",
    expectedTags: ["idle", "flap", "dive", "claw", "hurt", "death"].map(
      (t) => `mother_red_${t}`
    ),
  },
  {
    key: "wyrm",
    png: "wyrm.png",
    json: "wyrm.json",
    proceduralKey: "wyrm-seg",
    expectedTags: ["wyrm_crawl"],
  },
  {
    key: "props",
    png: "props.png",
    json: "props.json",
    proceduralKey: "gem",
    expectedTags: [],
  },
];

export const IMAGE_MANIFEST: ImageManifestEntry[] = [
  { key: "background", png: "background.png" },
];

export const WHELP_TAGS = ["idle", "run", "jump", "fall", "punt", "stun", "death"] as const;
export const MOTHER_TAGS = ["idle", "flap", "dive", "claw", "hurt", "death"] as const;
