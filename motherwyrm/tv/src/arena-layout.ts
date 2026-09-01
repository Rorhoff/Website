/** Arena geometry and tuning — no Phaser dependency (safe for unit tests). */

export const W = 1280;
export const H = 720;

export const COLORS = {
  sky: 0x171016,
  soil: 0x2c2119,
  soilLip: 0x3d2e22,
  blue: 0x4aa3d8,
  red: 0xe0663f,
  gem: 0xf2c063,
  gemLit: 0xfff0c4,
  wyrm: 0xc9a25e,
  bone: 0xefe4d2,
  dim: 0x8b7a66,
};

export const TUNING = {
  gravity: 1400,

  whelpSpeed: 230,
  whelpJump: -560,

  motherGravity: 780,
  motherSpeed: 210,
  motherThrust: -300,
  motherThrustCap: -430,
  motherHp: 3,
  motherDeathsToWin: 4,
  motherRespawnMs: 3000,
  motherInvulnMs: 2000,

  diveSpeed: 820,
  motherShortDiveSpeed: 720,
  motherShortDiveMs: 380,
  motherLungeSpeed: 520,
  motherLungeMs: 160,
  motherClashRecoil: 300,
  swipeReach: 72,
  swipeMs: 180,
  stunMs: 1200,

  puntWindowMs: 150,
  puntReach: 54,
  puntPower: 520,
  throwPower: 440,
  carryMax: 1,

  wyrmSpeed: 120,
  wyrmWin: { blue: W - 60, red: 60 },

  gemRespawnMs: 5000,
  slotsToWin: 15,
};

export type Team = "blue" | "red";

export const PLATFORMS: [number, number, number, number][] = [
  [0, 690, W, 30],
  [200, 430, 210, 16],
  [870, 430, 210, 16],
  [520, 330, 240, 16],
  [90, 265, 180, 16],
  [1010, 265, 180, 16],
];

export const SLOT_SIZE = 22;
export const SLOT_GAP = 2;
export const HOARD_Y = 560;
export const HOARD_X: Record<Team, number> = {
  blue: 70,
  red: W - 70 - 15 * (SLOT_SIZE + SLOT_GAP),
};

export const GEM_SPAWNS: [number, number][] = (() => {
  const left: [number, number][] = [
    [250, 390],
    [340, 390],
    [140, 225],
    [210, 225],
    [430, 650],
    [560, 650],
    [580, 290],
  ];
  return [...left, ...left.map(([x, y]) => [W - x, y] as [number, number])];
})();

export const SPAWN: Record<Team, { x: number; y: number }> = {
  blue: { x: 150, y: 620 },
  red: { x: W - 150, y: 620 },
};

/** Assert arena geometry mirrors left/right. Used by QA tests. */
export function assertArenaSymmetry(): { ok: boolean; errors: string[] } {
  const errors: string[] = [];

  for (let i = 1; i < PLATFORMS.length; i++) {
    const [x, y, pw, ph] = PLATFORMS[i];
    const mirrorX = W - x - pw;
    if (mirrorX === x) continue; // centered platform mirrors to itself
    const pair = PLATFORMS.find(
      ([ox, oy, ow, oh], j) =>
        j !== i && j > 0 && ox === mirrorX && oy === y && ow === pw && oh === ph
    );
    if (!pair) {
      errors.push(`platform ${i} at [${x},${y}] has no mirror at x=${mirrorX}`);
    }
  }

  const leftSpawns = GEM_SPAWNS.filter(([x]) => x < W / 2);
  for (const [x, y] of leftSpawns) {
    const mx = W - x;
    if (!GEM_SPAWNS.some(([gx, gy]) => gx === mx && gy === y)) {
      errors.push(`gem spawn [${x},${y}] missing mirror at [${mx},${y}]`);
    }
  }

  const blueHoardCenter = HOARD_X.blue + (TUNING.slotsToWin * (SLOT_SIZE + SLOT_GAP)) / 2;
  const redHoardCenter = HOARD_X.red + (TUNING.slotsToWin * (SLOT_SIZE + SLOT_GAP)) / 2;
  if (Math.abs(blueHoardCenter - (W - redHoardCenter)) > 0.5) {
    errors.push("hoard centers are not mirrored");
  }

  if (SPAWN.blue.x !== W - SPAWN.red.x) {
    errors.push("team spawns are not mirrored on x");
  }

  return { ok: errors.length === 0, errors };
}

export function slotRect(team: Team, i: number) {
  return {
    x: HOARD_X[team] + i * (SLOT_SIZE + SLOT_GAP),
    y: HOARD_Y,
    width: SLOT_SIZE,
    height: SLOT_SIZE,
  };
}
