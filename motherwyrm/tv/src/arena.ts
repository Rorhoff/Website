import Phaser from "phaser";
import {
  COLORS,
  TUNING,
  slotRect as layoutSlotRect,
  type Team,
} from "./arena-layout";

export {
  W,
  H,
  COLORS,
  TUNING,
  PLATFORMS,
  GEM_SPAWNS,
  SPAWN,
  SLOT_SIZE,
  SLOT_GAP,
  SLOT_ROW_GAP,
  SLOT_COLS,
  SLOT_ROWS,
  HOARD_X,
  HOARD_Y,
  HOARD_WIDTH,
  HOARD_HEIGHT,
  assertArenaSymmetry,
  type Team,
} from "./arena-layout";

export function slotRect(team: Team, i: number) {
  const r = layoutSlotRect(team, i);
  return new Phaser.Geom.Rectangle(r.x, r.y, r.width, r.height);
}

/**
 * Procedural sprite fallbacks — permanent, used when atlases are missing.
 * Silhouette rule: whelps are wingless, the mother is not.
 */
export function buildTextures(scene: Phaser.Scene) {
  for (const key of [
    "whelp-blue",
    "whelp-red",
    "mother-blue",
    "mother-red",
    "gem",
    "wyrm-seg",
  ]) {
    buildProceduralTexture(scene, key);
  }
}

export function buildProceduralTexture(scene: Phaser.Scene, key: string) {
  if (scene.textures.exists(key)) return;

  const g = scene.make.graphics({ x: 0, y: 0 }, false);

  if (key === "whelp-blue" || key === "whelp-red") {
    const hide = key === "whelp-blue" ? COLORS.blue : COLORS.red;
    drawWhelp(g, key, 36, 34, hide);
  } else if (key === "mother-blue" || key === "mother-red") {
    const hide = key === "mother-blue" ? COLORS.blue : COLORS.red;
    drawMother(g, key, 54, 52, hide);
  } else if (key === "gem") {
    drawGem(g);
  } else if (key === "wyrm-seg") {
    drawWyrmSeg(g);
  }

  g.destroy();
}

function drawWhelp(
  g: Phaser.GameObjects.Graphics,
  key: string,
  w: number,
  h: number,
  hide: number
) {
  g.clear();
  g.fillStyle(hide, 1);
  g.fillEllipse(w * 0.45, h * 0.62, w * 0.72, h * 0.6);
  g.fillTriangle(w * 0.16, h * 0.6, w * 0.02, h * 0.92, w * 0.3, h * 0.86);
  g.fillEllipse(w * 0.78, h * 0.36, w * 0.42, h * 0.34);
  g.fillTriangle(w * 0.88, h * 0.3, w * 1.0, h * 0.38, w * 0.86, h * 0.46);
  g.fillTriangle(w * 0.68, h * 0.22, w * 0.74, h * 0.06, w * 0.8, h * 0.24);
  g.fillStyle(0x000000, 0.22);
  g.fillEllipse(w * 0.42, h * 0.78, w * 0.6, h * 0.22);
  g.fillStyle(COLORS.bone, 1);
  g.fillCircle(w * 0.83, h * 0.34, w * 0.05);
  g.generateTexture(key, w, h);
}

function drawMother(
  g: Phaser.GameObjects.Graphics,
  key: string,
  w: number,
  h: number,
  hide: number
) {
  g.clear();
  g.fillStyle(hide, 0.55);
  g.fillPoints(
    [
      new Phaser.Geom.Point(w * 0.44, h * 0.5),
      new Phaser.Geom.Point(w * 0.08, h * 0.08),
      new Phaser.Geom.Point(w * 0.2, h * 0.46),
      new Phaser.Geom.Point(w * 0.04, h * 0.4),
    ],
    true
  );
  g.fillStyle(hide, 1);
  g.fillEllipse(w * 0.5, h * 0.62, w * 0.62, h * 0.54);
  g.fillTriangle(w * 0.22, h * 0.62, w * 0.0, h * 0.94, w * 0.34, h * 0.86);
  g.fillEllipse(w * 0.76, h * 0.34, w * 0.38, h * 0.3);
  g.fillTriangle(w * 0.86, h * 0.28, w * 1.0, h * 0.36, w * 0.84, h * 0.44);
  g.fillTriangle(w * 0.66, h * 0.2, w * 0.72, h * 0.02, w * 0.78, h * 0.22);
  g.fillTriangle(w * 0.76, h * 0.2, w * 0.86, h * 0.04, w * 0.88, h * 0.24);
  g.fillPoints(
    [
      new Phaser.Geom.Point(w * 0.52, h * 0.48),
      new Phaser.Geom.Point(w * 0.16, h * 0.0),
      new Phaser.Geom.Point(w * 0.3, h * 0.42),
      new Phaser.Geom.Point(w * 0.12, h * 0.34),
    ],
    true
  );
  g.fillStyle(COLORS.gem, 1);
  g.fillCircle(w * 0.82, h * 0.32, w * 0.045);
  g.generateTexture(key, w, h);
}

function drawGem(g: Phaser.GameObjects.Graphics) {
  g.clear();
  g.fillStyle(COLORS.gem, 1);
  g.fillPoints(
    [
      new Phaser.Geom.Point(9, 0),
      new Phaser.Geom.Point(18, 8),
      new Phaser.Geom.Point(9, 22),
      new Phaser.Geom.Point(0, 8),
    ],
    true
  );
  g.fillStyle(COLORS.gemLit, 0.6);
  g.fillPoints(
    [
      new Phaser.Geom.Point(9, 0),
      new Phaser.Geom.Point(13, 8),
      new Phaser.Geom.Point(9, 22),
    ],
    true
  );
  g.generateTexture("gem", 18, 22);
}

function drawWyrmSeg(g: Phaser.GameObjects.Graphics) {
  g.clear();
  g.fillStyle(COLORS.wyrm, 1);
  g.fillCircle(15, 15, 15);
  g.fillStyle(0x000000, 0.14);
  g.fillCircle(15, 22, 11);
  g.generateTexture("wyrm-seg", 30, 30);
}
