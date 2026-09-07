/** JSON map document produced by the map builder. Decoupled from game source files. */
export type PlatformPalette = {
  base: string;
  shadow: string;
  highlight: string;
  trim: string;
};

export type MapPlatform = {
  id: string;
  x: number;
  /** Top edge of the platform body (matches arena-layout PLATFORMS tuples). */
  y: number;
  w: number;
  h: number;
  /** Named preset from SKIN_PRESETS, or omit to use palette inline. */
  skin?: string;
  /** Per-platform palette override — exported when skin is custom. */
  palette?: PlatformPalette;
  /** Links mirrored halves when symmetry is enforced. */
  pairId?: string;
  /** Full-width ground row — only one per map, not mirrored. */
  ground?: boolean;
};

export type MapGemSeam = {
  id: string;
  x: number;
  y: number;
  pairId?: string;
};

export type MapHoardAnchor = {
  /** Top-left of the slot grid (HOARD_X / HOARD_Y in the game). */
  x: number;
  y: number;
};

export type MapWyrmPath = {
  /** Blue finish line x. */
  left: number;
  /** Red finish line x. */
  right: number;
  /** Cow ground y (feet line). */
  y: number;
};

export type MapSpawns = {
  blue: { x: number; y: number };
  red: { x: number; y: number };
};

export type MapDocument = {
  version: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  grid: number;
  platforms: MapPlatform[];
  gemSeams: MapGemSeam[];
  hoardSlots: {
    blue: MapHoardAnchor[];
    red: MapHoardAnchor[];
  };
  wyrmPath: MapWyrmPath;
  spawns?: MapSpawns;
};

export type EditorTool = "select" | "platform" | "gem" | "hoard" | "wyrm";

export type Selection =
  | { kind: "platform"; id: string }
  | { kind: "gem"; id: string }
  | { kind: "hoard"; team: "blue" | "red" }
  | { kind: "wyrm" }
  | null;

export type ValidationIssue = {
  level: "error" | "warn";
  message: string;
};
