import { CENTER_X, GEM_RADIUS, GEM_RUBY, GEM_RUBY_LIT, H, SLOT_SIZE, W } from "../constants";
import { drawJumpArc } from "../jump-arc";
import { mirrorPointX, snapGem } from "../schema";
import { resolvePalette } from "../schema";
import { drawPlatformCap } from "../platform-tile";
import { allHoardSlots, gemHoverBlocked, type EditorState } from "./state";
import type { MapSpriteSlot, Selection } from "../types";
import {
  displayHeightForSpriteSlot,
  drawSpriteAtFeet,
  ensureSpriteLoaded,
  getCachedSprite,
  MOTHER_PREVIEW_SLOT,
  resolveSpriteDrawSpec,
} from "../sprites";

export type ViewTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

export function fitTransform(
  canvasW: number,
  canvasH: number,
  worldW: number,
  worldH: number,
  options?: { pad?: number; maxScale?: number }
): ViewTransform {
  const pad = options?.pad ?? 40;
  const maxScale = options?.maxScale ?? Infinity;
  const scale = Math.max(
    0.05,
    Math.min(
      (canvasW - pad * 2) / worldW,
      (canvasH - pad * 2) / worldH,
      maxScale
    )
  );
  return {
    scale,
    offsetX: (canvasW - worldW * scale) / 2,
    offsetY: (canvasH - worldH * scale) / 2,
  };
}

export function defaultTransform(canvasW: number, canvasH: number): ViewTransform {
  return fitTransform(canvasW, canvasH, W, H, { maxScale: 1 });
}

/** Map a DOM pointer to canvas backing-store pixels (handles CSS scaling). */
export function canvasPointer(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number
): { sx: number; sy: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    sx: ((clientX - rect.left) / rect.width) * canvas.width,
    sy: ((clientY - rect.top) / rect.height) * canvas.height,
  };
}

export function screenToWorld(v: ViewTransform, sx: number, sy: number): { x: number; y: number } {
  return {
    x: (sx - v.offsetX) / v.scale,
    y: (sy - v.offsetY) / v.scale,
  };
}

export type DrawPreview =
  | { kind: "platform" | "wall"; x: number; y: number; w: number; h: number }
  | { kind: "boxSelect"; x0: number; y0: number; x1: number; y1: number }
  | null;

function isSelected(selection: Selection, kind: "platform" | "gem" | "hoardSlot" | "wall", id: string): boolean {
  if (!selection) return false;
  if (selection.kind === "multi") {
    if (kind === "platform") return selection.platforms.includes(id);
    if (kind === "gem") return selection.gems.includes(id);
    if (kind === "hoardSlot") return selection.hoardSlots.includes(id);
    return selection.walls.includes(id);
  }
  if (selection.kind !== kind) return false;
  return selection.ids.includes(id);
}

export function renderArena(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  v: ViewTransform,
  canvasW: number,
  canvasH: number,
  selection: Selection,
  hover: { x: number; y: number } | null,
  preview: DrawPreview,
  onSpriteLoad?: () => void
): void {
  ctx.save();
  ctx.fillStyle = "#121018";
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.translate(v.offsetX, v.offsetY);
  ctx.scale(v.scale, v.scale);

  if (!drawBackgroundScenery(ctx, state, onSpriteLoad)) {
    ctx.fillStyle = "#171016";
    ctx.fillRect(0, 0, W, H);
  }

  drawGrid(ctx, state.doc.grid);

  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(CENTER_X, 0);
  ctx.lineTo(CENTER_X, H);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const p of state.doc.platforms) {
    const pal = resolvePalette(p);
    const sel = isSelected(selection, "platform", p.id);
    drawWrappedPlatform(ctx, p.x, p.y, p.w, p.h, pal);
    if (sel) {
      ctx.strokeStyle = "#f2c063";
      ctx.lineWidth = 2;
      strokeWrappedRect(ctx, p.x, p.y, p.w, p.h);
    }
  }

  for (const wall of state.doc.walls) {
    const sel = isSelected(selection, "wall", wall.id);
    ctx.fillStyle = sel ? "#6b5a4a" : "#3d3228";
    ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
    ctx.strokeStyle = sel ? "#f2c063" : "#8b7a66";
    ctx.lineWidth = sel ? 2 : 1;
    ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);
  }

  for (const { slot, team } of allHoardSlots(state.doc)) {
    const color = team === "blue" ? "#4aa3d8" : "#e0663f";
    const sel = isSelected(selection, "hoardSlot", slot.id);
    ctx.fillStyle = sel ? color : `${color}44`;
    ctx.fillRect(slot.x, slot.y, SLOT_SIZE, SLOT_SIZE);
    ctx.strokeStyle = color;
    ctx.lineWidth = sel ? 2 : 1;
    ctx.strokeRect(slot.x, slot.y, SLOT_SIZE, SLOT_SIZE);
  }

  for (const g of state.doc.gemSeams) {
    drawRubyGem(ctx, g.x, g.y, isSelected(selection, "gem", g.id));
  }

  drawSpawnMarkers(ctx, state, selection, onSpriteLoad);

  const wp = state.doc.wyrmPath;
  const top = wp.y - wp.finishHeight;
  const bottom = wp.y;

  ctx.lineWidth = 3;
  ctx.strokeStyle = "#4aa3d8";
  ctx.beginPath();
  ctx.moveTo(wp.left, top);
  ctx.lineTo(wp.left, bottom);
  ctx.stroke();
  ctx.strokeStyle = "#e0663f";
  ctx.beginPath();
  ctx.moveTo(wp.right, top);
  ctx.lineTo(wp.right, bottom);
  ctx.stroke();

  if (selection?.kind === "wyrmFinish") {
    ctx.fillStyle = "#f2c063";
    ctx.fillRect(wp.left - 6, top - 6, 12, 12);
    ctx.fillRect(wp.right - 6, top - 6, 12, 12);
  }

  const cowSel = selection?.kind === "wyrmCow";
  const cowH = displayHeightForSpriteSlot("wyrm");
  const cowFeetY = wp.y;
  drawMapSprite(ctx, state, "wyrm", W / 2, cowFeetY, onSpriteLoad, cowH);
  if (cowSel) {
    ctx.strokeStyle = "#f2c063";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(W / 2, cowFeetY - cowH / 2, cowH / 2 + 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  const showArc =
    (state.tool === "platform" && (preview?.kind === "platform" || (hover && !preview)))
    || (selection?.kind === "platform" && selection.ids.length === 1);
  if (showArc) {
    let plat: { x: number; y: number; w: number; h: number };
    if (preview?.kind === "platform") {
      plat = preview;
    } else if (state.tool === "select" && selection?.kind === "platform") {
      const sel = state.doc.platforms.find((p) => p.id === selection.ids[0]);
      if (!sel) plat = { x: hover!.x, y: hover!.y, w: 96, h: 16 };
      else plat = sel;
    } else {
      plat = { x: hover!.x, y: hover!.y, w: 96, h: 16 };
    }
    const platformRects = state.doc.platforms.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h }));
    const groundFeetY = state.doc.wyrmPath.y - 24;
    drawJumpArc(ctx, plat, platformRects, groundFeetY, W);
  }

  if (preview?.kind === "platform" || preview?.kind === "wall") {
    ctx.strokeStyle = preview.kind === "wall" ? "rgba(139,122,102,0.9)" : "rgba(242,192,99,0.85)";
    ctx.lineWidth = 1;
    ctx.strokeRect(preview.x, preview.y, preview.w, preview.h);
  } else if (hover && state.tool === "platform") {
    ctx.strokeStyle = "rgba(242,192,99,0.5)";
    ctx.strokeRect(hover.x, hover.y, 96, 16);
  } else if (hover && state.tool === "wall") {
    ctx.strokeStyle = "rgba(139,122,102,0.55)";
    ctx.strokeRect(hover.x, hover.y, 16, 120);
  }

  if (preview?.kind === "boxSelect") {
    const x = Math.min(preview.x0, preview.x1);
    const y = Math.min(preview.y0, preview.y1);
    const w = Math.abs(preview.x1 - preview.x0);
    const h = Math.abs(preview.y1 - preview.y0);
    ctx.strokeStyle = "rgba(127,227,196,0.85)";
    ctx.fillStyle = "rgba(127,227,196,0.08)";
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }

  if (hover && state.tool === "gem") {
    const gx = snapGem(hover.x, state.doc.grid);
    const gy = snapGem(hover.y, state.doc.grid);
    const blocked = gemHoverBlocked(state, hover.x, hover.y);
    drawRubyGem(ctx, gx, gy, false, true, blocked ? "blocked" : "ok");
    if (state.mirrorLock && gx !== mirrorPointX(gx)) {
      drawRubyGem(ctx, mirrorPointX(gx), gy, false, true, blocked ? "blocked" : "mirror");
    }
  }

  ctx.restore();
}

function drawSpawnMarkers(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  selection: Selection,
  onSpriteLoad?: () => void
): void {
  for (const team of ["blue", "red"] as const) {
    const color = team === "blue" ? "#4aa3d8" : "#e0663f";
    const sp = state.doc.spawns[team];
    const motherSlot = MOTHER_PREVIEW_SLOT[team];
    const whelpSlot: MapSpriteSlot = team === "blue" ? "whelp_blue" : "whelp_red";
    const mainSel =
      selection?.kind === "spawn" && selection.team === team && selection.role === "main";
    drawSpawnCharacter(ctx, state, motherSlot, sp.main.x, sp.main.y, color, mainSel, "M", onSpriteLoad);

    sp.backup.forEach((pt, i) => {
      const sel =
        selection?.kind === "spawn" && selection.team === team && selection.role === "backup" && selection.index === i;
      drawSpawnCharacter(ctx, state, whelpSlot, pt.x, pt.y, color, sel, String(i + 1), onSpriteLoad);
    });
  }
}

function drawBackgroundScenery(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  onSpriteLoad?: () => void
): boolean {
  const spec = resolveSpriteDrawSpec(state.doc, "background", state.spritePreviews);
  if (!spec.url) return false;
  let img = getCachedSprite(spec);
  if (!img) {
    ensureSpriteLoaded(spec, () => onSpriteLoad?.());
    return false;
  }
  const scale = Math.max(W / img.width, H / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  return true;
}

function drawMapSprite(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  slot: MapSpriteSlot,
  x: number,
  y: number,
  onSpriteLoad?: () => void,
  targetH = displayHeightForSpriteSlot(slot)
): boolean {
  const spec = resolveSpriteDrawSpec(state.doc, slot, state.spritePreviews);
  let img = getCachedSprite(spec);
  if (!img) {
    ensureSpriteLoaded(spec, () => onSpriteLoad?.());
    return false;
  }
  drawSpriteAtFeet(ctx, spec, img, x, y, targetH, slot);
  return true;
}

function drawSpawnCharacter(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  slot: MapSpriteSlot,
  x: number,
  y: number,
  color: string,
  sel: boolean,
  label: string,
  onSpriteLoad?: () => void,
  targetH = displayHeightForSpriteSlot(slot)
): void {
  const drew = drawMapSprite(ctx, state, slot, x, y, onSpriteLoad, sel ? targetH * 1.04 : targetH);
  if (!drew) {
    drawSpawnDot(ctx, x, y, color, sel, label);
    return;
  }
  if (sel) {
    ctx.strokeStyle = "#f2c063";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = "#171016";
  ctx.font = "bold 9px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y + 14);
}

function drawSpawnDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  sel: boolean,
  label: string
): void {
  ctx.beginPath();
  ctx.arc(x, y, sel ? 10 : 8, 0, Math.PI * 2);
  ctx.fillStyle = sel ? color : `${color}88`;
  ctx.fill();
  ctx.strokeStyle = sel ? "#f2c063" : color;
  ctx.lineWidth = sel ? 2 : 1;
  ctx.stroke();
  ctx.fillStyle = "#171016";
  ctx.font = "bold 9px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y);
}

function drawRubyGem(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  sel: boolean,
  ghost = false,
  ghostKind: "ok" | "mirror" | "blocked" = "ok"
): void {
  const r = GEM_RADIUS;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = ghost ? (ghostKind === "mirror" ? 0.35 : 0.55) : 1;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.85, 0);
  ctx.lineTo(0, r * 1.1);
  ctx.lineTo(-r * 0.85, 0);
  ctx.closePath();
  if (ghost && ghostKind === "blocked") {
    ctx.fillStyle = "rgba(180,60,60,0.5)";
    ctx.strokeStyle = "#e0663f";
  } else {
    ctx.fillStyle = sel ? GEM_RUBY_LIT : GEM_RUBY;
    ctx.strokeStyle = sel ? "#fff" : "#8b1538";
  }
  ctx.fill();
  ctx.lineWidth = sel ? 2 : 1;
  ctx.stroke();
  ctx.restore();
}

function wrappedPlatformXs(x: number, w: number): number[] {
  const xs = [x];
  if (x < 0) xs.push(x + W);
  if (x + w > W) xs.push(x - W);
  return xs;
}

function drawWrappedPlatform(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  pal: ReturnType<typeof resolvePalette>
): void {
  for (const px of wrappedPlatformXs(x, w)) {
    drawPlatformCap(ctx, px, y, w, h, pal);
  }
}

function strokeWrappedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  for (const px of wrappedPlatformXs(x, w)) {
    ctx.strokeRect(px - 1, y - 1, w + 2, h + 2);
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, grid: number): void {
  if (grid <= 0) return;
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += grid) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += grid) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
}
