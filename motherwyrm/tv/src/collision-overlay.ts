import Phaser from "phaser";
import {
  COLORS,
  GEM_SPAWNS,
  HOARD_X,
  HOARD_Y,
  PLATFORMS,
  SLOT_GAP,
  SLOT_SIZE,
  SPAWN,
  TUNING,
  W,
  H,
  slotRect,
} from "./arena";
import type { Team } from "../net";

const OVERLAY_COLORS = {
  platform: 0x00ff88,
  gem: 0xf2c063,
  hoard: 0x7fe3c4,
  spawn: 0xff66cc,
  wyrm: 0xc9a25e,
};

/** Draw collision / layout rects from arena.ts for art alignment QA. */
export function drawCollisionOverlay(
  g: Phaser.GameObjects.Graphics,
  options?: { backgroundOnly?: boolean }
) {
  g.clear();

  PLATFORMS.forEach(([x, y, w, h], idx) => {
    g.lineStyle(2, OVERLAY_COLORS.platform, idx === 0 ? 0.9 : 0.75);
    g.strokeRect(x, y, w, h);
    if (idx === 0) {
      g.fillStyle(OVERLAY_COLORS.wyrm, 0.15);
      g.fillRect(40, y - 4, W - 80, h + 8);
    }
  });

  GEM_SPAWNS.forEach(([x, y], i) => {
    g.lineStyle(1, OVERLAY_COLORS.gem, 0.85);
    g.strokeCircle(x, y, 14);
    if (i < 7) {
      g.fillStyle(0xffffff, 0.7);
      g.fillCircle(x, y - 18, 3);
    }
  });

  for (const team of ["blue", "red"] as Team[]) {
    for (let i = 0; i < TUNING.slotsToWin; i++) {
      const r = slotRect(team, i);
      g.lineStyle(1, OVERLAY_COLORS.hoard, 0.8);
      g.strokeRect(r.x, r.y, r.width, r.height);
    }
    const spawn = SPAWN[team];
    g.lineStyle(2, OVERLAY_COLORS.spawn, 0.9);
    g.strokeCircle(spawn.x, spawn.y, 22);
  }

  g.lineStyle(1, 0xffffff, 0.35);
  g.lineBetween(W / 2, 0, W / 2, H);

  if (!options?.backgroundOnly) {
    g.fillStyle(0xffffff, 0.55);
    g.fillRect(8, 8, 280, 72);
  }
}

export function overlayLegend(scene: Phaser.Scene): Phaser.GameObjects.Text {
  return scene.add
    .text(
      16,
      12,
      [
        "Collision overlay (arena.ts)",
        "Green = platforms · Gold = gem seams",
        "Teal = hoard slots · Pink = spawns",
        "Press E to export PNG · Esc = back",
      ].join("\n"),
      {
        fontFamily: "system-ui, sans-serif",
        fontSize: "13px",
        color: "#111111",
        lineSpacing: 3,
      }
    )
    .setDepth(200);
}

export function hoardBounds(team: Team) {
  const w = TUNING.slotsToWin * (SLOT_SIZE + SLOT_GAP) - SLOT_GAP;
  return { x: HOARD_X[team], y: HOARD_Y, w, h: SLOT_SIZE };
}
