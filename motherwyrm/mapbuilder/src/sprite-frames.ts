/** Default atlas frame crops — match /mw/assets/*.json (1× canvas px). */
export type SheetFrame = {
  sheet: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export const DEFAULT_SHEET_FRAMES: Record<string, SheetFrame> = {
  mother_blue_idle: { sheet: "/mw/assets/mother_blue.png", x: 96, y: 64, w: 192, h: 128 },
  mother_blue_dive: { sheet: "/mw/assets/mother_blue.png", x: 768, y: 0, w: 384, h: 256 },
  mother_blue_claw: { sheet: "/mw/assets/mother_blue.png", x: 1248, y: 64, w: 192, h: 128 },
  mother_red_idle: { sheet: "/mw/assets/mother_red.png", x: 96, y: 64, w: 192, h: 128 },
  mother_red_dive: { sheet: "/mw/assets/mother_red.png", x: 768, y: 0, w: 384, h: 256 },
  mother_red_claw: { sheet: "/mw/assets/mother_red.png", x: 1248, y: 64, w: 192, h: 128 },
  whelp_blue: { sheet: "/mw/assets/whelp_blue.png", x: 0, y: 0, w: 24, h: 24 },
  whelp_red: { sheet: "/mw/assets/whelp_red.png", x: 0, y: 0, w: 24, h: 24 },
  wyrm: { sheet: "/mw/assets/wyrm.png", x: 0, y: 3, w: 56, h: 37 },
};
