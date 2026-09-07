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
  skin?: string;
  palette?: PlatformPalette;
  pairId?: string;
  ground?: boolean;
};

export type MapGemSeam = {
  id: string;
  x: number;
  y: number;
  pairId?: string;
};

export type MapHoardSlot = {
  id: string;
  x: number;
  y: number;
  /** Slot index 0–14 (matches game hoard grid). */
  index: number;
  pairId?: string;
};

export type MapWyrmPath = {
  /** Blue finish line x. */
  left: number;
  /** Red finish line x. */
  right: number;
  /** Cow ground y — bottom of finish lines. */
  y: number;
  /** Finish line height above ground y. */
  finishHeight: number;
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
    blue: MapHoardSlot[];
    red: MapHoardSlot[];
  };
  wyrmPath: MapWyrmPath;
  spawns?: MapSpawns;
};

export type EditorTool = "select" | "platform" | "gem" | "hoard" | "wyrm";

export type EditorState = {
  doc: MapDocument;
  mirrorLock: boolean;
  tool: EditorTool;
  selection: Selection;
  grid: number;
  dirty: boolean;
};

export type Selection =
  | { kind: "platform"; id: string }
  | { kind: "gem"; id: string }
  | { kind: "hoardSlot"; id: string }
  | { kind: "wyrmCow" }
  | { kind: "wyrmFinish" }
  | null;

export type ValidationIssue = {
  level: "error" | "warn";
  message: string;
};
