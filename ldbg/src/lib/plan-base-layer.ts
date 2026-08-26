import type { PlanSettings } from "@/lib/project-schema";
import { presetUsesFilter } from "@/config/watercolor";

export type PlanBaseLayer = {
  url?: string;
  svgFilter?: string;
  opacity: number;
  usesWatercolorFilter?: boolean;
};

export function resolvePlanBaseLayer(
  settings: PlanSettings | undefined,
  urls: {
    rawUrl?: string;
    watercolorPreviewUrl?: string;
    watercolorFullUrl?: string;
    forPrint?: boolean;
  }
): PlanBaseLayer {
  const baseMode = settings?.baseMode ?? "orthophoto";
  const opacity = settings?.orthophotoOpacity ?? 0.4;
  const preset = settings?.basePreset ?? "watercolor-soft";

  if (baseMode === "white") {
    return { opacity: 1 };
  }

  if (presetUsesFilter(preset)) {
    const wcUrl = urls.forPrint
      ? (urls.watercolorFullUrl ?? urls.watercolorPreviewUrl)
      : (urls.watercolorPreviewUrl ?? urls.watercolorFullUrl);
    if (wcUrl) {
      return { url: wcUrl, opacity: 1, usesWatercolorFilter: true };
    }
  }

  if (preset === "desaturated") {
    return {
      url: urls.rawUrl,
      svgFilter: "url(#plan-desaturate)",
      opacity,
    };
  }

  return { url: urls.rawUrl, opacity: preset === "off" ? opacity : 1 };
}
