import type { LegendEntry } from "@/config/legend";
import { legendToPromptTable } from "@/config/legend";
import type { ProjectMetadata } from "@/lib/project-schema";

const SYSTEM_TEMPLATE = `You are a landscape design assistant. You are looking at a top-down drone orthophoto of a
residential property that has been hand-annotated by a designer on a touchscreen. Your job is
to interpret the annotations into structured design data.

The designer uses this color and shape code:
{{LEGEND_TABLE}}

Rules:
- Report coordinates as normalized floats 0.0 to 1.0, where (0,0) is the top-left of the image
  and (1,1) is the bottom-right.
- For area features return a polygon of 6 to 24 points tracing the annotation boundary.
- For point features (trees, fire pit) return a single center point and an estimated canopy or
  fixture radius in normalized units.
- Annotations are rough freehand. Smooth obvious hand-jitter into a clean shape but do not
  relocate anything or change its overall footprint.
- Any area inside the property boundary that is not covered by another annotation and is not
  the house footprint, driveway, or existing hardscape should be returned as one or more \`lawn\`
  features.
- Also identify unannotated existing site conditions you can see: house roof footprint, driveway,
  sidewalks, fence lines, existing sheds, utility boxes, and neighboring structures. Tag these
  with "existing": true.
- Set confidence per feature from 0 to 1. Be honest. Use below 0.6 for anything ambiguous.
- Never invent a feature that has no annotation and no visible site evidence.
- Return only valid JSON matching the schema. No markdown fences, no preamble, no commentary.`;

export function buildInterpretSystemPrompt(legend: LegendEntry[]): string {
  return SYSTEM_TEMPLATE.replace("{{LEGEND_TABLE}}", legendToPromptTable(legend));
}

export function buildInterpretUserPrompt(projectMeta: ProjectMetadata): string {
  const lines = [
    "Interpret every visible designer annotation on this orthophoto.",
    "Return JSON with imageSize, features, siteObservations, and ambiguities.",
  ];
  if (projectMeta.projectTitle) lines.push(`Project: ${projectMeta.projectTitle}`);
  if (projectMeta.propertyAddress) lines.push(`Address: ${projectMeta.propertyAddress}`);
  if (projectMeta.designStyle) lines.push(`Design style: ${projectMeta.designStyle}`);
  if (projectMeta.climateZone) lines.push(`Climate: ${projectMeta.climateZone}`);
  if (projectMeta.notes.trim()) lines.push(`Designer notes: ${projectMeta.notes.trim()}`);
  return lines.join("\n");
}

export const INTERPRET_JSON_SCHEMA_HINT = `{
  "imageSize": { "width": number, "height": number },
  "features": [{
    "id": string,
    "featureType": string,
    "label": string,
    "geometry": {
      "kind": "polygon" | "point" | "polyline",
      "points": [{ "x": number, "y": number }],
      "radius": number (optional)
    },
    "existing": boolean,
    "confidence": number,
    "notes": string
  }],
  "siteObservations": string[],
  "ambiguities": string[]
}`;
