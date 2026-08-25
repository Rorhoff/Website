"use client";

import { useRef, useState } from "react";
import { formatUsd } from "@/lib/interpret-cost";
import { PRESET_LABELS, type BlenderRenders } from "@/lib/blender-schema";
import { projectImageUrl } from "@/lib/image-utils";
import { withBasePath } from "@/lib/paths";
import type { RenderMeta, RenderSlots } from "@/lib/project-schema";
import {
  RENDER_SLOT_KEYS,
  SLOT_LABELS,
  type RenderSlotKey,
} from "@/lib/render-slots";
import { UPLOAD_MAX_BYTES, uploadPreflightError } from "@/lib/upload-limits";
import { parseUploadErrorResponse, xhrUploadFormData } from "@/lib/upload-xhr";

type Props = {
  projectId: string;
  renderSlots?: RenderSlots;
  renderMeta?: RenderMeta;
  blenderRenders?: BlenderRenders;
  hasDesignContent: boolean;
  hasMesh: boolean;
  onRendersChange: (payload: {
    renderSlots?: RenderSlots;
    renderMeta?: RenderMeta;
    blenderRenders?: BlenderRenders;
  }) => void;
};

export function RenderPanel({
  projectId,
  renderSlots,
  renderMeta,
  blenderRenders,
  hasDesignContent,
  hasMesh,
  onRendersChange,
}: Props) {
  const [busySlot, setBusySlot] = useState<RenderSlotKey | null>(null);
  const [blenderBusy, setBlenderBusy] = useState<RenderSlotKey | null>(null);
  const [quality, setQuality] = useState<"draft" | "final">("draft");
  const [error, setError] = useState("");
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function blenderRender(slot: RenderSlotKey, force = false) {
    setBlenderBusy(slot);
    setError("");
    try {
      const res = await fetch(
        withBasePath(`/api/projects/${projectId}/blender-render`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slot, force }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Blender render failed");
      onRendersChange({ blenderRenders: data.blenderRenders ?? blenderRenders });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Blender render failed");
    } finally {
      setBlenderBusy(null);
    }
  }

  async function generate(slot: RenderSlotKey, force = false) {
    setBusySlot(slot);
    setError("");
    try {
      const res = await fetch(withBasePath(`/api/projects/${projectId}/render`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot, force, quality }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Render failed");

      onRendersChange({
        renderSlots: data.renderSlots ?? {
          ...renderSlots,
          [slot]: data.filename,
        },
        renderMeta: data.renderMeta ?? renderMeta,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Render failed");
    } finally {
      setBusySlot(null);
    }
  }

  async function upload(slot: RenderSlotKey, file: File) {
    if (file.size > UPLOAD_MAX_BYTES) {
      setError(uploadPreflightError(file.size, SLOT_LABELS[slot]));
      return;
    }

    setBusySlot(slot);
    setError("");
    try {
      const form = new FormData();
      form.set("slot", slot);
      form.set("file", file);
      const result = await xhrUploadFormData(
        withBasePath(`/api/projects/${projectId}/render-upload`),
        form
      );

      let data: {
        error?: string;
        renderSlots?: RenderSlots;
        renderMeta?: RenderMeta;
      } = {};
      try {
        data = JSON.parse(result.responseText);
      } catch {
        // ignore
      }

      if (!result.ok) {
        throw new Error(
          parseUploadErrorResponse(result.status, result.responseText)
        );
      }

      onRendersChange({
        renderSlots: data.renderSlots,
        renderMeta: data.renderMeta,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusySlot(null);
    }
  }

  async function clearSlot(slot: RenderSlotKey) {
    setBusySlot(slot);
    setError("");
    try {
      const res = await fetch(
        withBasePath(`/api/projects/${projectId}/render?slot=${slot}`),
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Clear failed");
      onRendersChange({
        renderSlots: data.renderSlots,
        renderMeta: data.renderMeta,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clear failed");
    } finally {
      setBusySlot(null);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div>
        <h2 className="text-lg font-semibold text-stone-900">
          Perspective renders
        </h2>
        <p className="text-sm text-stone-600">
          Blender builds a geometrically true base from the WebODM mesh; optional
          Gemini pass finishes the look when{" "}
          <code className="rounded bg-stone-100 px-1 text-xs">
            LDBG_RENDER_IMG2IMG=true
          </code>
          . AI-only renders use{" "}
          <code className="rounded bg-stone-100 px-1 text-xs">
            LDBG_RENDERS_ENABLED=true
          </code>
          .
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-stone-600">Gemini quality:</span>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="render-quality"
            checked={quality === "draft"}
            onChange={() => setQuality("draft")}
          />
          Draft (1K, flash)
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="render-quality"
            checked={quality === "final"}
            onChange={() => setQuality("final")}
          />
          Final (4K, pro)
        </label>
      </div>

      {hasMesh ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Textured mesh available — run Blender first, then AI finish (if enabled).
        </p>
      ) : (
        <p className="rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-600">
          No WebODM mesh on this project — ingest{" "}
          <code className="text-xs">odm_textured_model_geo.obj</code> for 3D renders,
          or upload images manually below.
        </p>
      )}

      {!hasDesignContent ? (
        <p className="text-sm text-amber-800">
          Generate design content first — render prompts come from Milestone 5.
        </p>
      ) : null}

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {RENDER_SLOT_KEYS.map((slot) => {
          const filename = renderSlots?.[slot];
          const meta = renderMeta?.[slot];
          const blender = blenderRenders?.[slot];
          const busy = busySlot === slot;
          const bBusy = blenderBusy === slot;

          return (
            <div
              key={slot}
              className="space-y-2 rounded-lg border border-stone-100 bg-stone-50 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-medium text-stone-800">
                  {SLOT_LABELS[slot]}
                </h3>
                {meta ? (
                  <span className="text-xs text-stone-500">
                    {meta.source === "blender+gemini"
                      ? "Blender + Gemini"
                      : meta.source === "upload"
                        ? "Uploaded"
                        : meta.source === "generated"
                          ? "Gemini"
                          : meta.source}
                    {meta.provider ? ` · ${meta.provider}` : ""}
                  </span>
                ) : blender ? (
                  <span className="text-xs text-stone-500">
                    Blender · {PRESET_LABELS[blender.preset]}
                  </span>
                ) : null}
              </div>

              {blender?.filename ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-stone-500">Blender base</p>
                  <div className="aspect-video overflow-hidden rounded-md border border-stone-200 bg-stone-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={projectImageUrl(projectId, blender.filename)}
                      alt={`Blender ${SLOT_LABELS[slot]}`}
                      className="h-full w-full object-cover"
                    />
                  </div>
                </div>
              ) : null}

              <div className="space-y-1">
                {blender?.filename ? (
                  <p className="text-xs font-medium text-stone-500">Board render</p>
                ) : null}
                <div className="aspect-video overflow-hidden rounded-md bg-stone-200">
                {filename ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={projectImageUrl(projectId, filename)}
                    alt={SLOT_LABELS[slot]}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-stone-500">
                    No render yet
                  </div>
                )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {hasMesh ? (
                  <>
                    <button
                      type="button"
                      disabled={!hasDesignContent || bBusy || !!blender}
                      onClick={() => blenderRender(slot, false)}
                      className="rounded-md bg-sky-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                    >
                      {bBusy ? "Blender…" : "Blender 3D"}
                    </button>
                    {blender ? (
                      <button
                        type="button"
                        disabled={!hasDesignContent || bBusy}
                        onClick={() => blenderRender(slot, true)}
                        className="rounded-md border border-sky-300 px-3 py-1.5 text-xs text-sky-900 disabled:opacity-40"
                      >
                        Re-render Blender
                      </button>
                    ) : null}
                  </>
                ) : null}
                <button
                  type="button"
                  disabled={!hasDesignContent || busy || !!filename}
                  onClick={() => generate(slot, false)}
                  className="rounded-md bg-stone-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  {busy ? "Working…" : blender ? "AI finish" : "Generate"}
                </button>
                {filename ? (
                  <button
                    type="button"
                    disabled={!hasDesignContent || busy}
                    onClick={() => generate(slot, true)}
                    className="rounded-md border border-stone-300 px-3 py-1.5 text-xs text-stone-700 disabled:opacity-40"
                  >
                    Regenerate
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => fileRefs.current[slot]?.click()}
                  className="rounded-md border border-stone-300 px-3 py-1.5 text-xs text-stone-700 disabled:opacity-40"
                >
                  Upload
                </button>
                {filename ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => clearSlot(slot)}
                    className="rounded-md px-3 py-1.5 text-xs text-red-700 disabled:opacity-40"
                  >
                    Clear
                  </button>
                ) : null}
              </div>

              <input
                ref={(el) => {
                  fileRefs.current[slot] = el;
                }}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(slot, f);
                  e.target.value = "";
                }}
              />
            </div>
          );
        })}
      </div>

      <p className="text-xs text-stone-500">
        Blender needs <code className="text-xs">LDBG_BLENDER</code> on PATH (or set
        in <code className="text-xs">.env.local</code>). Estimated Gemini finish: ~
        {formatUsd(0.04)} per slot.
      </p>
    </section>
  );
}
