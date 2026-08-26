"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PlanDrawing } from "@/components/PlanDrawing";
import {
  FILTERED_WATERCOLOR_PRESETS,
  WATERCOLOR_PRESET_LABELS,
  type WatercolorPresetId,
} from "@/config/watercolor";
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

type BaseLayerChoice = WatercolorPresetId | "white";

const BASE_LAYER_OPTIONS: { value: BaseLayerChoice; label: string }[] = [
  ...Object.entries(WATERCOLOR_PRESET_LABELS).map(([value, label]) => ({
    value: value as WatercolorPresetId,
    label,
  })),
  { value: "white", label: "White + house footprint" },
];

function choiceFromSettings(settings: PlanSettings): BaseLayerChoice {
  if (settings.baseMode === "white") return "white";
  return settings.basePreset ?? "watercolor-soft";
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
    basePreset: "watercolor-soft",
    orthophotoOpacity: 0.4,
    showFeatureOutlines: true,
    showContours: false,
    showDrainageArrows: false,
    contourMinorFt: 1,
    contourMajorFt: 5,
  };

  const [wcJob, setWcJob] = useState<WatercolorJob | null>(null);
  const [watercolorPreviewUrl, setWatercolorPreviewUrl] = useState<string | undefined>();
  const [fillBusy, setFillBusy] = useState<string | null>(null);
  const [fillError, setFillError] = useState("");
  const [cropPreviews, setCropPreviews] = useState<Record<string, string>>({});

  const designFeatures = useMemo(
    () =>
      features.filter(
        (f) =>
          !f.existing &&
          f.featureType !== "property_boundary"
      ),
    [features]
  );

  const pollWatercolor = useCallback(async () => {
    try {
      const res = await fetch(
        withBasePath(`/api/projects/${encodeURIComponent(projectId)}/watercolor`)
      );
      const data = (await res.json()) as {
        job: WatercolorJob;
        cacheReady: boolean;
        entry?: { previewFilename: string; fullFilename: string };
      };
      setWcJob(data.job);
      if (data.cacheReady && data.entry?.previewFilename) {
        setWatercolorPreviewUrl(projectImageUrl(projectId, data.entry.previewFilename));
      }
    } catch {
      /* ignore */
    }
  }, [projectId]);

  useEffect(() => {
    void pollWatercolor();
  }, [pollWatercolor, settings.basePreset]);

  useEffect(() => {
    if (wcJob?.status === "running") {
      const t = setInterval(() => void pollWatercolor(), 2000);
      return () => clearInterval(t);
    }
  }, [wcJob?.status, pollWatercolor]);

  const planBase = useMemo(
    () =>
      resolvePlanBaseLayer(settings, {
        rawUrl: rawBaseImageUrl,
        watercolorPreviewUrl,
      }),
    [settings, rawBaseImageUrl, watercolorPreviewUrl]
  );

  async function ensureWatercolor(preset: WatercolorPresetId) {
    if (!FILTERED_WATERCOLOR_PRESETS.includes(preset)) return;
    try {
      const res = await fetch(
        withBasePath(`/api/projects/${encodeURIComponent(projectId)}/watercolor`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preset }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Watercolor job failed");
      setWcJob(data.job ?? { status: "running", progress: 0 });
    } catch (e) {
      setFillError(e instanceof Error ? e.message : "Watercolor failed");
    }
  }

  const handleBaseLayerChange = (value: BaseLayerChoice) => {
    if (value === "white") {
      onPlanSettingsChange({ ...settings, baseMode: "white" });
      return;
    }
    const next = { ...settings, baseMode: "orthophoto" as const, basePreset: value };
    onPlanSettingsChange(next);
    if (FILTERED_WATERCOLOR_PRESETS.includes(value)) {
      void ensureWatercolor(value);
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

  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">Plan drawing</h2>
          <p className="text-sm text-stone-600">
            Watercolor-filtered base with per-feature material fills clipped to measured geometry.
            Quantities always come from vector features, not rendered imagery.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-lg bg-stone-50 p-3 text-sm">
        <label className="block">
          <span className="text-xs font-medium text-stone-600">Base layer</span>
          <select
            className="mt-1 block rounded border border-stone-300 px-2 py-1"
            value={selectValue}
            onChange={(e) => handleBaseLayerChange(e.target.value as BaseLayerChoice)}
          >
            {BASE_LAYER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        {settings.baseMode === "orthophoto" &&
        (settings.basePreset === "off" || settings.basePreset === "desaturated") ? (
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
        {FILTERED_WATERCOLOR_PRESETS.includes(settings.basePreset) ? (
          <span className="text-xs text-stone-500">
            {wcJob?.status === "running"
              ? `Generating watercolor (${wcJob.progress ?? 0}%)…`
              : watercolorPreviewUrl
                ? "Watercolor cache ready"
                : "Watercolor will generate in background"}
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
          onClick={onSavePlanSettings}
          disabled={saving}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save plan settings"}
        </button>
      </div>

      {designFeatures.length > 0 ? (
        <div className="space-y-3 rounded-lg border border-stone-200 p-3">
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
          {fillError ? <p className="text-xs text-red-700">{fillError}</p> : null}
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
          baseImageUrl={planBase.url}
          baseImageFilter={planBase.svgFilter}
          planSettings={settings}
          displayWidth={900}
          featureFills={featureFills}
          featureFillImageUrl={(filename) => projectImageUrl(projectId, filename)}
        />
      )}
    </section>
  );
}
