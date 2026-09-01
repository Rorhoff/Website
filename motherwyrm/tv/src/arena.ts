import Phaser from 'phaser';

export const W = 1280;
export const H = 720;

export const COLORS = {
  sky:      0x171016,
  soil:     0x2c2119,
  soilLip:  0x3d2e22,
  blue:     0x4aa3d8,
  red:      0xe0663f,
  gem:      0xf2c063,
  gemLit:   0xfff0c4,
  wyrm:     0xc9a25e,
  bone:     0xefe4d2,
  dim:      0x8b7a66,
};

export const TUNING = {
  gravity:          1400,

  whelpSpeed:       230,
  whelpJump:        -560,

  motherGravity:    780,
  motherSpeed:      210,
  motherThrust:     -300,   // impulse per wingbeat
  motherThrustCap:  -430,   // ceiling, so mashing does not mean infinite altitude
  motherHp:         3,
  motherDeathsToWin: 4,
  motherRespawnMs:  3000,
  motherInvulnMs:   2000,

  diveSpeed:        820,
  swipeReach:       72,
  swipeMs:          180,
  stunMs:           1200,

  puntWindowMs:     150,
  puntReach:        54,
  puntPower:        520,
  throwPower:       440,
  carryMax:         3,

  wyrmSpeed:        120,
  wyrmWin:          { blue: W - 60, red: 60 },

  gemRespawnMs:     5000,
  slotsToWin:       15,
};

export type Team = 'blue' | 'red';

/** Static geometry: [x, y, width, height], all top-left anchored. */
export const PLATFORMS: [number, number, number, number][] = [
  [0, 690, W, 30],          // cavern floor, doubles as the wyrm track
  [200, 430, 210, 16],
  [870, 430, 210, 16],
  [520, 330, 240, 16],
  [90, 265, 180, 16],
  [1010, 265, 180, 16],
];

/** Hoards. 15 slots each, mirrored across the centre line. */
export const SLOT_SIZE = 22;
export const SLOT_GAP = 2;
export const HOARD_Y = 560;
export const HOARD_X: Record<Team, number> = {
  blue: 70,
  red: W - 70 - 15 * (SLOT_SIZE + SLOT_GAP),
};

export function slotRect(team: Team, i: number) {
  return new Phaser.Geom.Rectangle(
    HOARD_X[team] + i * (SLOT_SIZE + SLOT_GAP),
    HOARD_Y,
    SLOT_SIZE,
    SLOT_SIZE
  );
}

/** Symmetric gem seams. Mirrored pairs so neither side gets a shorter run. */
export const GEM_SPAWNS: [number, number][] = (() => {
  const left: [number, number][] = [
    [250, 390], [340, 390],
    [140, 225], [210, 225],
    [430, 650], [560, 650],
    [580, 290],
  ];
  return [...left, ...left.map(([x, y]) => [W - x, y] as [number, number])];
})();

export const SPAWN: Record<Team, { x: number; y: number }> = {
  blue: { x: 150, y: 620 },
  red: { x: W - 150, y: 620 },
};

/**
 * Everything is drawn procedurally so the repo carries no binary assets and
 * Cursor can reason about the whole project as text. Swap these for real
 * sprite sheets later without touching a line of game logic.
 *
 * Silhouette rule: whelps are wingless, the mother is not. That difference
 * has to read at a glance from across a room, because it is the whole game.
 */
export function buildTextures(scene: Phaser.Scene) {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);

  /** Wingless ground drake. Squat, long tail, faces right. */
  const whelp = (key: string, w: number, h: number, hide: number) => {
    g.clear();
    g.fillStyle(hide, 1);
    g.fillEllipse(w * 0.45, h * 0.62, w * 0.72, h * 0.6);
    g.fillTriangle(w * 0.16, h * 0.6, w * 0.02, h * 0.92, w * 0.3, h * 0.86);   // tail
    g.fillEllipse(w * 0.78, h * 0.36, w * 0.42, h * 0.34);                       // head
    g.fillTriangle(w * 0.88, h * 0.3, w * 1.0, h * 0.38, w * 0.86, h * 0.46);    // snout
    g.fillTriangle(w * 0.68, h * 0.22, w * 0.74, h * 0.06, w * 0.8, h * 0.24);   // horn
    g.fillStyle(0x000000, 0.22);
    g.fillEllipse(w * 0.42, h * 0.78, w * 0.6, h * 0.22);                        // belly shade
    g.fillStyle(COLORS.bone, 1);
    g.fillCircle(w * 0.83, h * 0.34, w * 0.05);                                  // eye
    g.generateTexture(key, w, h);
  };

  /** Winged mother. Bigger, and the wings are the tell. */
  const mother = (key: string, w: number, h: number, hide: number) => {
    g.clear();
    g.fillStyle(hide, 0.55);
    g.fillPoints([                                                               // far wing
      new Phaser.Geom.Point(w * 0.44, h * 0.5),
      new Phaser.Geom.Point(w * 0.08, h * 0.08),
      new Phaser.Geom.Point(w * 0.2, h * 0.46),
      new Phaser.Geom.Point(w * 0.04, h * 0.4),
    ], true);
    g.fillStyle(hide, 1);
    g.fillEllipse(w * 0.5, h * 0.62, w * 0.62, h * 0.54);                        // body
    g.fillTriangle(w * 0.22, h * 0.62, w * 0.0, h * 0.94, w * 0.34, h * 0.86);   // tail
    g.fillEllipse(w * 0.76, h * 0.34, w * 0.38, h * 0.3);                        // head
    g.fillTriangle(w * 0.86, h * 0.28, w * 1.0, h * 0.36, w * 0.84, h * 0.44);   // snout
    g.fillTriangle(w * 0.66, h * 0.2, w * 0.72, h * 0.02, w * 0.78, h * 0.22);   // horns
    g.fillTriangle(w * 0.76, h * 0.2, w * 0.86, h * 0.04, w * 0.88, h * 0.24);
    g.fillPoints([                                                               // near wing
      new Phaser.Geom.Point(w * 0.52, h * 0.48),
      new Phaser.Geom.Point(w * 0.16, h * 0.0),
      new Phaser.Geom.Point(w * 0.3, h * 0.42),
      new Phaser.Geom.Point(w * 0.12, h * 0.34),
    ], true);
    g.fillStyle(COLORS.gem, 1);
    g.fillCircle(w * 0.82, h * 0.32, w * 0.045);                                 // eye, lit like a coal
    g.generateTexture(key, w, h);
  };

  whelp('whelp-blue', 36, 34, COLORS.blue);
  whelp('whelp-red', 36, 34, COLORS.red);
  mother('mother-blue', 54, 52, COLORS.blue);
  mother('mother-red', 54, 52, COLORS.red);

  // hoard gem
  g.clear();
  g.fillStyle(COLORS.gem, 1);
  g.fillPoints([
    new Phaser.Geom.Point(9, 0), new Phaser.Geom.Point(18, 8),
    new Phaser.Geom.Point(9, 22), new Phaser.Geom.Point(0, 8),
  ], true);
  g.fillStyle(COLORS.gemLit, 0.6);
  g.fillPoints([
    new Phaser.Geom.Point(9, 0), new Phaser.Geom.Point(13, 8), new Phaser.Geom.Point(9, 22),
  ], true);
  g.generateTexture('gem', 18, 22);

  // wyrm segment
  g.clear();
  g.fillStyle(COLORS.wyrm, 1);
  g.fillCircle(15, 15, 15);
  g.fillStyle(0x000000, 0.14);
  g.fillCircle(15, 22, 11);
  g.generateTexture('wyrm-seg', 30, 30);

  g.destroy();
}
