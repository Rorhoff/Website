import type { PlatformPalette } from "./types";

/** Arena dimensions — match motherwyrm/tv/src/arena-layout.ts */
export const W = 1280;
export const H = 720;
export const CENTER_X = W / 2;

/** Default editor grid snap (px). */
export const DEFAULT_GRID = 8;

/** Hoard slot grid — mirrors arena-layout slot constants. */
export const SLOT_SIZE = 16;
export const SLOT_GAP = 6;
export const SLOT_ROW_GAP = 8;
export const SLOT_COLS = 8;
export const SLOT_ROWS = 2;
export const SLOTS_TO_WIN = 15;
export const HOARD_WIDTH = SLOT_COLS * (SLOT_SIZE + SLOT_GAP) - SLOT_GAP;
export const HOARD_HEIGHT = SLOT_ROWS * SLOT_SIZE + (SLOT_ROWS - 1) * SLOT_ROW_GAP;

export const GEM_RADIUS = 6;

/** Ruby gem colors — match game COLORS.gem / gemLit. */
export const GEM_RUBY = "#c41e3a";
export const GEM_RUBY_LIT = "#ff6b81";

export const DEFAULT_WYRM_PATH = {
  left: 60,
  right: W - 60,
  y: 690,
  finishHeight: 110,
};

/** Game soil colors — default platform skin preset. */
export const DEFAULT_SKIN_NAME = "soil_default";

export const SKIN_PRESETS: Record<string, PlatformPalette> = {
  soil_default: {
    base: "#2c2119",
    shadow: "#1a120d",
    highlight: "#3d2e22",
    trim: "#4a3828",
  },
  stone_mossy: {
    base: "#3a4a32",
    shadow: "#252f20",
    highlight: "#4d6342",
    trim: "#6b8054",
  },
  stone_ice: {
    base: "#4a5568",
    shadow: "#2d3748",
    highlight: "#718096",
    trim: "#a0aec0",
  },
  brick_warm: {
    base: "#6b3a2e",
    shadow: "#452318",
    highlight: "#8f4f3d",
    trim: "#c4724a",
  },
};
