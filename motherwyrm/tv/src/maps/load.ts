import { mapToArena, builtinArena } from "./apply";
import type { LoadedArena } from "./apply";
import { validateMapModule, validateMapData, type MapValidationResult } from "./validate";
import type { MapData } from "./types";

export type { MapData, LoadedArena };

const mapModules = import.meta.glob("./*.json", { eager: true });

export type LoadedMapEntry = {
  file: string;
  map: MapData;
  arena: LoadedArena;
};

const loadErrors: MapValidationResult[] = [];

function loadBundledMaps(): LoadedMapEntry[] {
  const out: LoadedMapEntry[] = [];
  loadErrors.length = 0;

  for (const [file, mod] of Object.entries(mapModules)) {
    const result = validateMapModule(mod, file);
    if (!result.ok) {
      loadErrors.push(result);
      if (import.meta.env.DEV) {
        console.error(`[maps] skipped ${result.file}: ${result.error}`);
      }
      continue;
    }
    out.push({ file, map: result.map, arena: mapToArena(result.map) });
  }

  if (import.meta.env.DEV && loadErrors.length) {
    console.warn(`[maps] ${loadErrors.length} map(s) failed validation and were skipped.`);
  }

  return out.sort((a, b) => a.map.name.localeCompare(b.map.name));
}

const bundledMaps = loadBundledMaps();
let publishedMaps: LoadedMapEntry[] = [];

function mergeMaps(): LoadedMapEntry[] {
  const byId = new Map<string, LoadedMapEntry>();
  for (const entry of bundledMaps) byId.set(entry.map.id, entry);
  for (const entry of publishedMaps) byId.set(entry.map.id, entry);
  const merged = [...byId.values()].sort((a, b) => a.map.name.localeCompare(b.map.name));
  if (merged.length) return merged;
  const fallback = builtinArena();
  return [{ file: "builtin", map: fallback.map, arena: fallback }];
}

/** Bundled + server-published maps (published overrides bundled by id). */
export function allMaps(): LoadedMapEntry[] {
  return mergeMaps();
}

/** Fetch maps published via the map builder and merge into the lobby pool. */
export async function loadPublishedMaps(): Promise<void> {
  try {
    const res = await fetch("/api/mw/maps");
    if (!res.ok) return;
    const payload = (await res.json()) as { maps?: Array<{ id: string }> };
    const metas = payload.maps ?? [];
    const next: LoadedMapEntry[] = [];
    for (const meta of metas) {
      const detail = await fetch(`/api/mw/maps/${encodeURIComponent(meta.id)}`);
      if (!detail.ok) continue;
      const raw = await detail.json();
      try {
        const map = validateMapData(raw, `published:${meta.id}`);
        next.push({ file: `published:${meta.id}`, map, arena: mapToArena(map) });
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn(`[maps] skipped published ${meta.id}:`, (err as Error).message);
        }
      }
    }
    publishedMaps = next.sort((a, b) => a.map.name.localeCompare(b.map.name));
  } catch {
    /* offline or API unavailable — bundled maps only */
  }
}

export function getLoadErrors(): MapValidationResult[] {
  return loadErrors.filter((e): e is Extract<MapValidationResult, { ok: false }> => !e.ok);
}

export function randomMapPool(): LoadedMapEntry[] {
  return allMaps().filter((e) => !e.map.excludeFromRandom);
}

export function pickRandomMap(): LoadedMapEntry | undefined {
  const pool = randomMapPool();
  const maps = allMaps();
  if (!pool.length) return maps[0];
  return pool[Math.floor(Math.random() * pool.length)];
}

export function findMapById(id: string): LoadedMapEntry | undefined {
  return allMaps().find((e) => e.map.id === id);
}
