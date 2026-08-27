"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FILTERED_WATERCOLOR_PRESETS,
  WATERCOLOR_PRESET_LABELS,
} from "@/config/watercolor";
import type { EditorSettings } from "@/lib/project-schema";
import { projectImageUrl } from "@/lib/image-utils";
import { withBasePath } from "@/lib/paths";
import type { WatercolorJob } from "@/lib/watercolor-schema";

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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Watercolor failed to start");
      setJob(data.job ?? { status: "running", progress: 0 });
      if (data.cacheReady && data.entry?.previewFilename) {
        setPreviewUrl(projectImageUrl(projectId, data.entry.previewFilename));
      }
    } catch (e) {
      setJob({
        status: "failed",
        progress: 0,
        error: e instanceof Error ? e.message : "Watercolor failed",
      });
    } finally {
      setBusy(false);
    }
  }, [projectId, preset]);

  const pollJob = useCallback(async () => {
    try {
      const res = await fetch(
        withBasePath(
          `/api/projects/${encodeURIComponent(projectId)}/watercolor?source=annotated&preset=${encodeURIComponent(preset)}`
        )
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        job: WatercolorJob;
        cacheReady: boolean;
        entry?: { previewFilename: string };
      };
      setJob(data.job);
      if (data.cacheReady && data.entry?.previewFilename) {
        setPreviewUrl(projectImageUrl(projectId, data.entry.previewFilename));
      }
    } catch {
      /* best-effort */
    }
  }, [projectId, preset]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          withBasePath(
            `/api/projects/${encodeURIComponent(projectId)}/watercolor?source=annotated&preset=${encodeURIComponent(preset)}`
          )
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          job: WatercolorJob;
          cacheReady: boolean;
          entry?: { previewFilename: string };
        };
        setJob(data.job);
        if (data.cacheReady && data.entry?.previewFilename) {
          setPreviewUrl(projectImageUrl(projectId, data.entry.previewFilename));
          return;
        }
        if (!cancelled) await startWatercolor();
      } catch {
        if (!cancelled) await startWatercolor();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, projectId, preset, startWatercolor]);

  useEffect(() => {
    if (job?.status === "running") {
      const t = setInterval(() => void pollJob(), 1500);
      return () => clearInterval(t);
    }
  }, [job?.status, pollJob]);

  if (!ready) {
    return (
      <section className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600">
        <h2 className="text-lg font-semibold text-stone-900">Watercolor base</h2>
        <p className="mt-1">Complete scale calibration first — then your annotated photo converts to a watercolor base for editing.</p>
      </section>
    );
  }

  const displayUrl = previewUrl ?? sourceImageUrl;
  const showingSource = !previewUrl && job?.status !== "running";

  return (
    <section className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/60 p-4">
      <div>
        <h2 className="text-lg font-semibold text-violet-950">Watercolor base</h2>
        <p className="mt-1 text-sm text-violet-900">
          Your annotated photo is converted to a watercolor base before feature editing. No fills or
          plan settings are required — pick a style below and wait for generation to finish, then
          continue to the feature editor.
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
        {job?.status === "running" ? (
          <span className="text-xs text-violet-800">
            {job.progress ?? 0}%{job.step ? ` — ${job.step}` : ""}
          </span>
        ) : previewUrl ? (
          <span className="text-xs font-medium text-violet-700">Watercolor ready</span>
        ) : showingSource ? (
          <span className="text-xs text-violet-700">Showing annotated photo until ready</span>
        ) : null}
      </div>

      {job?.status === "failed" ? (
        <p className="whitespace-pre-wrap rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          {job.error}
          {job.pythonInterpreter ? `\nInterpreter: ${job.pythonInterpreter}` : ""}
        </p>
      ) : null}

      <div
        className="overflow-hidden rounded-lg border border-violet-200 bg-stone-900"
        style={{ aspectRatio: `${imageWidth} / ${imageHeight}` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={displayUrl}
          alt={previewUrl ? "Watercolor base preview" : "Annotated photo (watercolor pending)"}
          className="block h-full w-full object-contain"
        />
      </div>
    </section>
  );
}
