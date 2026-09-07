import { CENTER_X, H, W } from "../constants";
import { resolvePalette } from "../schema";
import { drawPlatformCap } from "../platform-tile";
import { hoardSlotRects, type EditorState } from "./state";
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

export function renderArena(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  v: ViewTransform,
  canvasW: number,
  canvasH: number,
  selection: Selection,
  hover: { x: number; y: number } | null
): void {
  ctx.save();
  ctx.fillStyle = "#121018";
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.translate(v.offsetX, v.offsetY);
  ctx.scale(v.scale, v.scale);

  // Sky
  ctx.fillStyle = "#171016";
  ctx.fillRect(0, 0, W, H);

  // Grid
  drawGrid(ctx, state.doc.grid);

  // Mirror centerline
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(CENTER_X, 0);
  ctx.lineTo(CENTER_X, H);
  ctx.stroke();
  ctx.setLineDash([]);

  // Platforms
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

  // Hoard slots
  for (const team of ["blue", "red"] as const) {
    const color = team === "blue" ? "#4aa3d8" : "#e0663f";
    const sel = selection?.kind === "hoard" && selection.team === team;
    for (const r of hoardSlotRects(team, state.doc)) {
      ctx.fillStyle = sel ? color : `${color}55`;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
    const anchor = state.doc.hoardSlots[team][0];
    if (anchor) {
      ctx.fillStyle = color;
      ctx.font = "11px system-ui";
      ctx.fillText(`${team.toUpperCase()} hoard`, anchor.x, anchor.y - 6);
    }
  }

  // Gem seams
  for (const g of state.doc.gemSeams) {
    const sel = selection?.kind === "gem" && selection.id === g.id;
    ctx.beginPath();
    ctx.arc(g.x, g.y, sel ? 10 : 8, 0, Math.PI * 2);
    ctx.fillStyle = sel ? "#fff0c4" : "#f2c063";
    ctx.fill();
    ctx.strokeStyle = "#c9a25e";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Wyrm path / finish lines
  const wp = state.doc.wyrmPath;
  const top = wp.y - 110;
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

  ctx.fillStyle = "#c9a25e";
  ctx.beginPath();
  ctx.arc(W / 2, wp.y - 22, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#8b7a66";
  ctx.font = "12px system-ui";
  ctx.fillText("cow path", W / 2 - 28, wp.y + 24);

  if (selection?.kind === "wyrm") {
    ctx.strokeStyle = "#f2c063";
    ctx.lineWidth = 2;
    ctx.strokeRect(wp.left - 4, top - 4, 8, bottom - top + 8);
    ctx.strokeRect(wp.right - 4, top - 4, 8, bottom - top + 8);
  }

  // Tool preview
  if (hover && state.tool === "platform") {
    ctx.strokeStyle = "rgba(242,192,99,0.7)";
    ctx.lineWidth = 1;
    ctx.strokeRect(hover.x, hover.y, 96, 16);
  }
  if (hover && state.tool === "gem") {
    ctx.beginPath();
    ctx.arc(hover.x, hover.y, 8, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(242,192,99,0.7)";
    ctx.stroke();
  }

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
