export type BoardPageSize = "24x36" | "18x24" | "11x17";

export type BoardDimensions = {
  id: BoardPageSize;
  label: string;
  widthIn: number;
  heightIn: number;
  /** HTML/Puppeteer canvas pixels (100 px per inch). */
  widthPx: number;
  heightPx: number;
};

/** Screen/export canvas resolution — 100 CSS px per print inch. */
export const BOARD_RENDER_PPI = 100;

/** Legacy reference for components that convert inches → px on the sheet canvas. */
export const BOARD_DPI = BOARD_RENDER_PPI;

export const BOARD_SIZES: Record<BoardPageSize, BoardDimensions> = {
  "24x36": {
    id: "24x36",
    label: "24×36 landscape",
    widthIn: 36,
    heightIn: 24,
    widthPx: 36 * BOARD_RENDER_PPI,
    heightPx: 24 * BOARD_RENDER_PPI,
  },
  "18x24": {
    id: "18x24",
    label: "18×24 landscape",
    widthIn: 24,
    heightIn: 18,
    widthPx: 24 * BOARD_RENDER_PPI,
    heightPx: 18 * BOARD_RENDER_PPI,
  },
  "11x17": {
    id: "11x17",
    label: "11×17 landscape",
    widthIn: 17,
    heightIn: 11,
    widthPx: 17 * BOARD_RENDER_PPI,
    heightPx: 11 * BOARD_RENDER_PPI,
  },
};

export function parseBoardPageSize(value: string | null | undefined): BoardPageSize {
  if (value && value in BOARD_SIZES) return value as BoardPageSize;
  return "24x36";
}

export function boardDimensions(size: BoardPageSize): BoardDimensions {
  return BOARD_SIZES[size];
}

/** Fixed grid tracks for 24×36 @ 100 PPI (3600×2400). Other sizes scale proportionally. */
export function boardGridTracks(size: BoardPageSize) {
  const d = boardDimensions(size);
  const sx = d.widthPx / 3600;
  const sy = d.heightPx / 2400;
  return {
    sheetW: d.widthPx,
    sheetH: d.heightPx,
    colRail: Math.round(792 * sx),
    colCenter: Math.round(1620 * sx),
    colRight: d.widthPx - Math.round(792 * sx) - Math.round(1620 * sx),
    rowMain: Math.round(1800 * sy),
    rowBottom: d.heightPx - Math.round(1800 * sy),
    centerLegendW: Math.round(300 * sx),
    rightHeroH: Math.round(560 * sy),
    rightMaterialsH: Math.round(360 * sy),
    railThumbH: Math.round(380 * sy),
  };
}
