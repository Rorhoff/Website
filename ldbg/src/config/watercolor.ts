/** Addendum C — deterministic watercolor base presets (all values tunable per project). */

export type WatercolorPresetId =
  | "off"
  | "desaturated"
  | "watercolor-soft"
  | "watercolor-heavy"
  | "ink-wash";

export type WatercolorParams = {
  bilateral: {
    d: number;
    sigmaColor: number;
    sigmaSpace: number;
  };
  stylization: {
    method: "stylization" | "kuwahara";
    sigmaS: number;
    sigmaR: number;
    kuwaharaRadius: number;
  };
  posterize: {
    levels: number;
  };
  hsv: {
    saturationMultiplier: number;
    valueFloor: number;
  };
  edgeDarkening: {
    enabled: boolean;
    opacity: number;
    cannyLow: number;
    cannyHigh: number;
    blurRadius: number;
  };
  granulation: {
    amplitude: number;
    seed: number;
  };
  paperTexture: {
    opacity: number;
  };
  edgeFeather: {
    marginFraction: number;
    noiseScale: number;
    seed: number;
  };
  previewLongEdge: number;
};

export const DEFAULT_WATERCOLOR_PRESET: WatercolorPresetId = "watercolor-soft";

export const WATERCOLOR_SOFT: WatercolorParams = {
  bilateral: { d: 9, sigmaColor: 75, sigmaSpace: 75 },
  stylization: { method: "stylization", sigmaS: 60, sigmaR: 0.45, kuwaharaRadius: 5 },
  posterize: { levels: 20 },
  hsv: { saturationMultiplier: 1.15, valueFloor: 0.12 },
  edgeDarkening: { enabled: true, opacity: 0.18, cannyLow: 50, cannyHigh: 150, blurRadius: 3 },
  granulation: { amplitude: 0.035, seed: 42 },
  paperTexture: { opacity: 0.14 },
  edgeFeather: { marginFraction: 0.08, noiseScale: 0.015, seed: 7 },
  previewLongEdge: 2000,
};

export const WATERCOLOR_HEAVY: WatercolorParams = {
  bilateral: { d: 9, sigmaColor: 80, sigmaSpace: 80 },
  stylization: { method: "stylization", sigmaS: 90, sigmaR: 0.55, kuwaharaRadius: 7 },
  posterize: { levels: 16 },
  hsv: { saturationMultiplier: 1.2, valueFloor: 0.14 },
  edgeDarkening: { enabled: true, opacity: 0.22, cannyLow: 40, cannyHigh: 120, blurRadius: 4 },
  granulation: { amplitude: 0.045, seed: 42 },
  paperTexture: { opacity: 0.2 },
  edgeFeather: { marginFraction: 0.1, noiseScale: 0.018, seed: 7 },
  previewLongEdge: 2000,
};

export const INK_WASH: WatercolorParams = {
  bilateral: { d: 9, sigmaColor: 75, sigmaSpace: 75 },
  stylization: { method: "stylization", sigmaS: 70, sigmaR: 0.5, kuwaharaRadius: 6 },
  posterize: { levels: 18 },
  hsv: { saturationMultiplier: 0.4, valueFloor: 0.12 },
  edgeDarkening: { enabled: true, opacity: 0.28, cannyLow: 35, cannyHigh: 110, blurRadius: 4 },
  granulation: { amplitude: 0.04, seed: 42 },
  paperTexture: { opacity: 0.16 },
  edgeFeather: { marginFraction: 0.09, noiseScale: 0.016, seed: 7 },
  previewLongEdge: 2000,
};

/** Presets that run the Python filter pipeline. */
export const FILTERED_WATERCOLOR_PRESETS: WatercolorPresetId[] = [
  "watercolor-soft",
  "watercolor-heavy",
  "ink-wash",
];

export function presetUsesFilter(preset: WatercolorPresetId): boolean {
  return FILTERED_WATERCOLOR_PRESETS.includes(preset);
}

export function resolveWatercolorParams(
  preset: WatercolorPresetId,
  overrides?: Partial<WatercolorParams>
): WatercolorParams | null {
  let base: WatercolorParams | null = null;
  switch (preset) {
    case "watercolor-soft":
      base = WATERCOLOR_SOFT;
      break;
    case "watercolor-heavy":
      base = WATERCOLOR_HEAVY;
      break;
    case "ink-wash":
      base = INK_WASH;
      break;
    default:
      return null;
  }
  if (!overrides) return base;
  return {
    bilateral: { ...base.bilateral, ...overrides.bilateral },
    stylization: { ...base.stylization, ...overrides.stylization },
    posterize: { ...base.posterize, ...overrides.posterize },
    hsv: { ...base.hsv, ...overrides.hsv },
    edgeDarkening: { ...base.edgeDarkening, ...overrides.edgeDarkening },
    granulation: { ...base.granulation, ...overrides.granulation },
    paperTexture: { ...base.paperTexture, ...overrides.paperTexture },
    edgeFeather: { ...base.edgeFeather, ...overrides.edgeFeather },
    previewLongEdge: overrides.previewLongEdge ?? base.previewLongEdge,
  };
}

export const WATERCOLOR_PRESET_LABELS: Record<WatercolorPresetId, string> = {
  off: "Raw orthophoto",
  desaturated: "Desaturated (technical)",
  "watercolor-soft": "Watercolor soft",
  "watercolor-heavy": "Watercolor heavy",
  "ink-wash": "Ink wash",
};
