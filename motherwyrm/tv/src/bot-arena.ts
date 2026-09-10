/** Arena geometry passed from Game.ts into bot brains (map-aware pathfinding). */

import {
  HOARD_SHELF_Y,
  HOARD_WIDTH,
  HOARD_X,
  PLATFORMS,
  TUNING,
  W,
  WHELP_HALF,
} from "./arena-layout";
import type { LoadedArena } from "./maps/types";
import type { Team } from "./net";

export type BotArena = {
  platforms: [number, number, number, number][];
  groundFeetY: number;
  cowGroundY: number;
  hoardCenterX: Record<Team, number>;
  hoardShelfY: number;
  hoardSpan: Record<Team, [number, number]>;
  wyrmWin: { blue: number; red: number };
  worldW: number;
  builtinArena: boolean;
};

export function botArenaFromLoaded(arena: LoadedArena): BotArena {
  const slots = arena.hoardSlots;
  const hoardCenterX = (team: Team) => {
    const xs = slots[team].map((s) => s.x);
    if (!xs.length) return HOARD_X[team] + HOARD_WIDTH / 2;
    return (Math.min(...xs) + Math.max(...xs)) / 2;
  };
  const shelfY =
    slots.blue.length > 0
      ? Math.max(...slots.blue.map((s) => s.y)) + 16
      : HOARD_SHELF_Y;
  const hoardSpan = (team: Team): [number, number] => {
    const xs = slots[team].map((s) => s.x);
    if (!xs.length) return [HOARD_X[team] - 14, HOARD_X[team] + HOARD_WIDTH + 14];
    return [Math.min(...xs) - 14, Math.max(...xs) + 14];
  };

  return {
    platforms: arena.platforms,
    groundFeetY: arena.cowGroundY - WHELP_HALF,
    cowGroundY: arena.cowGroundY,
    hoardCenterX: { blue: hoardCenterX("blue"), red: hoardCenterX("red") },
    hoardShelfY: shelfY,
    hoardSpan: { blue: hoardSpan("blue"), red: hoardSpan("red") },
    wyrmWin: arena.wyrmWin,
    worldW: arena.map.width,
    builtinArena: arena.map.id === "default_arena" || arena.map.id === "builtin",
  };
}

export function defaultBotArena(): BotArena {
  return botArenaFromLoaded({
    map: { id: "builtin", width: W } as LoadedArena["map"],
    platforms: PLATFORMS.map(([x, y, w, h]) => [x, y, w, h]),
    gemSpawns: [],
    walls: [],
    slotsToWin: TUNING.slotsToWin,
    wyrmWin: TUNING.wyrmWin,
    cowGroundY: TUNING.cowGroundY ?? 690,
    cowFinishHeight: TUNING.cowFinishHeight,
    spawns: { blue: { main: { x: 0, y: 0 }, backup: [] }, red: { main: { x: 0, y: 0 }, backup: [] } },
    hoardSlots: { blue: [], red: [] },
  });
}
