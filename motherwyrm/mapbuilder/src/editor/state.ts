import { CENTER_X, DEFAULT_SKIN_NAME, HOARD_HEIGHT, HOARD_WIDTH, SLOT_COLS, SLOT_GAP, SLOT_ROW_GAP, SLOT_SIZE, W } from "../constants";
import {
  isOnCenterline,
  mirrorGemSeam,
  mirrorHoard,
  mirrorPlatformX,
  mirrorPointX,
  newId,
  snap,
} from "../schema";
import type { EditorTool, MapDocument, MapGemSeam, MapPlatform, Selection } from "../types";

export type EditorState = {
  doc: MapDocument;
  mirrorLock: boolean;
  tool: EditorTool;
  selection: Selection;
  grid: number;
  dirty: boolean;
};

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

export function partnerPlatform(doc: MapDocument, p: MapPlatform): MapPlatform | undefined {
  if (!p.pairId) return undefined;
  return doc.platforms.find((o) => o.pairId === p.pairId && o.id !== p.id);
}

export function partnerGem(doc: MapDocument, g: MapGemSeam): MapGemSeam | undefined {
  if (!g.pairId) return undefined;
  return doc.gemSeams.find((o) => o.pairId === g.pairId && o.id !== g.id);
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

  const grid = state.grid;
  p.x = snap(x, grid);
  p.y = snap(y, grid);

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

export function addGem(state: EditorState, x: number, y: number): MapGemSeam {
  const gem: MapGemSeam = {
    id: newId("gem"),
    x: snap(x, state.grid),
    y: snap(y, state.grid),
  };

  if (state.mirrorLock && gem.x !== mirrorPointX(gem.x)) {
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
  return gem;
}

export function moveGem(state: EditorState, id: string, x: number, y: number): void {
  const g = findGem(state.doc, id);
  if (!g) return;

  g.x = snap(x, state.grid);
  g.y = snap(y, state.grid);

  if (state.mirrorLock && g.pairId) {
    const mate = partnerGem(state.doc, g);
    if (mate) {
      mate.x = mirrorPointX(g.x);
      mate.y = g.y;
    }
  }

  state.dirty = true;
}

export function setHoardAnchor(state: EditorState, team: "blue" | "red", x: number, y: number): void {
  const anchor = { x: snap(x, state.grid), y: snap(y, state.grid) };
  state.doc.hoardSlots[team] = [anchor];

  if (state.mirrorLock) {
    const other = team === "blue" ? "red" : "blue";
    state.doc.hoardSlots[other] = [mirrorHoard(anchor)];
  }

  state.dirty = true;
  state.selection = { kind: "hoard", team };
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

/** Hoard slot grid rects for drawing. */
export function hoardSlotRects(team: "blue" | "red", doc: MapDocument) {
  const anchor = doc.hoardSlots[team][0];
  if (!anchor) return [];
  const rects: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (let i = 0; i < 16; i++) {
    const col = i % SLOT_COLS;
    const row = Math.floor(i / SLOT_COLS);
    rects.push({
      x: anchor.x + col * (SLOT_SIZE + SLOT_GAP),
      y: anchor.y + row * (SLOT_ROW_GAP + SLOT_SIZE),
      w: SLOT_SIZE,
      h: SLOT_SIZE,
    });
  }
  return rects;
}

export function hitTestPlatform(doc: MapDocument, x: number, y: number): MapPlatform | undefined {
  for (let i = doc.platforms.length - 1; i >= 0; i--) {
    const p = doc.platforms[i];
    if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return p;
  }
  return undefined;
}

export function hitTestGem(doc: MapDocument, x: number, y: number, r = 12): MapGemSeam | undefined {
  for (let i = doc.gemSeams.length - 1; i >= 0; i--) {
    const g = doc.gemSeams[i];
    if (Math.hypot(g.x - x, g.y - y) <= r) return g;
  }
  return undefined;
}

export function hitTestHoard(doc: MapDocument, x: number, y: number): "blue" | "red" | undefined {
  for (const team of ["blue", "red"] as const) {
    const anchor = doc.hoardSlots[team][0];
    if (!anchor) continue;
    if (
      x >= anchor.x &&
      x <= anchor.x + HOARD_WIDTH &&
      y >= anchor.y &&
      y <= anchor.y + HOARD_HEIGHT
    ) {
      return team;
    }
  }
  return undefined;
}

export function syncDocGrid(state: EditorState): void {
  state.doc.grid = state.grid;
}

/** Centerline guide x. */
export { CENTER_X, W };
