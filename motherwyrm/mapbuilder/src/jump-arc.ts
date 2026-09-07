/** Whelp jump physics — mirrors arena-layout TUNING. */
export const WHELP_JUMP = -620;
export const WHELP_SPEED = 195;
export const GRAVITY = 1400;
export const WHELP_HALF = 24;

export type PlatformRect = { x: number; y: number; w: number; h: number };

/** Peak rise from a standing jump (px), with safety margin. */
export function maxJumpRise(): number {
  const v = Math.abs(WHELP_JUMP);
  return (v * v) / (2 * GRAVITY) - 8;
}

function landingOnPlatform(feetX: number, feetY: number, prevY: number, platforms: PlatformRect[]): boolean {
  if (feetY <= prevY) return false;
  for (const p of platforms) {
    const standY = p.y - WHELP_HALF;
    if (feetX >= p.x && feetX <= p.x + p.w && prevY <= standY && feetY >= standY) return true;
  }
  return false;
}

/** Horizontal jump arc from a platform lip toward the arena center. */
export function jumpArcPoints(
  plat: PlatformRect,
  platforms: PlatformRect[],
  arenaW = 1280,
  steps = 240
): Array<{ x: number; y: number }> {
  const cx = plat.x + plat.w / 2;
  const towardCenter = cx < arenaW / 2 ? 1 : -1;
  const fromX = towardCenter > 0 ? plat.x + plat.w : plat.x;
  const feetY = plat.y - WHELP_HALF;
  let x = fromX;
  let y = feetY;
  let vy = WHELP_JUMP;
  const vx = towardCenter * WHELP_SPEED;
  const dt = 1 / 120;
  const out: Array<{ x: number; y: number }> = [{ x, y }];

  for (let i = 0; i < steps; i++) {
    const prevY = y;
    x += vx * dt;
    vy += GRAVITY * dt;
    y += vy * dt;
    out.push({ x, y });
    if (landingOnPlatform(x, y, prevY, platforms)) break;
    if (y > 820 || x < -40 || x > arenaW + 40) break;
    if (vy > 0 && y >= feetY + 4 && i > 8) break;
  }
  return out;
}

export function drawJumpArc(
  ctx: CanvasRenderingContext2D,
  plat: PlatformRect,
  platforms: PlatformRect[]
): void {
  const pts = jumpArcPoints(plat, platforms);
  if (pts.length < 2) return;

  ctx.save();
  ctx.strokeStyle = "rgba(224, 102, 63, 0.85)";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.stroke();

  const start = pts[0]!;
  ctx.fillStyle = "rgba(224, 102, 63, 0.35)";
  ctx.beginPath();
  ctx.arc(start.x, start.y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(224, 102, 63, 0.9)";
  ctx.lineWidth = 2;
  ctx.stroke();

  const peak = pts.reduce((best, p) => (p.y < best.y ? p : best), pts[0]!);
  const rise = Math.round((Math.abs(WHELP_JUMP) ** 2) / (2 * GRAVITY));
  ctx.fillStyle = "rgba(224, 102, 63, 0.92)";
  ctx.font = "10px system-ui";
  ctx.fillText(`whelp peak ~${rise}px`, peak.x + 8, peak.y - 6);
  ctx.restore();
}
