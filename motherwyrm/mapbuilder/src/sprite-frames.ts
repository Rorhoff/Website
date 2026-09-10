/** Default atlas frame crops — match /mw/assets/*.json (1× canvas px). */
export type SheetFrame = {
  sheet: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export const DEFAULT_SHEET_FRAMES: Record<string, SheetFrame> = {
  mother_blue_idle: { sheet: "/mw/assets/mother_blue.png", x: 0, y: 0, w: 192, h: 128 },
  mother_blue_dive: { sheet: "/mw/assets/mother_blue.png", x: 384, y: 0, w: 192, h: 128 },
  mother_blue_claw: { sheet: "/mw/assets/mother_blue.png", x: 576, y: 0, w: 192, h: 128 },
  mother_red_idle: { sheet: "/mw/assets/mother_red.png", x: 0, y: 0, w: 192, h: 128 },
  mother_red_dive: { sheet: "/mw/assets/mother_red.png", x: 384, y: 0, w: 192, h: 128 },
  mother_red_claw: { sheet: "/mw/assets/mother_red.png", x: 576, y: 0, w: 192, h: 128 },
  whelp_blue: { sheet: "/mw/assets/whelp_blue.png", x: 0, y: 0, w: 164, h: 110 },
  whelp_red: { sheet: "/mw/assets/whelp_red.png", x: 0, y: 0, w: 164, h: 110 },
  wyrm: { sheet: "/mw/assets/wyrm.png", x: 5, y: 7, w: 46, h: 30 },
};
