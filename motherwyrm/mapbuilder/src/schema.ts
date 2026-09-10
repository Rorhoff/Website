import {
  CENTER_X,
  DEFAULT_GRID,
  DEFAULT_SKIN_NAME,
  DEFAULT_WYRM_PATH,
  H,
  SLOT_SIZE,
  SKIN_PRESETS,
  W,
} from "./constants";
import { hoardGridFromAnchor, mirrorHoardTeam } from "./hoard";
import { DEFAULT_SPAWNS } from "./default-map";
import type { MapDocument, MapGemSeam, MapHoardSlot, MapPlatform, MapSpawns, MapSprites, PlatformPalette, ValidationIssue } from "./types";

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter}_${Math.random().toString(36).slice(2, 7)}`;
}

export function resetIdCounter(n = 0): void {
  idCounter = n;
}

export function snap(v: number, grid: number): number {
  if (grid <= 0) return v;
  return Math.round(v / grid) * grid;
}

/** Gems snap to the editor grid (grid-line intersections). */
export function snapGem(v: number, grid: number): number {
  return snap(v, grid);
}

export function mirrorPlatformX(x: number, w: number): number {
  return W - x - w;
}

export function mirrorPointX(x: number): number {
  return W - x;
}

export function isOnCenterline(x: number, w = 0): boolean {
  const cx = x + w / 2;
  return Math.abs(cx - CENTER_X) < 0.5;
}

/** True when gx lies over platform p, including toroidal wrap copies. */
export function platformContainsX(p: MapPlatform, gx: number): boolean {
  if (gx >= p.x && gx <= p.x + p.w) return true;
  if (p.x < 0 && gx >= p.x + W && gx <= p.x + p.w + W) return true;
  if (p.x + p.w > W) {
    const wx = p.x - W;
    if (gx >= wx && gx <= wx + p.w) return true;
  }
  return false;
}

/**
 * Wrap a platform horizontally when dragged past a side — matches in-game x wrap.
 * Allows straddling the seam (e.g. x=-8 with w=96 spans the left edge).
 */
export function wrapPlatformHorizontal(x: number, w: number): number {
  let nx = x;
  if (nx + w > W && nx > 0) nx -= W;
  if (nx + w <= 0) nx += W;
  else if (nx >= W) nx -= W;
  return nx;
}

export function normalizePlatformX(x: number, w: number, grid: number): number {
  return snap(wrapPlatformHorizontal(x, w), grid);
}

export function mirrorGemSeam(g: MapGemSeam): MapGemSeam {
  return {
    ...g,
    id: newId("gem"),
    x: mirrorPointX(g.x),
    pairId: g.pairId,
  };
}

export function resolvePalette(p: MapPlatform): PlatformPalette {
  if (p.palette) return p.palette;
  const name = p.skin ?? DEFAULT_SKIN_NAME;
  return SKIN_PRESETS[name] ?? SKIN_PRESETS[DEFAULT_SKIN_NAME];
}

export function validateMap(doc: MapDocument, mirrorLock: boolean): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!doc.id.trim()) issues.push({ level: "error", message: "Map id is empty." });
  if (!doc.name.trim()) issues.push({ level: "error", message: "Map name is empty." });

  const grounds = doc.platforms.filter((p) => p.ground);
  if (grounds.length === 0) {
    issues.push({ level: "warn", message: "No ground platform — wyrms and mothers fall through and wrap to the top." });
  } else if (grounds.length > 1) {
    issues.push({ level: "warn", message: "Multiple ground platforms defined." });
  }

  for (const p of doc.platforms) {
    if (p.w < 8 || p.h < 4) {
      issues.push({ level: "error", message: `Platform ${p.id} is too small (${p.w}×${p.h}).` });
    }
    if (p.y < 0 || p.y + p.h > H) {
      issues.push({ level: "error", message: `Platform ${p.id} extends outside the arena vertically.` });
    }
    if (p.skin && !SKIN_PRESETS[p.skin] && !p.palette) {
      issues.push({ level: "warn", message: `Platform ${p.id} references unknown skin "${p.skin}".` });
    }
  }

  if (mirrorLock) validateSymmetry(doc, issues);

  if (doc.wyrmPath.left >= doc.wyrmPath.right) {
    issues.push({ level: "error", message: "Cow path left finish must be left of right finish." });
  }

  return issues;
}

function validateSymmetry(doc: MapDocument, issues: ValidationIssue[]): void {
  for (let i = 0; i < doc.platforms.length; i++) {
    const p = doc.platforms[i];
    if (p.ground) continue;
    if (isOnCenterline(p.x, p.w)) continue;

    const mx = mirrorPlatformX(p.x, p.w);
    const pair = doc.platforms.find(
      (o, j) =>
        j !== i &&
        !o.ground &&
        o.x === mx &&
        o.y === p.y &&
        o.w === p.w &&
        o.h === p.h
    );
    if (!pair) {
      issues.push({
        level: "error",
        message: `Platform at (${p.x},${p.y}) has no mirror at x=${mx}.`,
      });
    }
  }

  const leftGems = doc.gemSeams.filter((g) => g.x < CENTER_X);
  for (const g of leftGems) {
    const mx = mirrorPointX(g.x);
    if (!doc.gemSeams.some((o) => o.x === mx && o.y === g.y)) {
      issues.push({
        level: "error",
        message: `Gem at (${g.x},${g.y}) missing mirror at (${mx},${g.y}).`,
      });
    }
  }

  for (const b of doc.hoardSlots.blue) {
    const mx = W - b.x - SLOT_SIZE;
    const pair = doc.hoardSlots.red.find((r) => r.index === b.index);
    if (!pair || Math.abs(pair.x - mx) > 0.5 || pair.y !== b.y) {
      issues.push({
        level: "error",
        message: `Hoard slot ${b.index} (blue) missing mirror at (${mx},${b.y}).`,
      });
    }
  }

  for (let i = 0; i < doc.walls.length; i++) {
    const w = doc.walls[i]!;
    if (isOnCenterline(w.x, w.w)) continue;
    const mx = mirrorPlatformX(w.x, w.w);
    const pair = doc.walls.find(
      (o, j) => j !== i && o.x === mx && o.y === w.y && o.w === w.w && o.h === w.h
    );
    if (!pair) {
      issues.push({
        level: "error",
        message: `Wall at (${w.x},${w.y}) has no mirror at x=${mx}.`,
      });
    }
  }

  if (doc.spawns.blue.main.x !== mirrorPointX(doc.spawns.red.main.x)) {
    issues.push({ level: "error", message: "Team spawns are not mirrored on x." });
  }
}

export function serializeMap(doc: MapDocument): string {
  return JSON.stringify(doc, null, 2);
}

export function parseMap(json: string): MapDocument {
  const raw = JSON.parse(json) as MapDocument;
  if (raw.version !== 1) throw new Error(`Unsupported map version: ${raw.version}`);
  return normalizeMap(raw);
}

function normalizeHoard(raw: MapDocument["hoardSlots"]): MapDocument["hoardSlots"] {
  const blue = raw.blue ?? [];
  const red = raw.red ?? [];
  if (blue.length === 1 && (blue[0] as { index?: number }).index === undefined) {
    const anchor = blue[0]!;
    const grid = hoardGridFromAnchor(anchor.x, anchor.y);
    return { blue: grid, red: mirrorHoardTeam(grid) };
  }
  return {
    blue: blue.map((s, i) => ({ ...s, index: s.index ?? i, id: s.id ?? newId("slot") })),
    red: red.map((s, i) => ({ ...s, index: s.index ?? i, id: s.id ?? newId("slot") })),
  };
}

function normalizeSpawns(raw: MapDocument["spawns"] | undefined): MapSpawns {
  if (!raw) return structuredClone(DEFAULT_SPAWNS);
  const legacy = raw as MapSpawns & { blue?: { x?: number; main?: unknown } };
  if (legacy.blue && "x" in legacy.blue && !("main" in legacy.blue)) {
    const oldBlue = legacy.blue as { x: number; y: number };
    const oldRed = (raw as { red: { x: number; y: number } }).red;
    return {
      blue: { main: oldBlue, backup: [...DEFAULT_SPAWNS.blue.backup] },
      red: { main: oldRed, backup: [...DEFAULT_SPAWNS.red.backup] },
    };
  }
  return {
    blue: {
      main: legacy.blue.main,
      backup: [...(legacy.blue.backup ?? [])],
    },
    red: {
      main: legacy.red.main,
      backup: [...(legacy.red.backup ?? [])],
    },
  };
}

function normalizeSprites(raw: MapSprites | undefined): MapSprites | undefined {
  if (!raw) return undefined;
  const s = { ...raw } as Record<string, string>;
  if (s.mother_blue && !s.mother_blue_idle) {
    s.mother_blue_idle = s.mother_blue;
    delete s.mother_blue;
  }
  if (s.mother_red && !s.mother_red_idle) {
    s.mother_red_idle = s.mother_red;
    delete s.mother_red;
  }
  const out = s as MapSprites;
  return Object.values(out).some(Boolean) ? out : undefined;
}

function normalizeMap(raw: MapDocument): MapDocument {
  const wyrmPath = {
    ...DEFAULT_WYRM_PATH,
    ...raw.wyrmPath,
    finishHeight: raw.wyrmPath?.finishHeight ?? DEFAULT_WYRM_PATH.finishHeight,
  };
  return {
    version: 1,
    id: raw.id ?? "untitled",
    name: raw.name ?? "Untitled",
    width: raw.width ?? W,
    height: raw.height ?? H,
    grid: raw.grid ?? DEFAULT_GRID,
    platforms: raw.platforms ?? [],
    walls: raw.walls ?? [],
    gemSeams: raw.gemSeams ?? [],
    hoardSlots: normalizeHoard(raw.hoardSlots ?? { blue: [], red: [] }),
    wyrmPath,
    spawns: normalizeSpawns(raw.spawns),
    sprites: normalizeSprites(raw.sprites),
    thumbnail: raw.thumbnail,
    excludeFromRandom: raw.excludeFromRandom,
  };
}

export function exportMap(doc: MapDocument): MapDocument {
  return JSON.parse(serializeMap(doc)) as MapDocument;
}
