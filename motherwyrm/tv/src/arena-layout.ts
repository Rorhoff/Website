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
  motherHp: 1,
  motherDeathsToWin: 4,
  motherRespawnMs: 3000,
  motherInvulnMs: 2000,

  whelpRespawnMs: 2500,
  whelpInvulnMs: 1500,
  spawnCampRadius: 180,

  diveSpeed: 820,
  motherShortDiveSpeed: 720,
  motherShortDiveMs: 380,
  motherLungeSpeed: 680,
  motherLungeMs: 220,
  motherClashRecoil: 300,
  /** Melee connect / parry radius for mother claws. */
  motherClashReach: 68,
  swipeReach: 88,
  swipeMs: 180,
  stunMs: 1200,
  eatenMs: 2200,

  puntWindowMs: 150,
  puntReach: 54,
  puntPower: 520,
  throwPower: 440,
  carryMax: 1,

  wyrmSpeed: 120,
  wyrmWin: { blue: W - 60, red: 60 },

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
  // Stepping stones to reach upper gems
  [120, 580, 140, 16],
  [1020, 580, 140, 16],
  [210, 495, 130, 16],
  [940, 495, 130, 16],
  [330, 365, 120, 16],
  [830, 365, 120, 16],
  [500, 570, 280, 16],
  [530, 470, 220, 16],
];

export const SLOT_SIZE = 22;
export const SLOT_GAP = 8;
export const SLOT_ROW_GAP = 10;
export const SLOT_COLS = 8;
export const SLOT_ROWS = 2;
export const HOARD_Y = 536;
export const HOARD_WIDTH = SLOT_COLS * (SLOT_SIZE + SLOT_GAP) - SLOT_GAP;
export const HOARD_HEIGHT = SLOT_ROWS * SLOT_SIZE + (SLOT_ROWS - 1) * SLOT_ROW_GAP;
export const HOARD_X: Record<Team, number> = {
  blue: 70,
  red: W - 70 - HOARD_WIDTH,
};

/** 15 left-side clusters mirrored → 30 fixed gems (no respawn). */
export const GEM_SPAWNS: [number, number][] = (() => {
  const left: [number, number][] = [
    [250, 390], [305, 390], [340, 390], [395, 390],
    [130, 225], [180, 225], [230, 225],
    [540, 290], [580, 290], [620, 290],
    [180, 650], [280, 650], [380, 650], [480, 650], [580, 650],
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

  const blueHoardCenter = HOARD_X.blue + HOARD_WIDTH / 2;
  const redHoardCenter = HOARD_X.red + HOARD_WIDTH / 2;
  if (Math.abs(blueHoardCenter - (W - redHoardCenter)) > 0.5) {
    errors.push("hoard centers are not mirrored");
  }

  if (SPAWN.blue.x !== W - SPAWN.red.x) {
    errors.push("team spawns are not mirrored on x");
  }

  return { ok: errors.length === 0, errors };
}

export function slotRect(team: Team, i: number) {
  const col = i % SLOT_COLS;
  const row = Math.floor(i / SLOT_COLS);
  return {
    x: HOARD_X[team] + col * (SLOT_SIZE + SLOT_GAP),
    y: HOARD_Y + row * (SLOT_SIZE + SLOT_ROW_GAP),
    width: SLOT_SIZE,
    height: SLOT_SIZE,
  };
}
