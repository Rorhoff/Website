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

export type MapWall = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  pairId?: string;
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
  /** Slot index 0–15 (matches game hoard grid). */
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

export type SpawnPoint = { x: number; y: number };

export type TeamSpawns = {
  main: SpawnPoint;
  backup: SpawnPoint[];
};

export type MapSpawns = {
  blue: TeamSpawns;
  red: TeamSpawns;
};

/** Custom PNG art per character slot (API URL or blob preview while editing). */
export type MapSpriteSlot =
  | "mother_blue_idle"
  | "mother_blue_dive"
  | "mother_blue_claw"
  | "mother_red_idle"
  | "mother_red_dive"
  | "mother_red_claw"
  | "whelp_blue"
  | "whelp_red"
  | "wyrm";

export type MapSprites = Partial<Record<MapSpriteSlot, string>>;

export type MapDocument = {
  version: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  grid: number;
  platforms: MapPlatform[];
  walls: MapWall[];
  gemSeams: MapGemSeam[];
  hoardSlots: {
    blue: MapHoardSlot[];
    red: MapHoardSlot[];
  };
  wyrmPath: MapWyrmPath;
  spawns: MapSpawns;
  /** Custom character PNGs — keys are MapSpriteSlot, values are URLs. */
  sprites?: MapSprites;
  /** Optional lobby thumbnail URL/path. */
  thumbnail?: string;
  /** When true, omitted from random map rotation. */
  excludeFromRandom?: boolean;
};

export type EditorTool = "select" | "platform" | "wall" | "gem" | "hoard" | "wyrm" | "spawn";

export type SelectKind = "platform" | "gem" | "hoardSlot" | "wall";

export type Selection =
  | {
      kind: "multi";
      platforms: string[];
      gems: string[];
      hoardSlots: string[];
      walls: string[];
    }
  | { kind: SelectKind; ids: string[] }
  | { kind: "spawn"; team: "blue" | "red"; role: "main" | "backup"; index: number }
  | { kind: "wyrmCow" }
  | { kind: "wyrmFinish" }
  | null;

export type EditorState = {
  doc: MapDocument;
  mirrorLock: boolean;
  /** When true, new/moved gems fall to the nearest platform below. */
  gemGravity: boolean;
  /** Local blob URLs for sprite previews before upload completes. */
  spritePreviews: MapSprites;
  /** PNG files waiting to upload on save (map id required). */
  pendingSprites: Partial<Record<MapSpriteSlot, File>>;
  tool: EditorTool;
  selection: Selection;
  grid: number;
  dirty: boolean;
};

export type ValidationIssue = {
  level: "error" | "warn";
  message: string;
};

export function selectionIds(sel: Selection, kind?: SelectKind): string[] {
  if (!sel) return [];
  if (sel.kind === "multi") {
    if (kind === "platform") return sel.platforms;
    if (kind === "gem") return sel.gems;
    if (kind === "hoardSlot") return sel.hoardSlots;
    if (kind === "wall") return sel.walls;
    return [...sel.platforms, ...sel.gems, ...sel.hoardSlots, ...sel.walls];
  }
  if (sel.kind === "wyrmCow" || sel.kind === "wyrmFinish" || sel.kind === "spawn") return [];
  return kind && sel.kind !== kind ? [] : sel.ids;
}

export function singleSelectionId(sel: Selection): string | undefined {
  if (!sel || sel.kind === "multi" || sel.kind === "wyrmCow" || sel.kind === "wyrmFinish" || sel.kind === "spawn") {
    return undefined;
  }
  return sel.ids.length === 1 ? sel.ids[0] : undefined;
}

export function emptyMultiSelection(): Extract<Selection, { kind: "multi" }> {
  return { kind: "multi", platforms: [], gems: [], hoardSlots: [], walls: [] };
}
