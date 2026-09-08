/** Default atlas frame crops — match /mw/assets/*.json (1× canvas px). */
export type SheetFrame = {
  sheet: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export const DEFAULT_SHEET_FRAMES: Record<string, SheetFrame> = {
  mother_blue_idle: { sheet: "/mw/assets/mother_blue.png", x: 0, y: 0, w: 40, h: 32 },
  mother_blue_dive: { sheet: "/mw/assets/mother_blue.png", x: 55, y: 0, w: 40, h: 32 },
  mother_blue_claw: { sheet: "/mw/assets/mother_blue.png", x: 80, y: 0, w: 40, h: 32 },
  mother_red_idle: { sheet: "/mw/assets/mother_red.png", x: 0, y: 0, w: 40, h: 32 },
  mother_red_dive: { sheet: "/mw/assets/mother_red.png", x: 55, y: 0, w: 40, h: 32 },
  mother_red_claw: { sheet: "/mw/assets/mother_red.png", x: 80, y: 0, w: 40, h: 32 },
  whelp_blue: { sheet: "/mw/assets/whelp_blue.png", x: 0, y: 0, w: 24, h: 24 },
  whelp_red: { sheet: "/mw/assets/whelp_red.png", x: 0, y: 0, w: 24, h: 24 },
  wyrm: { sheet: "/mw/assets/wyrm.png", x: 0, y: 0, w: 56, h: 44 },
};
