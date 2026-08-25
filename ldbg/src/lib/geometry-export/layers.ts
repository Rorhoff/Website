/** Vectorworks Landmark layer names (Addendum A7). */

export type VectorworksCategory =
  | "Building"
  | "Boundary"
  | "Trees"
  | "Hardscape"
  | "Wall"
  | "Structure"
  | "Plant";

const FEATURE_CATEGORY: Record<string, VectorworksCategory> = {
  putting_green: "Plant",
  lawn: "Plant",
  ornamental_grass: "Plant",
  tree: "Trees",
  tree_specimen: "Trees",
  water_feature: "Hardscape",
  paver_patio: "Hardscape",
  pergola: "Structure",
  fire_pit: "Structure",
};

export function vectorworksLayer(
  featureType: string,
  existing: boolean
): string {
  const prefix = existing ? "Ex" : "Prop";
  const category = FEATURE_CATEGORY[featureType] ?? "Hardscape";
  return `${prefix}-${category}`;
}

export const VECTORWORKS_LAYERS = [
  "Ex-Building",
  "Ex-Boundary",
  "Ex-Trees",
  "Prop-Hardscape",
  "Prop-Wall",
  "Prop-Structure",
  "Prop-Plant",
] as const;
