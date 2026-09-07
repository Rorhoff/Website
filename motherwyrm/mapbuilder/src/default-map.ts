import {
  DEFAULT_GRID,
  DEFAULT_SKIN_NAME,
  DEFAULT_WYRM_PATH,
  H,
  HOARD_HEIGHT,
  W,
} from "./constants";
import { hoardGridFromAnchor, mirrorHoardTeam } from "./hoard";
import { newId, resetIdCounter } from "./schema";
import type { MapDocument, MapPlatform, MapSpawns } from "./types";

const HOARD_SHELF_Y = 592;
const HOARD_Y = HOARD_SHELF_Y - HOARD_HEIGHT;
const HOARD_X_BLUE = 70;

export const DEFAULT_SPAWNS: MapSpawns = {
  blue: {
    main: { x: 110, y: 520 },
    backup: [
      { x: 420, y: 620 },
      { x: 275, y: 430 },
      { x: 155, y: 340 },
    ],
  },
  red: {
    main: { x: W - 110, y: 520 },
    backup: [
      { x: W - 420, y: 620 },
      { x: W - 275, y: 430 },
      { x: W - 155, y: 340 },
    ],
  },
};

/** Blank symmetric template: ground floor + hoard slots + wyrm path. */
export function blankMap(): MapDocument {
  resetIdCounter();
  const pair = newId("pair");
  const blueSlots = hoardGridFromAnchor(HOARD_X_BLUE, HOARD_Y);
  return {
    version: 1,
    id: "new_map",
    name: "New Map",
    width: W,
    height: H,
    grid: DEFAULT_GRID,
    platforms: [
      {
        id: newId("plat"),
        x: 0,
        y: 690,
        w: W,
        h: 30,
        skin: DEFAULT_SKIN_NAME,
        ground: true,
      },
      {
        id: newId("plat"),
        x: 56,
        y: HOARD_SHELF_Y,
        w: 260,
        h: 16,
        skin: DEFAULT_SKIN_NAME,
        pairId: pair,
      },
      {
        id: newId("plat"),
        x: W - 56 - 260,
        y: HOARD_SHELF_Y,
        w: 260,
        h: 16,
        skin: DEFAULT_SKIN_NAME,
        pairId: pair,
      },
    ],
    walls: [],
    gemSeams: [],
    hoardSlots: {
      blue: blueSlots,
      red: mirrorHoardTeam(blueSlots),
    },
    wyrmPath: { ...DEFAULT_WYRM_PATH },
    spawns: structuredClone(DEFAULT_SPAWNS),
  };
}

/** Current shipped arena geometry encoded as JSON (reference map). */
export function defaultArenaMap(): MapDocument {
  resetIdCounter();
  const doc = blankMap();
  doc.id = "default_arena";
  doc.name = "Default Arena";

  const rawPlatforms: [number, number, number, number][] = [
    [200, 490, 150, 16],
    [930, 490, 150, 16],
    [70, 400, 170, 16],
    [1040, 400, 170, 16],
    [210, 310, 170, 16],
    [900, 310, 170, 16],
    [80, 225, 170, 16],
    [1030, 225, 170, 16],
    [500, 570, 90, 16],
    [690, 570, 90, 16],
    [520, 450, 70, 16],
    [690, 450, 70, 16],
    [560, 330, 30, 16],
    [690, 330, 30, 16],
  ];

  const leftGems: [number, number][] = [
    [184, 648], [280, 648], [384, 648], [464, 648],
    [232, 464], [272, 464], [320, 464],
    [112, 376], [152, 376], [200, 376],
    [248, 288], [304, 288],
    [120, 200], [168, 200],
    [560, 544], [632, 544],
  ];

  for (const [x, y, w, h] of rawPlatforms) {
    if (doc.platforms.some((p) => p.x === x && p.y === y)) continue;
    const pairId = newId("pair");
    const left: MapPlatform = {
      id: newId("plat"),
      x: Math.min(x, W - x - w),
      y,
      w,
      h,
      skin: DEFAULT_SKIN_NAME,
      pairId,
    };
    const right: MapPlatform = {
      id: newId("plat"),
      x: W - left.x - w,
      y,
      w,
      h,
      skin: DEFAULT_SKIN_NAME,
      pairId,
    };
    if (left.x === right.x) {
      doc.platforms.push(left);
    } else {
      doc.platforms.push(left, right);
    }
  }

  for (const [x, y] of leftGems) {
    const pairId = newId("pair");
    doc.gemSeams.push(
      { id: newId("gem"), x, y, pairId },
      { id: newId("gem"), x: W - x, y, pairId }
    );
  }

  return doc;
}
