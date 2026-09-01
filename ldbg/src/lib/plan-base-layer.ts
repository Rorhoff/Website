import { geminiEnabled } from "@/config/ai-features";
import type { PlanSettings } from "@/lib/project-schema";
import { presetUsesStylePass, type StylePresetId } from "@/config/styles";
import type { RegistrationResult } from "@/lib/style-pass-schema";

export type PlanBaseLayer = {
  url?: string;
  svgFilter?: string;
  opacity: number;
  usesStylePass?: boolean;
  stylePreset?: StylePresetId;
  styleMissing?: boolean;
  styleError?: string;
  registration?: RegistrationResult;
};

export function resolvePlanBaseLayer(
  settings: PlanSettings | undefined,
  urls: {
    rawUrl?: string;
    cleanUrl?: string;
    stylePreviewUrl?: string;
    styleRegisteredUrl?: string;
    forPrint?: boolean;
    styleJobError?: string;
    styleJobRunning?: boolean;
    styleJobPythonInterpreter?: string;
    registration?: RegistrationResult;
    unfilledFeatureCount?: number;
    totalDesignFeatures?: number;
  }
): PlanBaseLayer {
  const baseMode = settings?.baseMode ?? "orthophoto";
  const opacity = settings?.orthophotoOpacity ?? 0.4;
  const stylePreset = settings?.stylePreset ?? "off";
  const effectivePreset: StylePresetId =
    !geminiEnabled() && presetUsesStylePass(stylePreset) ? "off" : stylePreset;

  if (baseMode === "white") {
    return { opacity: 1, stylePreset: effectivePreset };
  }

  if (presetUsesStylePass(effectivePreset)) {
    const styledUrl = urls.forPrint
      ? (urls.styleRegisteredUrl ?? urls.stylePreviewUrl)
      : (urls.stylePreviewUrl ?? urls.styleRegisteredUrl);
    if (styledUrl) {
      return {
        url: styledUrl,
        opacity: 1,
        usesStylePass: true,
        stylePreset: effectivePreset,
        registration: urls.registration,
      };
    }
    const fillsHint =
      urls.unfilledFeatureCount != null &&
      urls.totalDesignFeatures != null &&
      urls.unfilledFeatureCount > 0
        ? ` ${urls.unfilledFeatureCount} feature fill${urls.unfilledFeatureCount === 1 ? "" : "s"} still empty — optional but improves materials.`
        : "";
    const errBase =
      urls.styleJobError ??
      (urls.styleJobRunning
        ? "Style pass is still generating…"
        : `Styled plan not generated yet — click Save plan settings to run the style pass.${fillsHint}`);
    const err = urls.styleJobPythonInterpreter
      ? `${errBase} (Python: ${urls.styleJobPythonInterpreter})`
      : errBase;
    return {
      url: undefined,
      opacity: 1,
      usesStylePass: true,
      stylePreset: effectivePreset,
      styleMissing: true,
      styleError: err,
      registration: urls.registration,
    };
  }

  const base = urls.rawUrl ?? urls.cleanUrl;
  return {
    url: base,
    opacity: presetUsesStylePass(effectivePreset) ? 1 : opacity,
    stylePreset: effectivePreset,
  };
}
