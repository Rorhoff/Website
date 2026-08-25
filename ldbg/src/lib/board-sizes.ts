export type BoardPageSize = "24x36" | "18x24" | "11x17";

export type BoardDimensions = {
  id: BoardPageSize;
  label: string;
  widthIn: number;
  heightIn: number;
  widthPx: number;
  heightPx: number;
};

export const BOARD_DPI = 300;

/** Print-safe margin on all four sides (Addendum B6). */
export const BOARD_MARGIN_IN = 0.5;

export function boardMarginPx(): number {
  return BOARD_MARGIN_IN * BOARD_DPI;
}

export const BOARD_SIZES: Record<BoardPageSize, BoardDimensions> = {
  "24x36": {
    id: "24x36",
    label: "24×36 landscape",
    widthIn: 36,
    heightIn: 24,
    widthPx: 36 * BOARD_DPI,
    heightPx: 24 * BOARD_DPI,
  },
  "18x24": {
    id: "18x24",
    label: "18×24 landscape",
    widthIn: 24,
    heightIn: 18,
    widthPx: 24 * BOARD_DPI,
    heightPx: 18 * BOARD_DPI,
  },
  "11x17": {
    id: "11x17",
    label: "11×17 landscape",
    widthIn: 17,
    heightIn: 11,
    widthPx: 17 * BOARD_DPI,
    heightPx: 11 * BOARD_DPI,
  },
};

export function parseBoardPageSize(value: string | null | undefined): BoardPageSize {
  if (value && value in BOARD_SIZES) return value as BoardPageSize;
  return "24x36";
}

export function boardDimensions(size: BoardPageSize): BoardDimensions {
  return BOARD_SIZES[size];
}
