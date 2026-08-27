"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FILTERED_WATERCOLOR_PRESETS,
  WATERCOLOR_PRESET_LABELS,
} from "@/config/watercolor";
import type { EditorSettings } from "@/lib/project-schema";
import { withBasePath } from "@/lib/paths";
import type { WatercolorJob } from "@/lib/watercolor-schema";
import {
  formatWatercolorJobStatus,
  resolveWatercolorPreviewUrl,
  type WatercolorPollResult,
} from "@/lib/watercolor-client";

type EditorWatercolorPreset = "watercolor-soft" | "watercolor-heavy" | "ink-wash";

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
  const [preset, setPreset] = useState<EditorWatercolorPreset>(
    editorSettings?.watercolorPreset ?? "watercolor-soft"
  );
  const [previewUrl, setPreviewUrl] = useState<string | undefined>();
  const [job, setJob] = useState<WatercolorJob | null>(null);
  const [busy, setBusy] = useState(false);

  const persistPreset = useCallback(
    (next: EditorWatercolorPreset) => {
      setPreset(next);
      onEditorSettingsChange({
        hiddenFeatureTypes: editorSettings?.hiddenFeatureTypes ?? [],
        watercolorPreset: next,
        editorBaseLayer: editorSettings?.editorBaseLayer ?? "watercolor",
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
    const res = await fetch(
      withBasePath(
        `/api/projects/${encodeURIComponent(projectId)}/watercolor?source=annotated&preset=${encodeURIComponent(preset)}`
      ),
      { cache: "no-store" }
    );
    if (!res.ok) {
      console.warn(
        `[ldbg watercolor] status poll HTTP ${res.status} preset=${preset} project=${projectId}`
      );
      return null;
    }
    return (await res.json()) as WatercolorPollResult;
  }, [projectId, preset]);

  const pollJob = useCallback(async () => {
    try {
      const data = await fetchStatus();
      if (data) await applyPollResult(data);
    } catch {
      /* best-effort */
    }
  }, [fetchStatus, applyPollResult]);

  const startWatercolor = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(
        withBasePath(`/api/projects/${encodeURIComponent(projectId)}/watercolor`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preset, source: "annotated" }),
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
  }, [projectId, preset, applyPollResult]);

  useEffect(() => {
    if (!ready) return;
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
  }, [ready, fetchStatus, applyPollResult, startWatercolor]);

  useEffect(() => {
    const needsPoll =
      job?.status === "running" || (job?.status === "complete" && !previewUrl);
    if (!needsPoll) return;
    void pollJob();
    const t = setInterval(() => void pollJob(), 1500);
    return () => clearInterval(t);
  }, [job?.status, previewUrl, pollJob]);

  if (!ready) {
    return (
      <section className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600">
        <h2 className="text-lg font-semibold text-stone-900">Watercolor base</h2>
        <p className="mt-1">Complete scale calibration first — then your annotated photo converts to a watercolor base for editing.</p>
      </section>
    );
  }

  const statusLabel = formatWatercolorJobStatus(job, !!previewUrl);

  return (
    <section className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/60 p-4">
      <div>
        <h2 className="text-lg font-semibold text-violet-950">Watercolor base</h2>
        <p className="mt-1 text-sm text-violet-900">
          Deterministic fallback base on white paper — not the final styled plan. Compare source vs
          filtered below; use the feature editor once generation finishes.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-40">
          <span className="text-xs font-medium text-violet-800">Watercolor style</span>
          <select
            className="mt-1 block min-h-10 w-full rounded border border-violet-300 bg-white px-2 py-1.5 text-sm"
            value={preset}
            onChange={(e) => {
              const next = e.target.value as EditorWatercolorPreset;
              setPreviewUrl(undefined);
              setJob(null);
              persistPreset(next);
            }}
          >
            {FILTERED_WATERCOLOR_PRESETS.map((id) => (
              <option key={id} value={id}>
                {WATERCOLOR_PRESET_LABELS[id]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy || job?.status === "running"}
          onClick={() => void startWatercolor()}
          className="min-h-10 rounded-md bg-violet-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy || job?.status === "running" ? "Generating…" : "Regenerate watercolor"}
        </button>
        {statusLabel ? (
          <span className="text-xs text-violet-800">{statusLabel}</span>
        ) : null}
      </div>

      {job?.status === "failed" ? (
        <p className="whitespace-pre-wrap rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {job.error}
          {job.pythonInterpreter ? `\nInterpreter: ${job.pythonInterpreter}` : ""}
        </p>
      ) : null}

      {previewUrl ? (
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
          <p className="mb-1 text-xs font-medium text-violet-800">Source (annotated)</p>
          <div
            className="overflow-hidden rounded-lg border border-violet-200 bg-white"
            style={{ aspectRatio: `${imageWidth} / ${imageHeight}` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sourceImageUrl}
              alt="Annotated photo (watercolor pending)"
              className="block h-full w-full object-contain"
            />
          </div>
        </div>
      )}
    </section>
  );
}
