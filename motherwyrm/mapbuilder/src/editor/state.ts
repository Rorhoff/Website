import {
  CENTER_X,
  DEFAULT_SKIN_NAME,
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
  snap,
  snapGem,
} from "../schema";
import type { EditorState, MapDocument, MapGemSeam, MapHoardSlot, MapPlatform, Selection } from "../types";

export type { EditorState, Selection };

export function createEditorState(doc: MapDocument): EditorState {
  return {
    doc,
    mirrorLock: true,
    tool: "select",
    selection: null,
    grid: doc.grid,
    dirty: false,
  };
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

  if (state.mirrorLock && !isOnCenterline(plat.x, plat.w)) {
    const pairId = newId("pair");
    plat.pairId = pairId;
    const mirror: MapPlatform = {
      ...plat,
      id: newId("plat"),
      x: mirrorPlatformX(plat.x, plat.w),
      pairId,
    };
    state.doc.platforms.push(plat, mirror);
  } else {
    state.doc.platforms.push(plat);
  }

  state.dirty = true;
  state.selection = { kind: "platform", id: plat.id };
  return plat;
}

export function movePlatform(state: EditorState, id: string, x: number, y: number): void {
  const p = findPlatform(state.doc, id);
  if (!p || p.ground) return;

  p.x = snap(x, state.grid);
  p.y = snap(y, state.grid);

  if (state.mirrorLock && p.pairId) {
    const mate = partnerPlatform(state.doc, p);
    if (mate) {
      mate.x = mirrorPlatformX(p.x, p.w);
      mate.y = p.y;
      mate.w = p.w;
      mate.h = p.h;
    }
  }

  state.dirty = true;
}

export function resizePlatform(state: EditorState, id: string, w: number, h: number): void {
  const p = findPlatform(state.doc, id);
  if (!p || p.ground) return;

  p.w = Math.max(8, snap(w, state.grid));
  p.h = Math.max(4, snap(h, state.grid));

  if (state.mirrorLock && p.pairId) {
    const mate = partnerPlatform(state.doc, p);
    if (mate) {
      mate.w = p.w;
      mate.h = p.h;
      mate.x = mirrorPlatformX(p.x, p.w);
      mate.y = p.y;
    }
  }

  state.dirty = true;
}

export function deleteSelection(state: EditorState): void {
  const sel = state.selection;
  if (!sel) return;

  if (sel.kind === "platform") {
    const p = findPlatform(state.doc, sel.id);
    if (!p || p.ground) return;
    const ids = new Set([p.id]);
    const mate = partnerPlatform(state.doc, p);
    if (mate) ids.add(mate.id);
    state.doc.platforms = state.doc.platforms.filter((o) => !ids.has(o.id));
  } else if (sel.kind === "gem") {
    const g = findGem(state.doc, sel.id);
    if (!g) return;
    const ids = new Set([g.id]);
    const mate = partnerGem(state.doc, g);
    if (mate) ids.add(mate.id);
    state.doc.gemSeams = state.doc.gemSeams.filter((o) => !ids.has(o.id));
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
  const gx = snapGem(x);
  const gy = snapGem(y);

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
  state.selection = { kind: "gem", id: gem.id };
  return { ok: true, gem };
}

export function moveGem(state: EditorState, id: string, x: number, y: number): boolean {
  const g = findGem(state.doc, id);
  if (!g) return false;

  const gx = snapGem(x);
  const gy = snapGem(y);

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
  const gx = snapGem(x);
  const gy = snapGem(y);
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

export function setPlatformSkin(state: EditorState, id: string, skin: string): void {
  const p = findPlatform(state.doc, id);
  if (!p) return;
  p.skin = skin;
  delete p.palette;
  state.dirty = true;
}

export function setPlatformPalette(state: EditorState, id: string, palette: MapPlatform["palette"]): void {
  const p = findPlatform(state.doc, id);
  if (!p || !palette) return;
  p.palette = { ...palette };
  p.skin = undefined;
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
