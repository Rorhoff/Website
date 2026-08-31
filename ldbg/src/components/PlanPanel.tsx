"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PlanDrawing } from "@/components/PlanDrawing";
import {
  presetUsesStylePass,
  STYLE_PRESETS,
  STYLE_PRESET_IDS,
  type StylePresetId,
} from "@/config/styles";
import type { LegendEntry } from "@/config/legend";
import type { StoredElevationAnalysis } from "@/lib/elevation-schema";
import type { FeatureFillEntry } from "@/lib/feature-fill-schema";
import type { GeorefDisplayContext } from "@/lib/georef-display";
import { labelForFeatureType } from "@/lib/feature-styles";
import { projectImageUrl } from "@/lib/image-utils";
import type { InterpretFeature } from "@/lib/interpret-schema";
import { resolvePlanBaseLayer } from "@/lib/plan-base-layer";
import { withBasePath } from "@/lib/paths";
import type { Calibration, EditorSettings, PlanSettings, ProjectMetadata } from "@/lib/project-schema";
import type { StylePassCacheEntry, StylePassJob } from "@/lib/style-pass-schema";
import type { WatercolorJob } from "@/lib/watercolor-schema";

type Props = {
  projectId: string;
  features: InterpretFeature[];
  legend: LegendEntry[];
  metadata: ProjectMetadata;
  calibration?: Calibration;
  pixelsPerFoot?: number;
  georefCtx?: GeorefDisplayContext;
  elevationAnalysis?: StoredElevationAnalysis;
  northRotationDeg: number;
  editorSettings?: EditorSettings;
  imageWidth: number;
  imageHeight: number;
  rawBaseImageUrl?: string;
  cleanImageUrl?: string;
  planSettings?: PlanSettings;
  featureFills?: Record<string, FeatureFillEntry>;
  featureFillTotalCostUsd?: number;
  onPlanSettingsChange: (settings: PlanSettings) => void;
  onFeatureFillsChange: (fills: Record<string, FeatureFillEntry>, totalCost?: number) => void;
  onSavePlanSettings: () => void;
  saving?: boolean;
};

type LayerChoice = StylePresetId | "white";

const LAYER_OPTIONS: { value: LayerChoice; label: string }[] = [
  ...STYLE_PRESET_IDS.map((id) => ({
    value: id as LayerChoice,
    label: STYLE_PRESETS[id].label,
  })),
  { value: "white", label: "White + house footprint" },
];

function choiceFromSettings(settings: PlanSettings): LayerChoice {
  if (settings.baseMode === "white") return "white";
  return settings.stylePreset ?? "watercolor-plan";
}

export function PlanPanel({
  projectId,
  features,
  legend,
  metadata,
  calibration,
  pixelsPerFoot,
  georefCtx,
  elevationAnalysis,
  northRotationDeg,
  editorSettings,
  imageWidth,
  imageHeight,
  rawBaseImageUrl,
  cleanImageUrl,
  planSettings,
  featureFills,
  featureFillTotalCostUsd,
  onPlanSettingsChange,
  onFeatureFillsChange,
  onSavePlanSettings,
  saving,
}: Props) {
  const settings: PlanSettings = planSettings ?? {
    baseMode: "orthophoto",
    basePreset: "off",
    stylePreset: "watercolor-plan",
    orthophotoOpacity: 0.4,
    showFeatureOutlines: true,
    showInkLinework: false,
    watercolorCompareRaw: false,
    showContours: false,
    showDrainageArrows: false,
    contourMinorFt: 1,
    contourMajorFt: 5,
  };

  const [styleJob, setStyleJob] = useState<StylePassJob | null>(null);
  const [watercolorJob, setWatercolorJob] = useState<WatercolorJob | null>(null);
  const [stylePreviewUrl, setStylePreviewUrl] = useState<string | undefined>();
  const [styleEntry, setStyleEntry] = useState<StylePassCacheEntry | null>(null);
  const [fillBusy, setFillBusy] = useState<string | null>(null);
  const [fillError, setFillError] = useState("");
  const [cropPreviews, setCropPreviews] = useState<Record<string, string>>({});

  const designFeatures = useMemo(
    () =>
      features.filter(
        (f) => !f.existing && f.featureType !== "property_boundary"
      ),
    [features]
  );

  const pollStylePass = useCallback(async () => {
    try {
      const res = await fetch(
        withBasePath(`/api/projects/${encodeURIComponent(projectId)}/style-pass`)
      );
      const data = (await res.json()) as {
        job: StylePassJob;
        cacheReady: boolean;
        entry?: StylePassCacheEntry;
      };
      setStyleJob(data.job);
      if (data.cacheReady && data.entry?.previewFilename) {
        setStylePreviewUrl(projectImageUrl(projectId, data.entry.previewFilename));
        setStyleEntry(data.entry);
      } else {
        setStyleEntry(null);
        setStylePreviewUrl(undefined);
      }
      if (data.job.status === "error" && data.job.error) {
        setFillError(data.job.error);
      }
    } catch (e) {
      setFillError(e instanceof Error ? e.message : "Style pass status check failed");
    }
  }, [projectId]);

  const pollWatercolor = useCallback(async () => {
    try {
      const res = await fetch(
        withBasePath(`/api/projects/${encodeURIComponent(projectId)}/watercolor`)
      );
      if (!res.ok) return;
      const data = (await res.json()) as { job: WatercolorJob };
      setWatercolorJob(data.job ?? null);
    } catch {
      /* status poll is best-effort */
    }
  }, [projectId]);

  useEffect(() => {
    void pollStylePass();
    void pollWatercolor();
  }, [pollStylePass, pollWatercolor, settings.stylePreset, featureFills]);

  useEffect(() => {
    if (styleJob?.status === "running") {
      const t = setInterval(() => void pollStylePass(), 2000);
      return () => clearInterval(t);
    }
  }, [styleJob?.status, pollStylePass]);

  useEffect(() => {
    if (watercolorJob?.status === "running") {
      const t = setInterval(() => void pollWatercolor(), 1500);
      return () => clearInterval(t);
    }
  }, [watercolorJob?.status, pollWatercolor]);

  const watercolorActive =
    watercolorJob?.status === "running" || watercolorJob?.status === "failed";

  const planBase = useMemo(() => {
    const filled = designFeatures.filter(
      (f) => featureFills?.[f.id]?.status === "filled"
    ).length;
    return resolvePlanBaseLayer(settings, {
      rawUrl: rawBaseImageUrl,
      cleanUrl: cleanImageUrl,
      stylePreviewUrl,
      styleJobError: styleJob?.status === "error" ? styleJob.error : undefined,
      styleJobRunning: styleJob?.status === "running",
      styleJobPythonInterpreter:
        styleJob?.status === "error" ? styleJob.pythonInterpreter : undefined,
      registration: styleEntry?.registration,
      totalDesignFeatures: designFeatures.length,
      unfilledFeatureCount: designFeatures.length - filled,
    });
  }, [
    settings,
    rawBaseImageUrl,
    cleanImageUrl,
    stylePreviewUrl,
    styleJob?.status,
    styleJob?.error,
    styleJob?.pythonInterpreter,
    styleEntry?.registration,
    designFeatures,
    featureFills,
  ]);

  async function ensureStylePass(preset: StylePresetId) {
    if (!presetUsesStylePass(preset)) return;
    try {
      const res = await fetch(
        withBasePath(`/api/projects/${encodeURIComponent(projectId)}/style-pass`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preset }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Style pass job failed");
      setStyleJob(data.job ?? { status: "running", progress: 0 });
    } catch (e) {
      setFillError(e instanceof Error ? e.message : "Style pass failed");
    }
  }

  const handleLayerChange = (value: LayerChoice) => {
    if (value === "white") {
      onPlanSettingsChange({ ...settings, baseMode: "white" });
      return;
    }
    const next = {
      ...settings,
      baseMode: "orthophoto" as const,
      stylePreset: value,
      basePreset: "off" as const,
    };
    onPlanSettingsChange(next);
    if (presetUsesStylePass(value)) {
      void ensureStylePass(value);
    }
  };

  async function previewCrop(featureId: string) {
    setFillError("");
    try {
      const res = await fetch(withBasePath("/api/feature-fill"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, featureId, action: "preview" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Crop preview failed");
      const url = projectImageUrl(projectId, data.cropPreviewFilename);
      setCropPreviews((prev) => ({ ...prev, [featureId]: url }));
      if (data.entry) {
        onFeatureFillsChange({
          ...(featureFills ?? {}),
          [featureId]: data.entry,
        });
      }
    } catch (e) {
      setFillError(e instanceof Error ? e.message : "Crop preview failed");
    }
  }

  async function fillFeature(featureId: string, regenerate = false) {
    setFillError("");
    setFillBusy(featureId);
    try {
      const res = await fetch(withBasePath("/api/feature-fill"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          featureId,
          action: regenerate ? "regenerate" : "fill",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fill failed");
      onFeatureFillsChange(data.featureFills ?? {}, data.featureFillTotalCostUsd);
    } catch (e) {
      setFillError(e instanceof Error ? e.message : "Fill failed");
    } finally {
      setFillBusy(null);
    }
  }

  async function fillAllEmpty() {
    setFillError("");
    if (!cleanImageUrl) {
      setFillError(
        "Fill all empty needs a clean orthophoto on this project. Upload or register a clean base image first."
      );
      return;
    }
    setFillBusy("all");
    try {
      const res = await fetch(withBasePath("/api/feature-fill"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, action: "fill-all" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fill all failed");
      onFeatureFillsChange(data.featureFills ?? {}, data.featureFillTotalCostUsd);
    } catch (e) {
      setFillError(e instanceof Error ? e.message : "Fill all failed");
    } finally {
      setFillBusy(null);
    }
  }

  const selectValue = choiceFromSettings(settings);
  const filledCount = designFeatures.filter(
    (f) => featureFills?.[f.id]?.status === "filled"
  ).length;
  const stylePreset = settings.stylePreset ?? "watercolor-plan";

  return (
    <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">Plan drawing</h2>
          <p className="text-sm text-stone-600">
            Per-feature material fills composited, then an optional AI style pass for export
            sheets. This is separate from the watercolor base step above the feature editor —
            fills and style pass are not required to see the editor watercolor.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-lg bg-stone-50 p-3 text-sm">
        <label className="block">
          <span className="text-xs font-medium text-stone-600">Plan style</span>
          <select
            className="mt-1 block rounded border border-stone-300 px-2 py-1"
            value={selectValue}
            onChange={(e) => handleLayerChange(e.target.value as LayerChoice)}
          >
            {LAYER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        {settings.baseMode === "orthophoto" && stylePreset === "off" ? (
          <label className="block min-w-48">
            <span className="text-xs font-medium text-stone-600">
              Orthophoto opacity ({Math.round(settings.orthophotoOpacity * 100)}%)
            </span>
            <input
              type="range"
              min={0.1}
              max={0.8}
              step={0.05}
              value={settings.orthophotoOpacity}
              onChange={(e) =>
                onPlanSettingsChange({
                  ...settings,
                  orthophotoOpacity: parseFloat(e.target.value),
                })
              }
              className="mt-1 w-full"
            />
          </label>
        ) : null}
        {presetUsesStylePass(stylePreset) ? (
          <span className="text-xs text-stone-500">
            {styleJob?.status === "running"
              ? `Style pass (${styleJob.progress ?? 0}%${styleJob.step ? ` — ${styleJob.step}` : ""})…`
              : styleJob?.status === "error"
                ? "Style pass failed"
                : planBase.styleMissing
                  ? "Style pass not ready"
                  : stylePreviewUrl
                    ? "Style pass ready"
                    : "Run style pass after fills"}
          </span>
        ) : null}
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={settings.showFeatureOutlines ?? true}
            onChange={(e) =>
              onPlanSettingsChange({ ...settings, showFeatureOutlines: e.target.checked })
            }
          />
          <span className="text-xs text-stone-700">Feature outlines</span>
        </label>
        <button
          type="button"
          onClick={() => {
            onSavePlanSettings();
            if (presetUsesStylePass(stylePreset)) {
              void ensureStylePass(stylePreset);
            }
          }}
          disabled={saving}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save plan settings"}
        </button>
      </div>

      {presetUsesStylePass(stylePreset) && styleEntry?.registration ? (
        <details className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-700">
          <summary className="cursor-pointer font-medium text-stone-800">
            Registration diagnostic
          </summary>
          <dl className="mt-2 grid gap-1 sm:grid-cols-3">
            <div>
              <dt className="text-stone-500">Inliers</dt>
              <dd>{styleEntry.registration.inlierCount}</dd>
            </div>
            <div>
              <dt className="text-stone-500">Residual</dt>
              <dd>{styleEntry.registration.residualPct.toFixed(3)}% width</dd>
            </div>
            <div>
              <dt className="text-stone-500">Label mode</dt>
              <dd>{styleEntry.registration.labelMode}</dd>
            </div>
          </dl>
          {planBase.styleMissing ? (
            <p className="mt-2 text-red-700">{planBase.styleError}</p>
          ) : null}
        </details>
      ) : planBase.styleMissing && presetUsesStylePass(stylePreset) ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <p className="font-medium">Style pass failed</p>
          <p className="mt-1 whitespace-pre-wrap">{planBase.styleError}</p>
        </div>
      ) : null}

      {watercolorActive ? (
        <div
          className={`rounded-lg border p-3 text-xs ${
            watercolorJob?.status === "failed"
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-violet-200 bg-violet-50 text-violet-900"
          }`}
        >
          {watercolorJob?.status === "running" ? (
            <p>
              Watercolor filter{" "}
              <span className="font-medium">
                {watercolorJob.progress ?? 0}%
                {watercolorJob.step ? ` — ${watercolorJob.step}` : ""}
              </span>
            </p>
          ) : (
            <>
              <p className="font-medium">Watercolor filter failed</p>
              <p className="mt-1 whitespace-pre-wrap">{watercolorJob?.error}</p>
              {watercolorJob?.commandLine ? (
                <p className="mt-2 font-mono text-[10px] opacity-80">{watercolorJob.commandLine}</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {fillError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 whitespace-pre-wrap">
          {fillError}
        </p>
      ) : null}

      {designFeatures.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-stone-200 p-3">
          <p className="text-xs text-stone-600">
            Feature fills add AI material textures for the <strong>Plan drawing</strong> export.
            Requires a clean orthophoto and GEMINI_API_KEY — not needed for the watercolor base
            in the feature editor.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-stone-500">
              Feature fills ({filledCount}/{designFeatures.length} filled)
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {featureFillTotalCostUsd != null && featureFillTotalCostUsd > 0 ? (
                <span className="text-xs text-stone-600">
                  Est. cost: ${featureFillTotalCostUsd.toFixed(2)}
                </span>
              ) : null}
              <button
                type="button"
                disabled={!cleanImageUrl || fillBusy !== null}
                onClick={() => void fillAllEmpty()}
                className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {fillBusy === "all" ? "Filling…" : "Fill all empty"}
              </button>
            </div>
          </div>
          <ul className="divide-y divide-stone-100 text-sm">
            {designFeatures.map((f) => {
              const entry = featureFills?.[f.id];
              const status = entry?.status ?? "none";
              const cropUrl =
                cropPreviews[f.id] ??
                (entry?.cropPreviewFilename
                  ? projectImageUrl(projectId, entry.cropPreviewFilename)
                  : undefined);
              return (
                <li key={f.id} className="flex flex-wrap items-start gap-3 py-2">
                  <div className="min-w-40 flex-1">
                    <p className="font-medium text-stone-800">
                      {f.label || labelForFeatureType(f.featureType, legend)}
                    </p>
                    <p className="text-xs text-stone-500">
                      {status === "filled"
                        ? "Filled"
                        : status === "generating"
                          ? "Generating…"
                          : status === "failed"
                            ? `Failed: ${entry?.error ?? "unknown"}`
                            : "Not filled"}
                    </p>
                  </div>
                  {cropUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={cropUrl}
                      alt="Crop preview"
                      className="h-16 w-16 rounded border border-stone-200 object-cover"
                    />
                  ) : null}
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      disabled={!cleanImageUrl || fillBusy !== null}
                      onClick={() => void previewCrop(f.id)}
                      className="rounded border border-stone-300 px-2 py-1 text-xs disabled:opacity-50"
                    >
                      Preview crop
                    </button>
                    <button
                      type="button"
                      disabled={!cleanImageUrl || fillBusy !== null}
                      onClick={() => void fillFeature(f.id, status === "filled")}
                      className="rounded border border-emerald-700 px-2 py-1 text-xs text-emerald-800 disabled:opacity-50"
                    >
                      {fillBusy === f.id
                        ? "…"
                        : status === "filled"
                          ? "Regenerate"
                          : "Fill"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {features.length === 0 ? (
        <p className="text-sm text-stone-500">Add features via interpret and the polygon editor.</p>
      ) : (
        <PlanDrawing
          project={{
            features,
            northRotationDeg,
            calibration,
            pixelsPerFoot,
            georefCtx,
            elevationAnalysis,
            editorSettings,
            metadata,
          }}
          legend={legend}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          baseImageUrl={planBase.url ?? rawBaseImageUrl}
          compareRawUrl={cleanImageUrl}
          baseUsesStylePass={planBase.usesStylePass}
          styleMissing={planBase.styleMissing}
          styleError={planBase.styleError}
          planSettings={settings}
          fitToContent
          hideFillsWhenStyled={planBase.usesStylePass && !planBase.styleMissing}
          featureFills={featureFills}
          featureFillImageUrl={(filename) => projectImageUrl(projectId, filename)}
        />
      )}
    </section>
  );
}
