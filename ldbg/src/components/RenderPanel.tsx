"use client";

import { useRef, useState } from "react";
import { formatUsd } from "@/lib/interpret-cost";
import { projectImageUrl } from "@/lib/image-utils";
import { withBasePath } from "@/lib/paths";
import type { RenderMeta, RenderSlots } from "@/lib/project-schema";
import {
  RENDER_SLOT_KEYS,
  SLOT_LABELS,
  type RenderSlotKey,
} from "@/lib/render-slots";

type Props = {
  projectId: string;
  renderSlots?: RenderSlots;
  renderMeta?: RenderMeta;
  hasDesignContent: boolean;
  onRendersChange: (payload: {
    renderSlots?: RenderSlots;
    renderMeta?: RenderMeta;
  }) => void;
};

export function RenderPanel({
  projectId,
  renderSlots,
  renderMeta,
  hasDesignContent,
  onRendersChange,
}: Props) {
  const [busySlot, setBusySlot] = useState<RenderSlotKey | null>(null);
  const [error, setError] = useState("");
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function generate(slot: RenderSlotKey, force = false) {
    setBusySlot(slot);
    setError("");
    try {
      const res = await fetch(withBasePath(`/api/projects/${projectId}/render`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot, force }),
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
    setBusySlot(slot);
    setError("");
    try {
      const form = new FormData();
      form.set("slot", slot);
      form.set("file", file);
      const res = await fetch(
        withBasePath(`/api/projects/${projectId}/render-upload`),
        { method: "POST", body: form }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
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
          AI perspective views for the design board — cached per slot, or upload
          your own photo. Enable with{" "}
          <code className="rounded bg-stone-100 px-1 text-xs">
            LDBG_RENDERS_ENABLED=true
          </code>{" "}
          and set{" "}
          <code className="rounded bg-stone-100 px-1 text-xs">
            GEMINI_API_KEY
          </code>
          .
        </p>
      </div>

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
          const busy = busySlot === slot;

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
                    {meta.source === "upload" ? "Uploaded" : "Generated"}
                    {meta.provider ? ` · ${meta.provider}` : ""}
                  </span>
                ) : null}
              </div>

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

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!hasDesignContent || busy || !!filename}
                  onClick={() => generate(slot, false)}
                  className="rounded-md bg-stone-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  {busy ? "Working…" : "Generate"}
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
        Estimated cost per new Gemini render: ~{formatUsd(0.04)}. Cached slots
        are free on reload.
      </p>
    </section>
  );
}
