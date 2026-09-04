/** Whelp respawn placement — no Phaser dependency (unit-testable). */

import {
  HOARD_HEIGHT,
  HOARD_WIDTH,
  HOARD_X,
  HOARD_Y,
  W,
  type Team,
} from "./arena-layout";

export function hoardCenter(team: Team): { x: number; y: number } {
  return {
    x: HOARD_X[team] + HOARD_WIDTH / 2,
    y: HOARD_Y + HOARD_HEIGHT / 2,
  };
}

/** Default respawn: dropped just above the team's hoard shelf. */
export function hoardSpawnPoint(team: Team): { x: number; y: number } {
  return {
    x: HOARD_X[team] + HOARD_WIDTH / 2,
    y: HOARD_Y - 40,
  };
}

/** Fallback spawns when the enemy mother is camping the hoard. */
export const WHELP_ALT_SPAWNS: Record<Team, { x: number; y: number }[]> = {
  blue: [
    { x: 420, y: 620 },
    { x: 275, y: 430 },
    { x: 155, y: 340 },
  ],
  red: [
    { x: W - 420, y: 620 },
    { x: W - 275, y: 430 },
    { x: W - 155, y: 340 },
  ],
};

function dist2(ax: number, ay: number, bx: number, by: number) {
  return (ax - bx) ** 2 + (ay - by) ** 2;
}

export function enemyCampingHoard(
  enemyX: number,
  enemyY: number,
  team: Team,
  campRadius: number
): boolean {
  const h = hoardCenter(team);
  return dist2(enemyX, enemyY, h.x, h.y) <= campRadius ** 2;
}

/** Pick hoard spawn unless the enemy mother is near the hoard — then pick the farthest alt. */
export function pickWhelpRespawn(
  team: Team,
  enemyMother: { x: number; y: number } | null,
  campRadius: number
): { x: number; y: number } {
  const hoard = hoardSpawnPoint(team);
  if (
    !enemyMother ||
    !enemyCampingHoard(enemyMother.x, enemyMother.y, team, campRadius)
  ) {
    return hoard;
  }

  let best = WHELP_ALT_SPAWNS[team][0];
  let bestD = -1;
  for (const pt of WHELP_ALT_SPAWNS[team]) {
    const d = dist2(pt.x, pt.y, enemyMother.x, enemyMother.y);
    if (d > bestD) {
      bestD = d;
      best = pt;
    }
  }
  return best;
}

/** True when both mothers' attacks connect — clash (parry), no damage. */
export function mothersClash(
  aHitPoint: { x: number; y: number },
  bPos: { x: number; y: number },
  bHitPoint: { x: number; y: number },
  aPos: { x: number; y: number },
  aAttackDir?: { x: number; y: number },
  bAttackDir?: { x: number; y: number },
  reach = 68
): boolean {
  const reach2 = reach ** 2;
  const bodyDist2 = dist2(aPos.x, aPos.y, bPos.x, bPos.y);
  const closeRange2 = (reach * 2.6) ** 2;

  if (bodyDist2 > closeRange2) return false;

  const aHitsB = dist2(aHitPoint.x, aHitPoint.y, bPos.x, bPos.y) <= reach2;
  const bHitsA = dist2(bHitPoint.x, bHitPoint.y, aPos.x, aPos.y) <= reach2;
  if (aHitsB && bHitsA) return true;

  if (!aAttackDir || !bAttackDir) return false;

  const toB = { x: bPos.x - aPos.x, y: bPos.y - aPos.y };
  const toA = { x: aPos.x - bPos.x, y: aPos.y - bPos.y };
  const bLen = Math.hypot(toB.x, toB.y) || 1;
  const aLen = Math.hypot(toA.x, toA.y) || 1;
  const aToward = (aAttackDir.x * toB.x + aAttackDir.y * toB.y) / bLen;
  const bToward = (bAttackDir.x * toA.x + bAttackDir.y * toA.y) / aLen;
  if (aToward <= 0.2 || bToward <= 0.2) return false;

  // Claws meet between bodies (face-to-face lunge).
  if (dist2(aHitPoint.x, aHitPoint.y, bHitPoint.x, bHitPoint.y) <= reach2 * 2.5) {
    return true;
  }

  // Close range — both lunging toward each other.
  if (bodyDist2 <= (reach * 2.1) ** 2) {
    return true;
  }

  return false;
}
