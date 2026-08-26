import type { PlanSettings } from "@/lib/project-schema";
import type { PlanRenderCacheEntry } from "@/lib/plan-render-schema";

export type PlanBaseLayer = {
  url?: string;
  svgFilter?: string;
  opacity: number;
  useAiRender?: boolean;
  registrationPassed?: boolean;
};

/** Legacy watercolor presets map to clean orthophoto (filter pipeline removed from UI). */
export function normalizeBasePreset(
  preset?: PlanSettings["basePreset"]
): "off" | "desaturated" {
  return preset === "desaturated" ? "desaturated" : "off";
}

export function getEffectiveBasePreset(settings?: PlanSettings): "off" | "desaturated" {
  if (settings?.baseMode === "white" || settings?.baseMode === "ai_render") return "off";
  return normalizeBasePreset(settings?.basePreset);
}

/** Resolve which image URL and SVG filter to use for the plan base layer. */
export function resolvePlanBaseLayer(
  settings: PlanSettings | undefined,
  urls: {
    rawUrl?: string;
    planRenderUrl?: string;
    planRenderEntry?: PlanRenderCacheEntry;
  }
): PlanBaseLayer {
  const baseMode = settings?.baseMode ?? "orthophoto";
  const opacity = settings?.orthophotoOpacity ?? 0.4;

  if (baseMode === "white") {
    return { opacity: 1 };
  }

  if (baseMode === "ai_render" && urls.planRenderUrl) {
    const entry = urls.planRenderEntry;
    return {
      url: urls.planRenderUrl,
      opacity: 1,
      useAiRender: true,
      registrationPassed: entry?.registrationPassed,
    };
  }

  const preset = getEffectiveBasePreset(settings);
  const url = urls.rawUrl;

  if (preset === "desaturated") {
    return {
      url,
      svgFilter: "url(#plan-desaturate)",
      opacity,
    };
  }

  return { url, opacity };
}
