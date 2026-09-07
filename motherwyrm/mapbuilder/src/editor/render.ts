import { CENTER_X, GEM_RADIUS, GEM_RUBY, GEM_RUBY_LIT, H, SLOT_SIZE, W } from "../constants";
import { drawJumpArc } from "../jump-arc";
import { mirrorPointX } from "../schema";
import { resolvePalette } from "../schema";
import { drawPlatformCap } from "../platform-tile";
import { allHoardSlots, gemHoverBlocked, type EditorState } from "./state";
import type { Selection } from "../types";

export type ViewTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

export function defaultTransform(canvasW: number, canvasH: number): ViewTransform {
  const pad = 40;
  const scale = Math.min((canvasW - pad * 2) / W, (canvasH - pad * 2) / H, 1);
  return {
    scale,
    offsetX: (canvasW - W * scale) / 2,
    offsetY: (canvasH - H * scale) / 2,
  };
}

export function screenToWorld(v: ViewTransform, sx: number, sy: number): { x: number; y: number } {
  return {
    x: (sx - v.offsetX) / v.scale,
    y: (sy - v.offsetY) / v.scale,
  };
}

export type DrawPreview =
  | { kind: "platform"; x: number; y: number; w: number; h: number }
  | null;

export function renderArena(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  v: ViewTransform,
  canvasW: number,
  canvasH: number,
  selection: Selection,
  hover: { x: number; y: number } | null,
  preview: DrawPreview
): void {
  ctx.save();
  ctx.fillStyle = "#121018";
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.translate(v.offsetX, v.offsetY);
  ctx.scale(v.scale, v.scale);

  ctx.fillStyle = "#171016";
  ctx.fillRect(0, 0, W, H);

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
    const sel = selection?.kind === "platform" && selection.id === p.id;
    drawPlatformCap(ctx, p.x, p.y, p.w, p.h, pal);
    if (sel) {
      ctx.strokeStyle = "#f2c063";
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x - 1, p.y - 1, p.w + 2, p.h + 2);
    }
  }

  for (const { slot, team } of allHoardSlots(state.doc)) {
    const color = team === "blue" ? "#4aa3d8" : "#e0663f";
    const sel = selection?.kind === "hoardSlot" && selection.id === slot.id;
    ctx.fillStyle = sel ? color : `${color}44`;
    ctx.fillRect(slot.x, slot.y, SLOT_SIZE, SLOT_SIZE);
    ctx.strokeStyle = color;
    ctx.lineWidth = sel ? 2 : 1;
    ctx.strokeRect(slot.x, slot.y, SLOT_SIZE, SLOT_SIZE);
  }

  for (const g of state.doc.gemSeams) {
    const sel = selection?.kind === "gem" && selection.id === g.id;
    drawRubyGem(ctx, g.x, g.y, sel);
  }

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
  ctx.fillStyle = "#c9a25e";
  ctx.beginPath();
  ctx.arc(W / 2, wp.y - 22, 14, 0, Math.PI * 2);
  ctx.fill();
  if (cowSel) {
    ctx.strokeStyle = "#f2c063";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.fillStyle = "#8b7a66";
  ctx.font = "11px system-ui";
  ctx.fillText("cow — drag vertically", W / 2 - 52, wp.y + 20);
  ctx.fillText("finish top — drag blue/red line tops", wp.left + 8, top - 8);

  const showArc =
    state.tool === "platform" &&
    (preview?.kind === "platform" || (hover && !preview));
  if (showArc) {
    const plat = preview?.kind === "platform" ? preview : { x: hover!.x, y: hover!.y, w: 96, h: 16 };
    const fromX = plat.x + plat.w / 2;
    drawJumpArc(ctx, fromX, plat.y);
  }

  if (preview?.kind === "platform") {
    ctx.strokeStyle = "rgba(242,192,99,0.85)";
    ctx.lineWidth = 1;
    ctx.strokeRect(preview.x, preview.y, preview.w, preview.h);
  } else if (hover && state.tool === "platform") {
    ctx.strokeStyle = "rgba(242,192,99,0.5)";
    ctx.strokeRect(hover.x, hover.y, 96, 16);
  }

  if (hover && state.tool === "gem") {
    const gx = Math.round(hover.x);
    const gy = Math.round(hover.y);
    const blocked = gemHoverBlocked(state, gx, gy);
    drawRubyGem(ctx, gx, gy, false, true, blocked ? "blocked" : "ok");
    if (state.mirrorLock && gx !== mirrorPointX(gx)) {
      drawRubyGem(ctx, mirrorPointX(gx), gy, false, true, blocked ? "blocked" : "mirror");
    }
  }

  ctx.restore();
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
