import type { LegendEntry } from "@/config/legend";
import type { TakeoffLine } from "@/lib/design-content-schema";
import { DESIGN_CONTENT_JSON_HINT } from "@/lib/design-content-schema";
import type { ProjectMetadata } from "@/lib/project-schema";

export function buildDesignContentSystemPrompt(hasElevationFacts = false): string {
  const elevationRule = hasElevationFacts
    ? "- Elevation and slope facts are supplied separately — reference them when commenting on grading, drainage, or constructability. Do not invent elevations."
    : "- Takeoff context is area quantities (sq ft) only. Do not comment on slope, grading, cut/fill, or elevation unless explicit elevation fields appear in the takeoff JSON.";

  return `You are a senior landscape designer preparing board copy for a residential client presentation in Utah.

Write in a warm, confident designer voice — specific to THIS project, never generic filler.

Rules:
- Return ONLY valid JSON matching the schema. No markdown fences, no preamble.
- conceptOverview: 4–5 bullets referencing actual features by name/id from the feature list.
- plantPalette: 8–10 plants suited to the climate zone and design style. Bias hard toward water-wise and Utah-hardy species (USDA 6b/7a, Salt Lake Valley). For every tree and tree_specimen feature, include the exact species you recommend in plantPalette with placement set to that feature id.
- materialsAndFinishes: one entry per hardscape feature (paver patio, water feature, pergola, fire pit, etc.) with a specific material and short description.
- Do NOT include takeoff in your response — quantities are supplied separately.
${elevationRule}
- renderPrompts: exactly three prompts with ids "entry", "fire_pit", "hero_dusk". Each must describe actual materials, plants, and layout from this project, plus camera angle, time of day, and lighting. Hero prompt is a whole-yard dusk perspective.

Schema (without takeoff):
${DESIGN_CONTENT_JSON_HINT}`;
}

export function buildDesignContentUserPrompt(
  metadata: ProjectMetadata,
  featuresJson: string,
  takeoff: TakeoffLine[],
  legend: LegendEntry[],
  elevationFacts?: Record<string, unknown>[]
): string {
  const legendSummary = legend
    .map((e) => `- ${e.featureType}: ${e.label} (${e.defaultMaterial})`)
    .join("\n");

  return [
    `Project: ${metadata.projectTitle || "Untitled"}`,
    metadata.clientName ? `Client: ${metadata.clientName}` : "",
    metadata.propertyAddress ? `Address: ${metadata.propertyAddress}` : "",
    `Design style: ${metadata.designStyle}`,
    `Climate: ${metadata.climateZone}`,
    metadata.notes.trim() ? `Designer notes: ${metadata.notes.trim()}` : "",
    "",
    "Feature list (JSON):",
    featuresJson,
    "",
    "Legend materials:",
    legendSummary,
    "",
    "Takeoff area quantities (sq ft only — pre-calculated, for context; do not return takeoff):",
    JSON.stringify(takeoff, null, 2),
    elevationFacts?.length
      ? [
          "",
          "Elevation & slope facts from DTM (pre-calculated — reference only, do not return):",
          JSON.stringify(elevationFacts, null, 2),
        ].join("\n")
      : "",
    "",
    "Generate conceptOverview, plantPalette, materialsAndFinishes, and renderPrompts.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Partial schema for Claude response (takeoff merged server-side). */
export const CLAUDE_DESIGN_CONTENT_HINT = DESIGN_CONTENT_JSON_HINT;
