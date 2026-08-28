"use client";

import { useCallback, useEffect, useState } from "react";
import {
  EDITOR_BASE_PRESET_LABELS,
  EDITOR_BASE_PRESET_OPTIONS,
  editorUsesWatercolorFilter,
  type EditorBasePresetId,
} from "@/config/watercolor";
import type { EditorSettings } from "@/lib/project-schema";
import { withBasePath } from "@/lib/paths";
import type { WatercolorJob } from "@/lib/watercolor-schema";
import {
  formatWatercolorJobStatus,
  resolveWatercolorPreviewUrl,
  type WatercolorPollResult,
} from "@/lib/watercolor-client";

type Props = {
  projectId: string;
  sourceImageUrl: string;
  imageWidth: number;
  imageHeight: number;
  editorSettings?: EditorSettings;
  onEditorSettingsChange: (settings: EditorSettings) => void;
  /** True once scale calibration (or WebODM georef) is complete. */
  ready: boolean;
};

export function WatercolorBasePanel({
  projectId,
  sourceImageUrl,
  imageWidth,
  imageHeight,
  editorSettings,
  onEditorSettingsChange,
  ready,
}: Props) {
  const [baseChoice, setBaseChoice] = useState<EditorBasePresetId>(
    editorSettings?.watercolorPreset ?? "watercolor-soft"
  );
  const [previewUrl, setPreviewUrl] = useState<string | undefined>();
  const [job, setJob] = useState<WatercolorJob | null>(null);
  const [busy, setBusy] = useState(false);

  const watercolorEnabled = editorUsesWatercolorFilter(baseChoice);

  const persistChoice = useCallback(
    (next: EditorBasePresetId) => {
      setBaseChoice(next);
      const useFilter = editorUsesWatercolorFilter(next);
      onEditorSettingsChange({
        hiddenFeatureTypes: editorSettings?.hiddenFeatureTypes ?? [],
        watercolorPreset: next,
        editorBaseLayer: useFilter
          ? editorSettings?.editorBaseLayer === "clean"
            ? "clean"
            : "watercolor"
          : "annotated",
      });
    },
    [editorSettings, onEditorSettingsChange]
  );

  const applyPollResult = useCallback(
    async (data: WatercolorPollResult) => {
      setJob(data.job);
      const url = await resolveWatercolorPreviewUrl(projectId, data.entry, data.cacheReady);
      if (url) setPreviewUrl(url);
    },
    [projectId]
  );

  const fetchStatus = useCallback(async (): Promise<WatercolorPollResult | null> => {
    if (!editorUsesWatercolorFilter(baseChoice)) return null;
    const res = await fetch(
      withBasePath(
        `/api/projects/${encodeURIComponent(projectId)}/watercolor?source=annotated&preset=${encodeURIComponent(baseChoice)}`
      ),
      { cache: "no-store" }
    );
    if (!res.ok) {
      console.warn(
        `[ldbg watercolor] status poll HTTP ${res.status} preset=${baseChoice} project=${projectId}`
      );
      return null;
    }
    return (await res.json()) as WatercolorPollResult;
  }, [projectId, baseChoice]);

  const pollJob = useCallback(async () => {
    try {
      const data = await fetchStatus();
      if (data) await applyPollResult(data);
    } catch {
      /* best-effort */
    }
  }, [fetchStatus, applyPollResult]);

  const startWatercolor = useCallback(async () => {
    if (!editorUsesWatercolorFilter(baseChoice)) return;
    setBusy(true);
    try {
      const res = await fetch(
        withBasePath(`/api/projects/${encodeURIComponent(projectId)}/watercolor`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preset: baseChoice, source: "annotated" }),
        }
      );
      const data = (await res.json()) as WatercolorPollResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Watercolor failed to start");
      await applyPollResult(data);
    } catch (e) {
      setJob({
        status: "failed",
        progress: 0,
        error: e instanceof Error ? e.message : "Watercolor failed",
      });
    } finally {
      setBusy(false);
    }
  }, [projectId, baseChoice, applyPollResult]);

  useEffect(() => {
    if (editorSettings?.watercolorPreset) {
      setBaseChoice(editorSettings.watercolorPreset);
    }
  }, [editorSettings?.watercolorPreset]);

  useEffect(() => {
    if (!ready || !watercolorEnabled) {
      if (!watercolorEnabled) {
        setPreviewUrl(undefined);
        setJob(null);
      }
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchStatus();
        if (!data || cancelled) return;
        await applyPollResult(data);
        if (cancelled) return;
        if (!data.cacheReady && data.job?.status !== "running") {
          await startWatercolor();
        }
      } catch {
        if (!cancelled) await startWatercolor();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, watercolorEnabled, fetchStatus, applyPollResult, startWatercolor]);

  useEffect(() => {
    if (!watercolorEnabled) return;
    const needsPoll =
      job?.status === "running" || (job?.status === "complete" && !previewUrl);
    if (!needsPoll) return;
    void pollJob();
    const t = setInterval(() => void pollJob(), 1500);
    return () => clearInterval(t);
  }, [watercolorEnabled, job?.status, previewUrl, pollJob]);

  if (!ready) {
    return (
      <section className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600">
        <h2 className="text-lg font-semibold text-stone-900">Feature editor base</h2>
        <p className="mt-1">
          Complete scale calibration first — then choose an optional watercolor fallback or draw
          directly on your annotated photo.
        </p>
      </section>
    );
  }

  const statusLabel = watercolorEnabled
    ? formatWatercolorJobStatus(job, !!previewUrl)
    : "Using annotated photo — no filter";

  return (
    <section className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/60 p-4">
      <div>
        <h2 className="text-lg font-semibold text-violet-950">Feature editor base</h2>
        <p className="mt-1 text-sm text-violet-900">
          Optional deterministic watercolor fallback, or skip it and edit on your annotated photo
          (e.g. when you already have a Gendo or hand-drawn base). Compare source vs filtered when
          a filter preset is selected.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-48">
          <span className="text-xs font-medium text-violet-800">Editor base</span>
          <select
            className="mt-1 block min-h-10 w-full rounded border border-violet-300 bg-white px-2 py-1.5 text-sm"
            value={baseChoice}
            onChange={(e) => {
              const next = e.target.value as EditorBasePresetId;
              setPreviewUrl(undefined);
              setJob(null);
              persistChoice(next);
            }}
          >
            {EDITOR_BASE_PRESET_OPTIONS.map((id) => (
              <option key={id} value={id}>
                {EDITOR_BASE_PRESET_LABELS[id]}
              </option>
            ))}
          </select>
        </label>
        {watercolorEnabled ? (
          <button
            type="button"
            disabled={busy || job?.status === "running"}
            onClick={() => void startWatercolor()}
            className="min-h-10 rounded-md bg-violet-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy || job?.status === "running" ? "Generating…" : "Regenerate watercolor"}
          </button>
        ) : null}
        {statusLabel ? (
          <span className="text-xs text-violet-800">{statusLabel}</span>
        ) : null}
      </div>

      {watercolorEnabled && job?.status === "failed" ? (
        <p className="whitespace-pre-wrap rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {job.error}
          {job.pythonInterpreter ? `\nInterpreter: ${job.pythonInterpreter}` : ""}
        </p>
      ) : null}

      {watercolorEnabled && previewUrl ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-medium text-violet-800">Source (annotated)</p>
            <div
              className="overflow-hidden rounded-lg border border-violet-200 bg-white"
              style={{ aspectRatio: `${imageWidth} / ${imageHeight}` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={sourceImageUrl}
                alt="Annotated source"
                className="block h-full w-full object-contain"
              />
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-violet-800">Watercolor fallback</p>
            <div
              className="overflow-hidden rounded-lg border border-violet-200 bg-white"
              style={{ aspectRatio: `${imageWidth} / ${imageHeight}` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="Watercolor fallback output"
                className="block h-full w-full object-contain"
              />
            </div>
          </div>
        </div>
      ) : (
        <div>
          <p className="mb-1 text-xs font-medium text-violet-800">
            {watercolorEnabled ? "Source (annotated)" : "Annotated photo (editor base)"}
          </p>
          <div
            className="overflow-hidden rounded-lg border border-violet-200 bg-white"
            style={{ aspectRatio: `${imageWidth} / ${imageHeight}` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sourceImageUrl}
              alt={
                watercolorEnabled
                  ? "Annotated photo (watercolor pending)"
                  : "Annotated photo for feature editor"
              }
              className="block h-full w-full object-contain"
            />
          </div>
        </div>
      )}
    </section>
  );
}
