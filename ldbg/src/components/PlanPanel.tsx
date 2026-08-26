"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PlanDrawing } from "@/components/PlanDrawing";
import type { LegendEntry } from "@/config/legend";
import type { StoredElevationAnalysis } from "@/lib/elevation-schema";
import type { GeorefDisplayContext } from "@/lib/georef-display";
import { projectImageUrl } from "@/lib/image-utils";
import type { InterpretFeature } from "@/lib/interpret-schema";
import type { PlanRenderJob } from "@/lib/plan-render-schema";
import { resolvePlanBaseLayer } from "@/lib/plan-base-layer";
import { withBasePath } from "@/lib/paths";
import type { Calibration, EditorSettings, PlanSettings, ProjectMetadata } from "@/lib/project-schema";

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
  planRenderCache?: Record<string, import("@/lib/plan-render-schema").PlanRenderCacheEntry>;
  onPlanSettingsChange: (settings: PlanSettings) => void;
  onSavePlanSettings: () => void;
  saving?: boolean;
};

type BaseLayerChoice = "clean" | "desaturated" | "white" | "ai_render";

const BASE_LAYER_OPTIONS: { value: BaseLayerChoice; label: string; needsAi?: boolean }[] = [
  { value: "clean", label: "Clean orthophoto" },
  { value: "desaturated", label: "Desaturated orthophoto" },
  { value: "ai_render", label: "AI plan render", needsAi: true },
  { value: "white", label: "White + house footprint" },
];

function choiceFromSettings(settings: PlanSettings): BaseLayerChoice {
  if (settings.baseMode === "white") return "white";
  if (settings.baseMode === "ai_render") return "ai_render";
  if (settings.basePreset === "desaturated") return "desaturated";
  return "clean";
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
  planRenderCache,
  onPlanSettingsChange,
  onSavePlanSettings,
  saving,
}: Props) {
  const settings: PlanSettings = planSettings ?? {
    baseMode: "orthophoto",
    basePreset: "off",
    orthophotoOpacity: 0.4,
    showFeatureOutlines: true,
    showContours: false,
    showDrainageArrows: false,
    contourMinorFt: 1,
    contourMajorFt: 5,
  };

  const [job, setJob] = useState<PlanRenderJob | null>(null);
  const [maskPreviewUrl, setMaskPreviewUrl] = useState<string | undefined>();
  const [renderError, setRenderError] = useState("");

  const renderEntry = useMemo(() => {
    if (!planRenderCache) return undefined;
    return Object.values(planRenderCache).find((e) => e.quality === "draft");
  }, [planRenderCache]);

  const planRenderPreviewUrl = renderEntry?.previewFilename
    ? projectImageUrl(projectId, renderEntry.previewFilename)
    : renderEntry?.renderFilename
      ? projectImageUrl(projectId, renderEntry.renderFilename)
      : undefined;

  const planBase = useMemo(
    () =>
      resolvePlanBaseLayer(settings, {
        rawUrl: rawBaseImageUrl,
        planRenderUrl: planRenderPreviewUrl,
        planRenderEntry: renderEntry,
      }),
    [settings, rawBaseImageUrl, planRenderPreviewUrl, renderEntry]
  );

  const pollJob = useCallback(async () => {
    try {
      const res = await fetch(
        withBasePath(`/api/plan-render?projectId=${encodeURIComponent(projectId)}`)
      );
      const data = (await res.json()) as {
        job: PlanRenderJob;
        cacheReady: boolean;
        registrationPassed?: boolean;
        registrationDisplacementPct?: number;
      };
      setJob(data.job);
      if (data.cacheReady && data.job.status === "complete") {
        window.location.reload();
      }
    } catch {
      /* ignore */
    }
  }, [projectId]);

  useEffect(() => {
    if (job?.status === "running") {
      const t = setInterval(() => void pollJob(), 2000);
      return () => clearInterval(t);
    }
  }, [job?.status, pollJob]);

  async function generateMaskPreview() {
    setRenderError("");
    try {
      const res = await fetch(withBasePath("/api/plan-render"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, action: "mask" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Mask failed");
      setMaskPreviewUrl(projectImageUrl(projectId, data.maskFilename));
    } catch (e) {
      setRenderError(e instanceof Error ? e.message : "Mask failed");
    }
  }

  async function runPlanRender(quality: "draft" | "final") {
    setRenderError("");
    try {
      const res = await fetch(withBasePath("/api/plan-render"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, quality, action: "render" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Render failed");
      setJob(data.job ?? { status: "running", progress: 5 });
    } catch (e) {
      setRenderError(e instanceof Error ? e.message : "Render failed");
    }
  }

  const handleBaseLayerChange = (value: BaseLayerChoice) => {
    if (value === "white") {
      onPlanSettingsChange({ ...settings, baseMode: "white" });
      return;
    }
    if (value === "ai_render") {
      onPlanSettingsChange({ ...settings, baseMode: "ai_render" });
      return;
    }
    onPlanSettingsChange({
      ...settings,
      baseMode: "orthophoto",
      basePreset: value === "desaturated" ? "desaturated" : "off",
    });
  };

  const selectValue = choiceFromSettings(settings);
  const canAiRender = !!cleanImageUrl;

  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">Plan drawing</h2>
          <p className="text-sm text-stone-600">
            Vector callouts and legend over a clean orthophoto or AI-rendered material backdrop.
            Quantities always come from measured geometry.
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
              <option key={opt.value} value={opt.value} disabled={opt.needsAi && !renderEntry}>
                {opt.label}
                {opt.needsAi && !renderEntry ? " (generate first)" : ""}
              </option>
            ))}
          </select>
        </label>
        {settings.baseMode === "orthophoto" ? (
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

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-white p-3">
        <span className="text-xs font-medium uppercase tracking-wide text-stone-500">
          AI plan render
        </span>
        <button
          type="button"
          disabled={!canAiRender || job?.status === "running"}
          onClick={() => void generateMaskPreview()}
          className="rounded border border-stone-300 px-3 py-1.5 text-sm disabled:opacity-50"
          title={canAiRender ? undefined : "Upload or ingest a clean orthophoto first"}
        >
          Preview mask
        </button>
        <button
          type="button"
          disabled={!canAiRender || job?.status === "running"}
          onClick={() => void runPlanRender("draft")}
          className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {job?.status === "running" ? `Rendering (${job.progress}%)…` : "Generate draft"}
        </button>
        <button
          type="button"
          disabled={!canAiRender || job?.status === "running"}
          onClick={() => void runPlanRender("final")}
          className="rounded border border-emerald-700 px-3 py-1.5 text-sm text-emerald-800 disabled:opacity-50"
        >
          Final quality
        </button>
        {renderEntry?.registrationPassed === false ? (
          <span className="text-xs text-amber-800">
            Registration warning: {renderEntry.registrationDisplacementPct?.toFixed(3)}% drift — callouts may misalign
          </span>
        ) : null}
        {renderEntry?.registrationPassed ? (
          <span className="text-xs text-emerald-800">
            Registered ({renderEntry.registrationDisplacementPct?.toFixed(3)}% drift)
          </span>
        ) : null}
        {job?.step && job.status === "running" ? (
          <span className="text-xs text-stone-500">{job.step}</span>
        ) : null}
        {renderError ? <span className="text-xs text-red-700">{renderError}</span> : null}
      </div>

      {maskPreviewUrl ? (
        <div className="rounded-lg border border-stone-200 p-2">
          <p className="mb-2 text-xs font-medium text-stone-600">Vector mask preview</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={maskPreviewUrl} alt="Plan mask" className="max-h-64 rounded border border-stone-200" />
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
        />
      )}
    </section>
  );
}
