import type { LegendEntry } from "@/config/legend";
import { maskFeatureAreasForPrompt } from "@/lib/plan-mask";

export function buildPlanRenderPrompt(
  features: Parameters<typeof maskFeatureAreasForPrompt>[0],
  legend: LegendEntry[],
  imageW: number,
  imageH: number,
  pixelsPerFoot?: number,
  georefCtx?: Parameters<typeof maskFeatureAreasForPrompt>[5]
): string {
  const rows = maskFeatureAreasForPrompt(
    features,
    legend,
    imageW,
    imageH,
    pixelsPerFoot,
    georefCtx
  );

  const colorKey = rows
    .map(
      (r) =>
        `- ${r.hex} (${r.areaSqFt.toLocaleString()} sq ft): ${r.material}`
    )
    .join("\n");

  return `This is a top-down aerial photograph of a residential property with a proposed landscape design marked in flat color blocks. Replace each color block with a photorealistic rendering of the material it represents, keeping the exact same footprint, outline, and position. Do not move, resize, or reshape any block. Leave everything outside the color blocks unchanged.

Color key for this image:
${colorKey}

Render at the same scale and orientation as the source photograph. Do not add text, labels, watermarks, numbers, or annotations of any kind. Do not add furniture, people, or vehicles.`;
}
