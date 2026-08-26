/** Maximally separated mask colors for AI plan render (distinct hue families). */
export const MASK_COLOR_PALETTE = [
  "#FF00FF",
  "#00FFFF",
  "#FFFF00",
  "#FF0000",
  "#00FF00",
  "#0000FF",
  "#FF8800",
  "#8800FF",
  "#00FF88",
  "#FF0088",
  "#88FF00",
  "#0088FF",
  "#AA5500",
  "#5500AA",
  "#00AA55",
  "#AA0055",
] as const;

export type MaskColorAssignment = {
  hex: string;
  featureType: string;
  featureIds: string[];
};

export function assignMaskColors(
  featureTypes: string[]
): Map<string, string> {
  const unique = [...new Set(featureTypes)];
  const map = new Map<string, string>();
  unique.forEach((ft, i) => {
    map.set(ft, MASK_COLOR_PALETTE[i % MASK_COLOR_PALETTE.length]);
  });
  return map;
}
