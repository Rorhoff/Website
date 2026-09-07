/** Whelp jump physics — mirrors arena-layout TUNING. */
export const WHELP_JUMP = -620;
export const GRAVITY = 1400;
export const WHELP_HALF = 24;

/** Peak rise from a standing jump (px), with safety margin. */
export function maxJumpRise(): number {
  const v = Math.abs(WHELP_JUMP);
  return (v * v) / (2 * GRAVITY) - 8;
}

/** Parabolic arc from a whelp standing on a platform lip at fromX. */
export function jumpArcPoints(fromX: number, platformTopY: number, steps = 90): Array<{ x: number; y: number }> {
  const feetY = platformTopY - WHELP_HALF;
  let y = feetY;
  let vy = WHELP_JUMP;
  const dt = 1 / 120;
  const out: Array<{ x: number; y: number }> = [{ x: fromX, y: feetY }];
  for (let i = 0; i < steps; i++) {
    vy += GRAVITY * dt;
    y += vy * dt;
    out.push({ x: fromX, y });
    if (vy > 0 && y >= feetY) break;
  }
  return out;
}

export function drawJumpArc(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  platformTopY: number
): void {
  const pts = jumpArcPoints(fromX, platformTopY);
  ctx.save();
  ctx.strokeStyle = "rgba(74,163,216,0.55)";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.stroke();

  const peak = pts.reduce((best, p) => (p.y < best.y ? p : best), pts[0]!);
  const rise = Math.round(platformTopY - WHELP_HALF - peak.y);
  ctx.fillStyle = "rgba(74,163,216,0.85)";
  ctx.font = "10px system-ui";
  ctx.fillText(`peak ${rise}px`, peak.x + 6, peak.y - 4);
  ctx.restore();
}
