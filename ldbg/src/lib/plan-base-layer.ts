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
  }
): PlanBaseLayer {
  const baseMode = settings?.baseMode ?? "orthophoto";
  const opacity = settings?.orthophotoOpacity ?? 0.4;
  const stylePreset = settings?.stylePreset ?? "watercolor-plan";

  if (baseMode === "white") {
    return { opacity: 1, stylePreset };
  }

  if (presetUsesStylePass(stylePreset)) {
    const styledUrl = urls.forPrint
      ? (urls.styleRegisteredUrl ?? urls.stylePreviewUrl)
      : (urls.stylePreviewUrl ?? urls.styleRegisteredUrl);
    if (styledUrl) {
      return {
        url: styledUrl,
        opacity: 1,
        usesStylePass: true,
        stylePreset,
        registration: urls.registration,
      };
    }
    const errBase =
      urls.styleJobError ??
      (urls.styleJobRunning
        ? "Style pass is still generating…"
        : "Style pass has not run — composite + style output missing.");
    const err = urls.styleJobPythonInterpreter
      ? `${errBase} (Python: ${urls.styleJobPythonInterpreter})`
      : errBase;
    return {
      url: undefined,
      opacity: 1,
      usesStylePass: true,
      stylePreset,
      styleMissing: true,
      styleError: err,
      registration: urls.registration,
    };
  }

  const base = urls.cleanUrl ?? urls.rawUrl;
  return { url: base, opacity: presetUsesStylePass(stylePreset) ? 1 : opacity, stylePreset };
}
