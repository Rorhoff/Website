/** Wyrm (baby dragon) jump physics — mirrors arena-layout TUNING. */
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

function landingOnPlatform(
  feetX: number,
  feetY: number,
  prevY: number,
  platforms: PlatformRect[]
): PlatformRect | null {
  if (feetY <= prevY) return null;
  for (const p of platforms) {
    const standY = p.y - WHELP_HALF;
    if (feetX >= p.x && feetX <= p.x + p.w && prevY <= standY && feetY >= standY) return p;
  }
  return null;
}

function samePlatform(a: PlatformRect, b: PlatformRect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** Highest standable feet y at feetX on or below ceilingY (larger y = lower on screen). */
export function sourceFeetY(
  feetX: number,
  ceilingY: number,
  platforms: PlatformRect[],
  groundFeetY: number,
  exclude?: PlatformRect
): number {
  let floorTop = Infinity;
  for (const p of platforms) {
    if (exclude && samePlatform(p, exclude)) continue;
    if (feetX < p.x || feetX > p.x + p.w) continue;
    if (p.y >= ceilingY && p.y < floorTop) floorTop = p.y;
  }
  if (floorTop === Infinity) return groundFeetY;
  return floorTop - WHELP_HALF;
}

function arcTailOnLeft(
  targetPlat: PlatformRect,
  arenaW: number,
  jumpArcFromLeft?: boolean
): boolean {
  if (jumpArcFromLeft === true) return true;
  if (jumpArcFromLeft === false) return false;
  const cx = targetPlat.x + targetPlat.w / 2;
  // Auto: platform on the right → approach from the left, and vice versa.
  return cx > arenaW / 2;
}

/** Jump arc from below toward a target platform; tail starts on the chosen side. */
export function jumpArcPoints(
  targetPlat: PlatformRect,
  platforms: PlatformRect[],
  groundFeetY: number,
  arenaW = 1280,
  steps = 240,
  jumpArcFromLeft?: boolean
): Array<{ x: number; y: number }> {
  const tailOnLeft = arcTailOnLeft(targetPlat, arenaW, jumpArcFromLeft);
  const landX = tailOnLeft ? targetPlat.x + targetPlat.w * 0.28 : targetPlat.x + targetPlat.w * 0.72;
  const startX = tailOnLeft ? targetPlat.x - 4 : targetPlat.x + targetPlat.w + 4;
  const startFeetY = sourceFeetY(startX, targetPlat.y, platforms, groundFeetY, targetPlat);

  let x = startX;
  let y = startFeetY;
  let vy = WHELP_JUMP;
  const vx = Math.sign(landX - startX) * WHELP_SPEED || WHELP_SPEED;
  const dt = 1 / 120;
  const out: Array<{ x: number; y: number }> = [{ x, y }];
  let landedOn: PlatformRect | null = null;

  for (let i = 0; i < steps; i++) {
    const prevY = y;
    x += vx * dt;
    vy += GRAVITY * dt;
    y += vy * dt;
    out.push({ x, y });
    landedOn = landingOnPlatform(x, y, prevY, platforms);
    if (landedOn) break;
    if (y > 820 || x < -40 || x > arenaW + 40) break;
    if (vy > 0 && y >= startFeetY + 8 && i > 12) break;
  }
  return out;
}

export function jumpReachable(
  targetPlat: PlatformRect,
  platforms: PlatformRect[],
  groundFeetY: number,
  arenaW = 1280,
  jumpArcFromLeft?: boolean
): boolean {
  const tailOnLeft = arcTailOnLeft(targetPlat, arenaW, jumpArcFromLeft);
  const startX = tailOnLeft ? targetPlat.x - 4 : targetPlat.x + targetPlat.w + 4;
  const startFeetY = sourceFeetY(startX, targetPlat.y, platforms, groundFeetY, targetPlat);
  const landFeetY = targetPlat.y - WHELP_HALF;
  return landFeetY >= startFeetY - maxJumpRise();
}

export function drawJumpArc(
  ctx: CanvasRenderingContext2D,
  plat: PlatformRect,
  platforms: PlatformRect[],
  groundFeetY: number,
  arenaW = 1280,
  jumpArcFromLeft?: boolean
): void {
  const reachable = jumpReachable(plat, platforms, groundFeetY, arenaW, jumpArcFromLeft);
  const pts = jumpArcPoints(plat, platforms, groundFeetY, arenaW, 240, jumpArcFromLeft);
  if (pts.length < 2) return;

  const stroke = reachable ? "rgba(127, 227, 196, 0.9)" : "rgba(224, 102, 63, 0.85)";
  const fill = reachable ? "rgba(127, 227, 196, 0.35)" : "rgba(224, 102, 63, 0.35)";

  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
  ctx.stroke();

  const start = pts[0]!;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(start.x, start.y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();

  const peak = pts.reduce((best, p) => (p.y < best.y ? p : best), pts[0]!);
  const rise = Math.round(maxJumpRise());
  ctx.fillStyle = stroke;
  ctx.font = "10px system-ui";
  ctx.fillText(`wyrm peak ~${rise}px`, peak.x + 8, peak.y - 6);
  ctx.fillText(reachable ? "reachable" : "too high", plat.x + plat.w / 2 - 24, plat.y - 10);
  ctx.restore();
}
