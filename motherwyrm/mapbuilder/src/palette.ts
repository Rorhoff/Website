/**
 * Indexed palette slots for platform tile art.
 * Source pixels use these exact marker colors; render time swaps them to skin colors.
 *
 * NOTE: The game's platform renderer (Game.ts buildPlatforms) still draws plain
 * rectangles — it does not load map JSON or apply palette swaps yet. That
 * needs to be added when maps are loaded in-game.
 */
export const PALETTE_MARKERS = {
  base: "#ff006e",
  shadow: "#8338ec",
  highlight: "#3a86ff",
  trim: "#ffbe0b",
} as const;

export type MarkerKey = keyof typeof PALETTE_MARKERS;

const MARKER_RGB: Record<MarkerKey, [number, number, number]> = {
  base: [255, 0, 110],
  shadow: [131, 56, 236],
  highlight: [58, 134, 255],
  trim: [255, 190, 11],
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function colorDist(a: [number, number, number], b: [number, number, number]): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

/** Replace marker colors in ImageData with skin palette (tolerance for PNG compression). */
export function applyPaletteSwap(
  data: ImageData,
  colors: Record<MarkerKey, string>,
  tolerance = 48
): void {
  const targets = (Object.keys(MARKER_RGB) as MarkerKey[]).map((key) => ({
    key,
    marker: MARKER_RGB[key],
    repl: hexToRgb(colors[key]),
  }));

  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    const pix: [number, number, number] = [px[i], px[i + 1], px[i + 2]];
    let best: (typeof targets)[0] | null = null;
    let bestD = Infinity;
    for (const t of targets) {
      const d = colorDist(pix, t.marker);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (best && bestD <= tolerance) {
      px[i] = best.repl[0];
      px[i + 1] = best.repl[1];
      px[i + 2] = best.repl[2];
    }
  }
}
