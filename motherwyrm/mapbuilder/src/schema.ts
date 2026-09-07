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
import type { MapDocument, MapGemSeam, MapPlatform, PlatformPalette, ValidationIssue } from "./types";

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

/** Gems use pixel coordinates (arena spawns are not on the platform grid). */
export function snapGem(v: number): number {
  return Math.round(v);
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
    issues.push({ level: "warn", message: "No ground platform — add a full-width floor row." });
  } else if (grounds.length > 1) {
    issues.push({ level: "warn", message: "Multiple ground platforms defined." });
  }

  for (const p of doc.platforms) {
    if (p.w < 8 || p.h < 4) {
      issues.push({ level: "error", message: `Platform ${p.id} is too small (${p.w}×${p.h}).` });
    }
    if (p.x < 0 || p.y < 0 || p.x + p.w > W || p.y + p.h > H) {
      issues.push({ level: "error", message: `Platform ${p.id} extends outside the arena.` });
    }
    if (p.skin && !SKIN_PRESETS[p.skin] && !p.palette) {
      issues.push({ level: "warn", message: `Platform ${p.id} references unknown skin "${p.skin}".` });
    }
  }

  if (mirrorLock) validateSymmetry(doc, issues);

  if (doc.wyrmPath.left >= doc.wyrmPath.right) {
    issues.push({ level: "error", message: "Wyrm path left finish must be left of right finish." });
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

  if (doc.spawns && doc.spawns.blue.x !== mirrorPointX(doc.spawns.red.x)) {
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
    gemSeams: raw.gemSeams ?? [],
    hoardSlots: normalizeHoard(raw.hoardSlots ?? { blue: [], red: [] }),
    wyrmPath,
    spawns: raw.spawns,
  };
}

export function exportMap(doc: MapDocument): MapDocument {
  return JSON.parse(serializeMap(doc)) as MapDocument;
}
