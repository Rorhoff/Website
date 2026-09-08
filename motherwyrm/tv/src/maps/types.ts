/** Map JSON shape — mirrors mapbuilder MapDocument (version 1). */
export type MapData = {
  version: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  grid: number;
  platforms: Array<{
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    skin?: string;
    ground?: boolean;
    pairId?: string;
  }>;
  walls: Array<{
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    pairId?: string;
  }>;
  gemSeams: Array<{ id: string; x: number; y: number; pairId?: string }>;
  hoardSlots: {
    blue: Array<{ id: string; x: number; y: number; index: number }>;
    red: Array<{ id: string; x: number; y: number; index: number }>;
  };
  wyrmPath: {
    left: number;
    right: number;
    y: number;
    finishHeight: number;
  };
  spawns: {
    blue: { main: { x: number; y: number }; backup: { x: number; y: number }[] };
    red: { main: { x: number; y: number }; backup: { x: number; y: number }[] };
  };
  thumbnail?: string;
  excludeFromRandom?: boolean;
  sprites?: Partial<
    Record<
      | "mother_blue_idle"
      | "mother_blue_dive"
      | "mother_blue_claw"
      | "mother_red_idle"
      | "mother_red_dive"
      | "mother_red_claw"
      | "whelp_blue"
      | "whelp_red"
      | "wyrm",
      string
    >
  >;
};

export type LoadedArena = {
  map: MapData;
  platforms: [number, number, number, number][];
  gemSpawns: [number, number][];
  walls: [number, number, number, number][];
  slotsToWin: number;
  wyrmWin: { blue: number; red: number };
  cowGroundY: number;
  cowFinishHeight: number;
  spawns: MapData["spawns"];
  hoardSlots: MapData["hoardSlots"];
};
