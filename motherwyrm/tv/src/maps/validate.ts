import type { MapData } from "./types";

export type MapValidationResult =
  | { ok: true; map: MapData }
  | { ok: false; file: string; error: string };

function req(obj: unknown, field: string, file: string): asserts obj is Record<string, unknown> {
  if (!obj || typeof obj !== "object") throw new Error(`${file}: not an object`);
  if (!(field in obj)) throw new Error(`${file}: missing "${field}"`);
}

/** Validate exported map JSON before adding to the pool. */
export function validateMapData(raw: unknown, file: string): MapData {
  req(raw, "version", file);
  const m = raw as Record<string, unknown>;
  if (m.version !== 1) throw new Error(`${file}: unsupported version ${String(m.version)}`);
  for (const key of ["id", "name", "platforms", "gemSeams", "hoardSlots", "wyrmPath", "spawns"] as const) {
    req(m, key, file);
  }
  if (!Array.isArray(m.platforms)) throw new Error(`${file}: platforms must be an array`);
  if (!Array.isArray(m.gemSeams)) throw new Error(`${file}: gemSeams must be an array`);
  if (!Array.isArray((m.walls as unknown[] | undefined) ?? [])) throw new Error(`${file}: walls must be an array`);
  const hoard = m.hoardSlots as Record<string, unknown>;
  if (!hoard || !Array.isArray(hoard.blue) || !Array.isArray(hoard.red)) {
    throw new Error(`${file}: hoardSlots.blue/red must be arrays`);
  }
  const wp = m.wyrmPath as Record<string, unknown>;
  for (const k of ["left", "right", "y", "finishHeight"]) {
    if (typeof wp[k] !== "number") throw new Error(`${file}: wyrmPath.${k} must be a number`);
  }
  const sp = m.spawns as Record<string, unknown>;
  for (const team of ["blue", "red"] as const) {
    const t = sp[team] as Record<string, unknown> | undefined;
    if (!t?.main || typeof (t.main as { x: number }).x !== "number") {
      throw new Error(`${file}: spawns.${team}.main required`);
    }
    if (!Array.isArray(t.backup)) throw new Error(`${file}: spawns.${team}.backup must be an array`);
  }
  if (typeof m.id !== "string" || !m.id.trim()) throw new Error(`${file}: id required`);
  if (typeof m.name !== "string" || !m.name.trim()) throw new Error(`${file}: name required`);

  return {
    version: 1,
    id: m.id as string,
    name: m.name as string,
    width: typeof m.width === "number" ? m.width : 1280,
    height: typeof m.height === "number" ? m.height : 720,
    grid: typeof m.grid === "number" ? m.grid : 8,
    platforms: m.platforms as MapData["platforms"],
    walls: (m.walls as MapData["walls"]) ?? [],
    gemSeams: m.gemSeams as MapData["gemSeams"],
    hoardSlots: m.hoardSlots as MapData["hoardSlots"],
    wyrmPath: m.wyrmPath as MapData["wyrmPath"],
    spawns: m.spawns as MapData["spawns"],
    thumbnail: typeof m.thumbnail === "string" ? m.thumbnail : undefined,
    excludeFromRandom: m.excludeFromRandom === true,
    sprites: typeof m.sprites === "object" && m.sprites !== null ? (m.sprites as MapData["sprites"]) : undefined,
  };
}

export function validateMapModule(mod: unknown, file: string): MapValidationResult {
  try {
    const raw = (mod as { default?: unknown }).default ?? mod;
    return { ok: true, map: validateMapData(raw, file) };
  } catch (err) {
    return { ok: false, file, error: (err as Error).message };
  }
}
