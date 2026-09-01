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

/** Default respawn: on the shelf beside the team's gem hoard. */
export function hoardSpawnPoint(team: Team): { x: number; y: number } {
  return {
    x: HOARD_X[team] + HOARD_WIDTH / 2,
    y: HOARD_Y + HOARD_HEIGHT + 40,
  };
}

/** Fallback spawns when the enemy mother is camping the hoard. */
export const WHELP_ALT_SPAWNS: Record<Team, { x: number; y: number }[]> = {
  blue: [
    { x: 640, y: 620 },
    { x: 305, y: 390 },
    { x: 180, y: 225 },
  ],
  red: [
    { x: 640, y: 620 },
    { x: W - 305, y: 390 },
    { x: W - 180, y: 225 },
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

/** True when both mothers' attacks connect — clash, no damage. */
export function mothersClash(
  aHitPoint: { x: number; y: number },
  bPos: { x: number; y: number },
  bHitPoint: { x: number; y: number },
  aPos: { x: number; y: number },
  reach = 52
): boolean {
  const reach2 = reach ** 2;
  const aHitsB = dist2(aHitPoint.x, aHitPoint.y, bPos.x, bPos.y) <= reach2;
  const bHitsA = dist2(bHitPoint.x, bHitPoint.y, aPos.x, aPos.y) <= reach2;
  return aHitsB && bHitsA;
}
