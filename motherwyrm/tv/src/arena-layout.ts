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

  whelpSpeed: 195,
  whelpJump: -620,

  motherGravity: 780,
  motherSpeed: 210,
  motherThrust: -300,
  motherThrustCap: -430,
  motherHp: 1,
  motherDeathsToWin: 4,
  motherRespawnMs: 3000,
  motherInvulnMs: 2000,

  whelpRespawnMs: 1500,
  whelpInvulnMs: 1500,
  spawnCampRadius: 180,

  /** Timed dive burst — same duration as claw lunge, not a fall until landing. */
  motherDiveMs: 220,
  motherDiveSpeed: 680,
  motherShortDiveMs: 220,
  motherShortDiveSpeed: 680,
  /** Cow head-stomp when a whelp walks in front. */
  cowStompDownMs: 180,
  cowStompUpMs: 140,
  cowStompCooldownMs: 500,
  motherLungeSpeed: 680,
  motherLungeMs: 220,
  motherClashRecoil: 300,
  /** Melee connect / parry radius for mother claws. */
  motherClashReach: 68,
  swipeReach: 88,
  swipeMs: 180,
  /** A strike travels this long before it can connect, so kills read as contact. */
  motherAttackWindupMs: 70,
  /** Minimum gap between strikes — stops a held button chaining dives forever. */
  motherAttackCooldownMs: 260,
  /** Cosine of the strike cone half-angle; targets outside the arc are missed. */
  motherStrikeCone: 0.3,
  stunMs: 1200,
  eatenMs: 2200,

  puntWindowMs: 150,
  puntReach: 54,
  puntPower: 520,
  throwPower: 440,
  carryMax: 1,

  /** ~580px center→finish in 20s with one rider pulling. */
  wyrmSpeed: 29,
  wyrmWin: { blue: 60, red: W - 60 },
  /** Top of the ground platform — cow feet sit here. */
  cowGroundY: 690,
  cowFinishHeight: 110,

  slotsToWin: 15,
};

export type Team = "blue" | "red";

export const SLOT_SIZE = 22;
export const SLOT_GAP = 8;
export const SLOT_ROW_GAP = 10;
export const SLOT_COLS = 8;
export const SLOT_ROWS = 2;
export const HOARD_WIDTH = SLOT_COLS * (SLOT_SIZE + SLOT_GAP) - SLOT_GAP;
export const HOARD_HEIGHT = SLOT_ROWS * SLOT_SIZE + (SLOT_ROWS - 1) * SLOT_ROW_GAP;
/** Slots stack directly on top of the hoard shelf platform. */
export const HOARD_SHELF_Y = 592;
export const HOARD_Y = HOARD_SHELF_Y - HOARD_HEIGHT;
export const HOARD_X: Record<Team, number> = {
  blue: 70,
  red: W - 70 - HOARD_WIDTH,
};

/**
 * Outer climbing ladder on each side, a self-mirroring center stack, and open
 * flight corridors at x≈380–500 / 780–900 so a mother can cross any height.
 */
export const PLATFORMS: [number, number, number, number][] = [
  [0, 690, W, 30],
  // Team hoard shelves — the slot grid sits on these.
  [56, HOARD_SHELF_Y, 260, 16],
  [964, HOARD_SHELF_Y, 260, 16],
  // Outer ladders, ~90px rises so a whelp clears each one.
  [200, 490, 150, 16],
  [930, 490, 150, 16],
  [70, 400, 170, 16],
  [1040, 400, 170, 16],
  [210, 310, 170, 16],
  [900, 310, 170, 16],
  [80, 225, 170, 16],
  [1030, 225, 170, 16],
  // Center stack (mirrors onto itself).
  [500, 570, 280, 16],
  [520, 450, 240, 16],
  [560, 330, 160, 16],
];

/** 15 left-side gems mirrored → 30 fixed gems (no respawn). */
export const GEM_SPAWNS: [number, number][] = (() => {
  const left: [number, number][] = [
    [180, 650], [280, 650], [380, 650], [460, 650],
    [230, 468], [275, 468], [320, 468],
    [110, 378], [155, 378], [200, 378],
    [250, 288], [300, 288],
    [120, 203], [165, 203],
    [560, 548],
  ];
  return [...left, ...left.map(([x, y]) => [W - x, y] as [number, number])];
})();

export const SPAWN: Record<Team, { x: number; y: number }> = {
  blue: { x: 110, y: 520 },
  red: { x: W - 110, y: 520 },
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
