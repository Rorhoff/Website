/** Site furniture and hardscape objects placed as point features in the editor. */

export type DecorativeObject = {
  id: string;
  label: string;
  featureType: string;
  /** Footprint diameter or width in feet (for scale when calibrated). */
  sizeFt: number;
  notes?: string;
};

export const DECORATIVE_OBJECTS: DecorativeObject[] = [
  {
    id: "putting-green-flag",
    label: "Putting green flag",
    featureType: "putting_green_flag",
    sizeFt: 1,
    notes: "Cup flag marker",
  },
  {
    id: "lawn-chair",
    label: "Lawn chair",
    featureType: "lawn_chair",
    sizeFt: 2.5,
    notes: "Outdoor lounge chair",
  },
  {
    id: "fire-pit-round",
    label: "Fire pit (round)",
    featureType: "fire_pit_round",
    sizeFt: 3,
    notes: "Round gas or wood fire feature",
  },
  {
    id: "fire-pit-square",
    label: "Fire pit (square)",
    featureType: "fire_pit_square",
    sizeFt: 3,
    notes: "Square fire feature",
  },
  {
    id: "flagstone-step-rock",
    label: "Flagstone step rock",
    featureType: "flagstone_step_rock",
    sizeFt: 2,
    notes: "Individual flagstone stepper",
  },
];

const FEATURE_TYPES = new Set(DECORATIVE_OBJECTS.map((o) => o.featureType));

export function getDecorativeObject(id: string): DecorativeObject | undefined {
  return DECORATIVE_OBJECTS.find((o) => o.id === id);
}

export function getDecorativeObjectByFeatureType(
  featureType: string
): DecorativeObject | undefined {
  return DECORATIVE_OBJECTS.find((o) => o.featureType === featureType);
}

export function isDecorativeObjectFeatureType(featureType: string): boolean {
  return FEATURE_TYPES.has(featureType);
}

/** Normalized placement radius from object size in feet. */
export function objectRadiusNorm(
  sizeFt: number,
  displayW: number,
  displayH: number,
  pixelsPerFoot?: number
): number {
  const radiusFt = sizeFt / 2;
  if (pixelsPerFoot != null && pixelsPerFoot > 0) {
    const radiusPx = radiusFt * pixelsPerFoot;
    return Math.min(0.35, radiusPx / Math.max(displayW, displayH));
  }
  const refNorm = (sizeFt / 6) * 0.06;
  return Math.min(0.12, Math.max(0.004, refNorm / 2));
}

export function objectNotes(obj: DecorativeObject): string {
  return obj.notes ?? obj.label;
}
