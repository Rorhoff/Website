/**
 * Designer annotation legend — edit entries here or via the Legend Editor UI.
 * Prompt builder and plan renderer read from getLegend() which merges overrides.
 */

export type FeatureUnit = "sqft" | "each" | "lf";

export type RenderStyle = {
  fill: string;
  stroke: string;
  strokeWidth?: number;
  patternId?: string;
  opacity?: number;
};

/** Default styling for `existing: true` site geometry on plans and editor. */
export const DEFAULT_EXISTING_RENDER_STYLE: RenderStyle = {
  fill: "none",
  stroke: "#999999",
  strokeWidth: 0.35,
  patternId: "existing-hatch",
  opacity: 1,
};

export type LegendEntry = {
  id: string;
  label: string;
  featureType: string;
  colorHint: { hex: string; description: string };
  shapeHint: string;
  defaultMaterial: string;
  renderStyle: RenderStyle;
  /** Optional override for existing site geometry of this type. */
  existingRenderStyle?: RenderStyle;
  unit: FeatureUnit;
  notes?: string;
};

export const DEFAULT_LEGEND: LegendEntry[] = [
  {
    id: "putting_green",
    label: "Putting green",
    featureType: "putting_green",
    colorHint: { hex: "#7CFC7C", description: "bright / light green fill" },
    shapeHint: "filled irregular area",
    defaultMaterial: "Synthetic turf putting surface",
    renderStyle: { fill: "#6BCB6B", stroke: "#3D8B3D", patternId: "turf-stipple" },
    unit: "sqft",
    notes: "Synthetic turf putting green",
  },
  {
    id: "lawn",
    label: "Lawn",
    featureType: "lawn",
    colorHint: { hex: "#228B22", description: "plain green fill (default planted area)" },
    shapeHint: "filled area, default for unmarked planted ground",
    defaultMaterial: "Turf grass or lawn mix",
    renderStyle: { fill: "#A8D5A2", stroke: "#5A9E5A", patternId: "turf-stipple", opacity: 0.85 },
    unit: "sqft",
  },
  {
    id: "tree",
    label: "Shade tree",
    featureType: "tree",
    colorHint: { hex: "#006400", description: "dark green outlined blob" },
    shapeHint: "dark green outlined canopy blob",
    defaultMaterial: "Deciduous shade tree — species TBD",
    renderStyle: { fill: "#2E6B4F", stroke: "#1B4332", opacity: 0.55 },
    unit: "each",
    notes: "Deciduous shade tree",
  },
  {
    id: "tree_specimen",
    label: "Specimen tree",
    featureType: "tree_specimen",
    colorHint: { hex: "#FF8C00", description: "orange filled circle" },
    shapeHint: "orange circle with brown lightning-bolt scribble inside",
    defaultMaterial: "Ornamental / specimen tree — species TBD",
    renderStyle: { fill: "#E8923A", stroke: "#8B4513", opacity: 0.6 },
    unit: "each",
    notes: "Feature tree, different species than shade tree",
  },
  {
    id: "water_feature",
    label: "Water feature",
    featureType: "water_feature",
    colorHint: { hex: "#1E90FF", description: "blue curvy shape" },
    shapeHint: "blue curvy pond/waterfall; circles at top = boulder header",
    defaultMaterial: "Natural boulder waterfall + pond",
    renderStyle: { fill: "#5BA4D9", stroke: "#2E6B9E", patternId: "water" },
    unit: "sqft",
  },
  {
    id: "paver_patio",
    label: "Paver patio",
    featureType: "paver_patio",
    colorHint: { hex: "#808080", description: "grey fill" },
    shapeHint: "grey filled hardscape area",
    defaultMaterial: "Concrete paver — style TBD",
    renderStyle: { fill: "#B0B0B0", stroke: "#666666", patternId: "paver-running-bond" },
    unit: "sqft",
  },
  {
    id: "pergola",
    label: "Pergola",
    featureType: "pergola",
    colorHint: { hex: "#000000", description: "black rectilinear lines" },
    shapeHint: "black rectilinear outline structure",
    defaultMaterial: "Wood or aluminum pergola — finish TBD",
    renderStyle: { fill: "none", stroke: "#222222", strokeWidth: 2 },
    unit: "each",
  },
  {
    id: "fire_pit",
    label: "Fire pit",
    featureType: "fire_pit",
    colorHint: { hex: "#FF4500", description: "red/orange scribble inside pergola" },
    shapeHint: "red-orange mark inside pergola footprint",
    defaultMaterial: "Gas fire feature — model TBD",
    renderStyle: { fill: "#D4652A", stroke: "#8B3A12" },
    unit: "each",
  },
  {
    id: "ornamental_grass",
    label: "Ornamental grass",
    featureType: "ornamental_grass",
    colorHint: { hex: "#32CD32", description: "small green tick/chevron marks" },
    shapeHint: "small green tick or chevron strokes, usually clustered",
    defaultMaterial: "Ornamental grass mass — species TBD",
    renderStyle: { fill: "#8FBC8F", stroke: "#556B2F", patternId: "mulch" },
    unit: "sqft",
    notes: "Usually clustered in beds",
  },
  {
    id: "lavender",
    label: "Lavender",
    featureType: "lavender",
    colorHint: { hex: "#9370DB", description: "purple/lavender fill or ticks" },
    shapeHint: "purple planting mass or tick marks in beds",
    defaultMaterial: "Lavender — English or Spanish",
    renderStyle: { fill: "#B19CD9", stroke: "#6A5ACD", patternId: "mulch", opacity: 0.85 },
    unit: "sqft",
  },
  {
    id: "blue_grass",
    label: "Blue grama grass",
    featureType: "blue_grass",
    colorHint: { hex: "#6B8E23", description: "olive-green grass mass" },
    shapeHint: "olive-green filled bed or grass area",
    defaultMaterial: "Blue grama grass (Bouteloua gracilis)",
    renderStyle: { fill: "#9CB064", stroke: "#556B2F", patternId: "turf-stipple", opacity: 0.8 },
    unit: "sqft",
  },
  {
    id: "sagebrush",
    label: "Sagebrush",
    featureType: "sagebrush",
    colorHint: { hex: "#9CAF88", description: "sage-green muted fill" },
    shapeHint: "muted sage-green shrub mass",
    defaultMaterial: "Big sagebrush or similar xeric shrub",
    renderStyle: { fill: "#A8B89A", stroke: "#6B7B5C", patternId: "mulch", opacity: 0.85 },
    unit: "sqft",
  },
  {
    id: "steel_edging",
    label: "Steel edging",
    featureType: "steel_edging",
    colorHint: { hex: "#4169E1", description: "royal blue line stroke" },
    shapeHint: "thin blue line — steel lawn edging",
    defaultMaterial: "Steel landscape edging",
    renderStyle: { fill: "none", stroke: "#4169E1", strokeWidth: 2 },
    unit: "lf",
  },
  {
    id: "boulder_retaining_edge",
    label: "Boulder retaining edge",
    featureType: "boulder_retaining_edge",
    colorHint: { hex: "#8B4513", description: "brown line along boulder edge" },
    shapeHint: "brown polyline along boulder retaining edge",
    defaultMaterial: "Natural boulder retaining edge",
    renderStyle: { fill: "none", stroke: "#8B4513", strokeWidth: 2.5 },
    unit: "lf",
  },
  {
    id: "property_boundary",
    label: "Property boundary",
    featureType: "property_boundary",
    colorHint: { hex: "#FF00FF", description: "magenta outline (editor only)" },
    shapeHint: "property line polygon — clip import to this",
    defaultMaterial: "Survey / parcel boundary",
    renderStyle: { fill: "none", stroke: "#C026D3", strokeWidth: 2, opacity: 0.9 },
    unit: "lf",
    notes: "Required before CV import. Not exported on board.",
  },
];

export function legendToPromptTable(entries: LegendEntry[]): string {
  return entries
    .map(
      (e) =>
        `- ${e.colorHint.description} (${e.colorHint.hex}) → featureType \`${e.featureType}\`: ${e.shapeHint}. ${e.notes ?? ""}`.trim()
    )
    .join("\n");
}
