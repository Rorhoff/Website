import {
  GEM_SPAWNS,
  HOARD_X,
  HOARD_Y,
  PLATFORMS,
  SPAWN,
  SLOT_SIZE,
  TUNING,
  W,
} from "../arena-layout";
import { WHELP_ALT_SPAWNS } from "../spawn";
import type { LoadedArena, MapData } from "./types";

/** Union ground segments at the same y so mothers/wyrms do not fall through gaps. */
export function mergeGroundPlatforms(platforms: MapData["platforms"]): MapData["platforms"] {
  const rest = platforms.filter((p) => !p.ground);
  const byTop = new Map<number, MapData["platforms"]>();
  for (const p of platforms.filter((p) => p.ground)) {
    const row = byTop.get(p.y) ?? [];
    row.push(p);
    byTop.set(p.y, row);
  }
  const merged: MapData["platforms"] = [];
  for (const segs of byTop.values()) {
    const x0 = Math.min(...segs.map((s) => s.x));
    const x1 = Math.max(...segs.map((s) => s.x + s.w));
    merged.push({
      ...segs[0]!,
      x: x0,
      w: x1 - x0,
      ground: true,
    });
  }
  return [...merged, ...rest];
}

export function mapToArena(map: MapData): LoadedArena {
  const mergedPlatforms = mergeGroundPlatforms(map.platforms);
  const platforms: [number, number, number, number][] = mergedPlatforms.map((p) => [
    p.x,
    p.y,
    p.w,
    p.h,
  ]);
  const gemSpawns: [number, number][] = map.gemSeams.map((g) => [g.x, g.y]);
  const walls: [number, number, number, number][] = map.walls.map((w) => [w.x, w.y, w.w, w.h]);
  const slotCount = Math.max(map.hoardSlots.blue.length, map.hoardSlots.red.length, TUNING.slotsToWin);

  return {
    map: { ...map, platforms: mergedPlatforms },
    platforms,
    gemSpawns,
    walls,
    slotsToWin: slotCount,
    wyrmWin: { blue: map.wyrmPath.left, red: map.wyrmPath.right },
    cowGroundY: map.wyrmPath.y,
    cowFinishHeight: map.wyrmPath.finishHeight,
    spawns: map.spawns,
    hoardSlots: map.hoardSlots,
  };
}

/** True when the map includes a full-width ground floor platform. */
export function hasGroundPlatform(arena: LoadedArena): boolean {
  return arena.map.platforms.some((p) => p.ground);
}

/** Side walls at x=0 and x=W block horizontal wrap when present. */
export function hasLeftWall(arena: LoadedArena): boolean {
  return arena.walls.some(([x, , w]) => x <= 0 && x + w >= 8);
}

export function hasRightWall(arena: LoadedArena, worldW: number): boolean {
  return arena.walls.some(([x, , w]) => x + w >= worldW - 8 && x <= worldW);
}

/** Built-in arena when no JSON maps are present. */
export function builtinArena(): LoadedArena {
  const hoardSlots = {
    blue: Array.from({ length: TUNING.slotsToWin }, (_, i) => {
      const col = i % 8;
      const row = Math.floor(i / 8);
      return {
        id: `slot_${i}`,
        index: i,
        x: HOARD_X.blue + col * (SLOT_SIZE + 6),
        y: HOARD_Y + row * (SLOT_SIZE + 8),
      };
    }),
    red: Array.from({ length: TUNING.slotsToWin }, (_, i) => {
      const col = i % 8;
      const row = Math.floor(i / 8);
      return {
        id: `slot_r_${i}`,
        index: i,
        x: HOARD_X.red + col * (SLOT_SIZE + 6),
        y: HOARD_Y + row * (SLOT_SIZE + 8),
      };
    }),
  };

  const map: MapData = {
    version: 1,
    id: "builtin",
    name: "Built-in Arena",
    width: W,
    height: 720,
    grid: 8,
    platforms: PLATFORMS.map(([x, y, w, h], i) => ({
      id: `p${i}`,
      x,
      y,
      w,
      h,
      ground: i === 0,
    })),
    walls: [],
    gemSeams: GEM_SPAWNS.map(([x, y], i) => ({ id: `g${i}`, x, y })),
    hoardSlots,
    wyrmPath: {
      left: TUNING.wyrmWin.blue,
      right: TUNING.wyrmWin.red,
      y: TUNING.cowGroundY,
      finishHeight: TUNING.cowFinishHeight,
    },
    spawns: {
      blue: { main: SPAWN.blue, backup: [...WHELP_ALT_SPAWNS.blue] },
      red: { main: SPAWN.red, backup: [...WHELP_ALT_SPAWNS.red] },
    },
  };

  return mapToArena(map);
}
