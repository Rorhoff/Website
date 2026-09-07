import {
  CENTER_X,
  DEFAULT_SKIN_NAME,
  H,
  SLOT_SIZE,
  W,
} from "../constants";
import { mirrorHoardSlot, slotRect } from "../hoard";
import {
  isOnCenterline,
  mirrorGemSeam,
  mirrorPlatformX,
  mirrorPointX,
  newId,
  normalizePlatformX,
  platformContainsX,
  snap,
  snapGem,
} from "../schema";
import type { EditorState, MapDocument, MapGemSeam, MapHoardSlot, MapPlatform, MapWall, Selection, SpawnPoint } from "../types";

export type { EditorState, Selection };

export function createEditorState(doc: MapDocument): EditorState {
  return {
    doc,
    mirrorLock: true,
    gemGravity: true,
    tool: "select",
    selection: null,
    grid: doc.grid,
    dirty: false,
  };
}

/** Drop a gem to the nearest platform top at gx, at or below gy. */
export function dropGemY(doc: MapDocument, gx: number, gy: number, grid: number): number {
  let floor = H;
  for (const p of doc.platforms) {
    if (!platformContainsX(p, gx)) continue;
    if (p.y >= gy && p.y < floor) floor = p.y;
  }
  return snapGem(floor, grid);
}

function finalizePlatformX(state: EditorState, p: MapPlatform): void {
  p.x = normalizePlatformX(p.x, p.w, state.grid);
}

function syncMirrorPlatformPosition(state: EditorState, p: MapPlatform): void {
  if (!state.mirrorLock || !p.pairId) return;
  const mate = partnerPlatform(state.doc, p);
  if (!mate) return;
  mate.x = normalizePlatformX(mirrorPlatformX(p.x, p.w), mate.w, state.grid);
  mate.y = p.y;
  mate.w = p.w;
  mate.h = p.h;
}

export function findPlatform(doc: MapDocument, id: string): MapPlatform | undefined {
  return doc.platforms.find((p) => p.id === id);
}

export function findGem(doc: MapDocument, id: string): MapGemSeam | undefined {
  return doc.gemSeams.find((g) => g.id === id);
}

export function findHoardSlot(doc: MapDocument, id: string): { slot: MapHoardSlot; team: "blue" | "red" } | undefined {
  for (const team of ["blue", "red"] as const) {
    const slot = doc.hoardSlots[team].find((s) => s.id === id);
    if (slot) return { slot, team };
  }
  return undefined;
}

export function findWall(doc: MapDocument, id: string): MapWall | undefined {
  return doc.walls.find((w) => w.id === id);
}

export function partnerWall(doc: MapDocument, w: MapWall): MapWall | undefined {
  if (!w.pairId) return undefined;
  return doc.walls.find((o) => o.pairId === w.pairId && o.id !== w.id);
}

export function partnerPlatform(doc: MapDocument, p: MapPlatform): MapPlatform | undefined {
  if (!p.pairId) return undefined;
  return doc.platforms.find((o) => o.pairId === p.pairId && o.id !== p.id);
}

export function partnerGem(doc: MapDocument, g: MapGemSeam): MapGemSeam | undefined {
  if (!g.pairId) return undefined;
  return doc.gemSeams.find((o) => o.pairId === g.pairId && o.id !== g.id);
}

export function partnerHoardSlot(doc: MapDocument, s: MapHoardSlot, team: "blue" | "red"): MapHoardSlot | undefined {
  const other = team === "blue" ? "red" : "blue";
  return doc.hoardSlots[other].find((o) => o.index === s.index);
}

export function addPlatform(state: EditorState, x: number, y: number, w = 96, h = 16): MapPlatform {
  const grid = state.grid;
  const plat: MapPlatform = {
    id: newId("plat"),
    x: snap(x, grid),
    y: snap(y, grid),
    w: snap(w, grid),
    h: snap(h, grid),
    skin: DEFAULT_SKIN_NAME,
  };
  finalizePlatformX(state, plat);

  if (state.mirrorLock && !isOnCenterline(plat.x, plat.w)) {
    const pairId = newId("pair");
    plat.pairId = pairId;
    const mirror: MapPlatform = {
      ...plat,
      id: newId("plat"),
      x: normalizePlatformX(mirrorPlatformX(plat.x, plat.w), plat.w, grid),
      pairId,
    };
    state.doc.platforms.push(plat, mirror);
  } else {
    state.doc.platforms.push(plat);
  }

  state.dirty = true;
  state.selection = { kind: "platform", ids: [plat.id] };
  return plat;
}

export function addWall(state: EditorState, x: number, y: number, w = 16, h = 120): MapWall {
  const grid = state.grid;
  const wall: MapWall = {
    id: newId("wall"),
    x: snap(x, grid),
    y: snap(y, grid),
    w: snap(w, grid),
    h: snap(h, grid),
  };

  if (state.mirrorLock && !isOnCenterline(wall.x, wall.w)) {
    const pairId = newId("pair");
    wall.pairId = pairId;
    const mirror: MapWall = {
      ...wall,
      id: newId("wall"),
      x: mirrorPlatformX(wall.x, wall.w),
      pairId,
    };
    state.doc.walls.push(wall, mirror);
  } else {
    state.doc.walls.push(wall);
  }

  state.dirty = true;
  state.selection = { kind: "wall", ids: [wall.id] };
  return wall;
}

export function moveWall(state: EditorState, id: string, x: number, y: number): void {
  const w = findWall(state.doc, id);
  if (!w) return;
  w.x = snap(x, state.grid);
  w.y = snap(y, state.grid);
  if (state.mirrorLock && w.pairId) {
    const mate = partnerWall(state.doc, w);
    if (mate) {
      mate.x = mirrorPlatformX(w.x, w.w);
      mate.y = w.y;
      mate.w = w.w;
      mate.h = w.h;
    }
  }
  state.dirty = true;
}

export function movePlatform(state: EditorState, id: string, x: number, y: number): void {
  const p = findPlatform(state.doc, id);
  if (!p) return;

  p.x = snap(x, state.grid);
  p.y = snap(y, state.grid);
  finalizePlatformX(state, p);
  syncMirrorPlatformPosition(state, p);

  state.dirty = true;
}

export function resizePlatform(state: EditorState, id: string, w: number, h: number): void {
  const p = findPlatform(state.doc, id);
  if (!p) return;

  p.w = Math.max(8, snap(w, state.grid));
  p.h = Math.max(4, snap(h, state.grid));
  finalizePlatformX(state, p);
  syncMirrorPlatformPosition(state, p);

  state.dirty = true;
}

export function deleteSelection(state: EditorState): void {
  const sel = state.selection;
  if (!sel) return;

  const dropPlatforms = (ids: string[]) => {
    const drop = new Set<string>();
    for (const id of ids) {
      const p = findPlatform(state.doc, id);
      if (!p) continue;
      drop.add(p.id);
      const mate = partnerPlatform(state.doc, p);
      if (mate) drop.add(mate.id);
    }
    state.doc.platforms = state.doc.platforms.filter((o) => !drop.has(o.id));
  };

  const dropGems = (ids: string[]) => {
    const drop = new Set<string>();
    for (const id of ids) {
      const g = findGem(state.doc, id);
      if (!g) continue;
      drop.add(g.id);
      const mate = partnerGem(state.doc, g);
      if (mate) drop.add(mate.id);
    }
    state.doc.gemSeams = state.doc.gemSeams.filter((o) => !drop.has(o.id));
  };

  const dropWalls = (ids: string[]) => {
    const drop = new Set<string>();
    for (const id of ids) {
      const w = findWall(state.doc, id);
      if (!w) continue;
      drop.add(w.id);
      const mate = partnerWall(state.doc, w);
      if (mate) drop.add(mate.id);
    }
    state.doc.walls = state.doc.walls.filter((o) => !drop.has(o.id));
  };

  if (sel.kind === "multi") {
    dropPlatforms(sel.platforms);
    dropGems(sel.gems);
    dropWalls(sel.walls);
  } else if (sel.kind === "platform") {
    dropPlatforms(sel.ids);
  } else if (sel.kind === "gem") {
    dropGems(sel.ids);
  } else if (sel.kind === "wall") {
    dropWalls(sel.ids);
  }

  state.selection = null;
  state.dirty = true;
}

export function findGemAt(
  doc: MapDocument,
  x: number,
  y: number,
  tol = 6,
  exceptId?: string
): MapGemSeam | undefined {
  for (let i = doc.gemSeams.length - 1; i >= 0; i--) {
    const g = doc.gemSeams[i]!;
    if (exceptId && g.id === exceptId) continue;
    if (Math.hypot(g.x - x, g.y - y) <= tol) return g;
  }
  return undefined;
}

export type AddGemResult =
  | { ok: true; gem: MapGemSeam }
  | { ok: false; reason: "occupied" | "mirror_occupied" };

export function addGem(state: EditorState, x: number, y: number): AddGemResult {
  const gx = snapGem(x, state.grid);
  let gy = snapGem(y, state.grid);
  if (state.gemGravity) gy = dropGemY(state.doc, gx, gy, state.grid);

  if (findGemAt(state.doc, gx, gy)) {
    return { ok: false, reason: "occupied" };
  }

  const gem: MapGemSeam = {
    id: newId("gem"),
    x: gx,
    y: gy,
  };

  if (state.mirrorLock && gem.x !== mirrorPointX(gem.x)) {
    const mx = mirrorPointX(gem.x);
    if (findGemAt(state.doc, mx, gy)) {
      return { ok: false, reason: "mirror_occupied" };
    }
    const pairId = newId("pair");
    gem.pairId = pairId;
    const mirror = mirrorGemSeam(gem);
    mirror.pairId = pairId;
    state.doc.gemSeams.push(gem, mirror);
  } else {
    state.doc.gemSeams.push(gem);
  }

  state.dirty = true;
  state.selection = { kind: "gem", ids: [gem.id] };
  return { ok: true, gem };
}

export function moveGem(state: EditorState, id: string, x: number, y: number): boolean {
  const g = findGem(state.doc, id);
  if (!g) return false;

  const gx = snapGem(x, state.grid);
  let gy = snapGem(y, state.grid);
  if (state.gemGravity) gy = dropGemY(state.doc, gx, gy, state.grid);

  if (findGemAt(state.doc, gx, gy, 6, g.id)) return false;

  if (state.mirrorLock && g.pairId) {
    const mate = partnerGem(state.doc, g);
    if (mate) {
      const mx = mirrorPointX(gx);
      if (findGemAt(state.doc, mx, gy, 6, mate.id)) return false;
    }
  }

  g.x = gx;
  g.y = gy;

  if (state.mirrorLock && g.pairId) {
    const mate = partnerGem(state.doc, g);
    if (mate) {
      mate.x = mirrorPointX(g.x);
      mate.y = g.y;
    }
  }

  state.dirty = true;
  return true;
}

export function gemBlockReason(
  state: EditorState,
  x: number,
  y: number
): AddGemResult["reason"] | null {
  const gx = snapGem(x, state.grid);
  let gy = snapGem(y, state.grid);
  if (state.gemGravity) gy = dropGemY(state.doc, gx, gy, state.grid);
  if (findGemAt(state.doc, gx, gy)) return "occupied";
  if (state.mirrorLock && gx !== mirrorPointX(gx)) {
    if (findGemAt(state.doc, mirrorPointX(gx), gy)) return "mirror_occupied";
  }
  return null;
}

export function gemHoverBlocked(state: EditorState, x: number, y: number): boolean {
  return gemBlockReason(state, x, y) !== null;
}

export function moveHoardSlot(state: EditorState, id: string, x: number, y: number): void {
  const found = findHoardSlot(state.doc, id);
  if (!found) return;
  const { slot, team } = found;

  slot.x = snap(x, state.grid);
  slot.y = snap(y, state.grid);

  if (state.mirrorLock) {
    const mate = partnerHoardSlot(state.doc, slot, team);
    if (mate) {
      const mirrored = mirrorHoardSlot(slot);
      mate.x = mirrored.x;
      mate.y = mirrored.y;
    }
  }

  state.dirty = true;
}

export function setCowGroundY(state: EditorState, y: number): void {
  state.doc.wyrmPath.y = snap(y, state.grid);
  state.dirty = true;
}

export function setFinishHeight(state: EditorState, height: number): void {
  state.doc.wyrmPath.finishHeight = Math.max(40, snap(height, state.grid));
  state.dirty = true;
}

function syncMirrorPlatform(state: EditorState, p: MapPlatform, apply: (mate: MapPlatform) => void): void {
  if (!state.mirrorLock || !p.pairId) return;
  const mate = partnerPlatform(state.doc, p);
  if (mate) apply(mate);
}

export function setPlatformSkin(state: EditorState, id: string, skin: string): void {
  const p = findPlatform(state.doc, id);
  if (!p) return;
  p.skin = skin;
  delete p.palette;
  syncMirrorPlatform(state, p, (mate) => {
    mate.skin = skin;
    delete mate.palette;
  });
  state.dirty = true;
}

export function setPlatformPalette(state: EditorState, id: string, palette: MapPlatform["palette"]): void {
  const p = findPlatform(state.doc, id);
  if (!p || !palette) return;
  p.palette = { ...palette };
  p.skin = undefined;
  syncMirrorPlatform(state, p, (mate) => {
    mate.palette = { ...palette };
    mate.skin = undefined;
  });
  state.dirty = true;
}

export function allHoardSlots(doc: MapDocument): Array<{ slot: MapHoardSlot; team: "blue" | "red" }> {
  const out: Array<{ slot: MapHoardSlot; team: "blue" | "red" }> = [];
  for (const team of ["blue", "red"] as const) {
    for (const slot of doc.hoardSlots[team]) out.push({ slot, team });
  }
  return out;
}

export function hitTestPlatform(doc: MapDocument, x: number, y: number): MapPlatform | undefined {
  for (let i = doc.platforms.length - 1; i >= 0; i--) {
    const p = doc.platforms[i];
    if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return p;
  }
  return undefined;
}

export function hitTestGem(doc: MapDocument, x: number, y: number, r = 8): MapGemSeam | undefined {
  for (let i = doc.gemSeams.length - 1; i >= 0; i--) {
    const g = doc.gemSeams[i];
    if (Math.hypot(g.x - x, g.y - y) <= r) return g;
  }
  return undefined;
}

export function hitTestHoardSlot(doc: MapDocument, x: number, y: number): MapHoardSlot | undefined {
  for (const { slot } of allHoardSlots(doc)) {
    const r = slotRect(slot);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return slot;
  }
  return undefined;
}

export function hitTestWall(doc: MapDocument, x: number, y: number): MapWall | undefined {
  for (let i = doc.walls.length - 1; i >= 0; i--) {
    const w = doc.walls[i]!;
    if (x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) return w;
  }
  return undefined;
}

export function hitTestSpawn(
  doc: MapDocument,
  x: number,
  y: number
): { team: "blue" | "red"; role: "main" | "backup"; index: number } | undefined {
  const r = 12;
  for (const team of ["blue", "red"] as const) {
    const sp = doc.spawns[team];
    if (Math.hypot(sp.main.x - x, sp.main.y - y) <= r) {
      return { team, role: "main", index: 0 };
    }
    for (let i = 0; i < sp.backup.length; i++) {
      const pt = sp.backup[i]!;
      if (Math.hypot(pt.x - x, pt.y - y) <= r) return { team, role: "backup", index: i };
    }
  }
  return undefined;
}

export function moveSpawn(
  state: EditorState,
  team: "blue" | "red",
  role: "main" | "backup",
  index: number,
  x: number,
  y: number
): void {
  const gx = snap(x, state.grid);
  const gy = snap(y, state.grid);
  const pt: SpawnPoint = { x: gx, y: gy };
  if (role === "main") {
    state.doc.spawns[team].main = pt;
    if (state.mirrorLock) {
      const other = team === "blue" ? "red" : "blue";
      state.doc.spawns[other].main = { x: mirrorPointX(gx), y: gy };
    }
  } else {
    state.doc.spawns[team].backup[index] = pt;
    if (state.mirrorLock) {
      const other = team === "blue" ? "red" : "blue";
      state.doc.spawns[other].backup[index] = { x: mirrorPointX(gx), y: gy };
    }
  }
  state.dirty = true;
}

export function addBackupSpawn(state: EditorState, team: "blue" | "red", x: number, y: number): void {
  const pt = { x: snap(x, state.grid), y: snap(y, state.grid) };
  state.doc.spawns[team].backup.push(pt);
  if (state.mirrorLock) {
    const other = team === "blue" ? "red" : "blue";
    state.doc.spawns[other].backup.push({ x: mirrorPointX(pt.x), y: pt.y });
  }
  state.dirty = true;
}

export function selectInRect(
  doc: MapDocument,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): Extract<Selection, { kind: "multi" }> {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  const inRect = (px: number, py: number) => px >= left && px <= right && py >= top && py <= bottom;
  const overlaps = (rx: number, ry: number, rw: number, rh: number) =>
    rx < right && rx + rw > left && ry < bottom && ry + rh > top;

  const platforms = doc.platforms.filter((p) => !p.ground && overlaps(p.x, p.y, p.w, p.h)).map((p) => p.id);
  const walls = doc.walls.filter((w) => overlaps(w.x, w.y, w.w, w.h)).map((w) => w.id);
  const gems = doc.gemSeams.filter((g) => inRect(g.x, g.y)).map((g) => g.id);
  const hoardSlots = allHoardSlots(doc)
    .filter(({ slot }) => overlaps(slot.x, slot.y, SLOT_SIZE, SLOT_SIZE))
    .map(({ slot }) => slot.id);

  return { kind: "multi", platforms, gems, hoardSlots, walls };
}

export function hitTestCow(doc: MapDocument, x: number, y: number): boolean {
  const wp = doc.wyrmPath;
  return Math.hypot(x - W / 2, y - (wp.y - 22)) <= 18;
}

export function hitTestFinishTop(doc: MapDocument, x: number, y: number): boolean {
  const wp = doc.wyrmPath;
  const top = wp.y - wp.finishHeight;
  const onLine = Math.abs(x - wp.left) < 12 || Math.abs(x - wp.right) < 12;
  return onLine && Math.abs(y - top) < 14;
}

export function syncDocGrid(state: EditorState): void {
  state.doc.grid = state.grid;
}

export { CENTER_X, W };
