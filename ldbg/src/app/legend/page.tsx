"use client";

import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { DEFAULT_LEGEND, type LegendEntry } from "@/config/legend";
import {
  DEFAULT_ANNOTATION_PALETTE,
  type AnnotationPaletteEntry,
} from "@/lib/annotation-palette";
import { withBasePath } from "@/lib/paths";

function AnnotationPaletteSection() {
  const [entries, setEntries] = useState<AnnotationPaletteEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch(withBasePath("/api/annotation-palette"))
      .then((r) => r.json())
      .then(setEntries)
      .catch(() => setEntries(DEFAULT_ANNOTATION_PALETTE));
  }, []);

  async function save() {
    setSaving(true);
    setMessage("");
    const res = await fetch(withBasePath("/api/annotation-palette"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entries),
    });
    setSaving(false);
    setMessage(res.ok ? "Palette saved." : "Save failed.");
  }

  function update(i: number, patch: Partial<AnnotationPaletteEntry>) {
    setEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }

  return (
    <section className="mb-8 rounded-xl border border-violet-200 bg-violet-50/40 p-4">
      <h3 className="text-lg font-semibold text-stone-900">Annotation palette (CV import)</h3>
      <p className="mb-4 text-sm text-stone-600">
        Tune hex reference, Lab distance threshold, and geometry type (area / line / point) without
        redeploying.
      </p>
      <div className="space-y-3">
        {entries.map((e, i) => (
          <div
            key={e.id}
            className="grid gap-2 rounded-lg border border-stone-200 bg-white p-3 md:grid-cols-4"
          >
            <label className="text-xs">
              Label
              <input
                className="mt-1 w-full rounded border px-2 py-1 text-sm"
                value={e.label}
                onChange={(ev) => update(i, { label: ev.target.value })}
              />
            </label>
            <label className="text-xs">
              hexRef
              <input
                className="mt-1 w-full rounded border px-2 py-1 font-mono text-sm"
                value={e.hexRef}
                onChange={(ev) => update(i, { hexRef: ev.target.value })}
              />
            </label>
            <label className="text-xs">
              geometryType
              <select
                className="mt-1 w-full rounded border px-2 py-1 text-sm"
                value={e.geometryType}
                onChange={(ev) =>
                  update(i, {
                    geometryType: ev.target.value as AnnotationPaletteEntry["geometryType"],
                  })
                }
              >
                <option value="area">area</option>
                <option value="line">line</option>
                <option value="point">point</option>
              </select>
            </label>
            <label className="text-xs">
              maxLabDistance
              <input
                type="number"
                className="mt-1 w-full rounded border px-2 py-1 text-sm"
                value={e.maxLabDistance}
                onChange={(ev) => update(i, { maxLabDistance: Number(ev.target.value) })}
              />
            </label>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-4 rounded-lg bg-violet-700 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save annotation palette"}
      </button>
      {message ? <span className="ml-3 text-sm text-stone-600">{message}</span> : null}
    </section>
  );
}

export default function LegendEditorPage() {
  const [entries, setEntries] = useState<LegendEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch(withBasePath("/api/legend"))
      .then((r) => r.json())
      .then(setEntries)
      .catch(() => setEntries(DEFAULT_LEGEND));
  }, []);

  async function save() {
    setSaving(true);
    setMessage("");
    const res = await fetch(withBasePath("/api/legend"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entries),
    });
    setSaving(false);
    setMessage(res.ok ? "Legend saved." : "Save failed.");
  }

  function update(i: number, patch: Partial<LegendEntry>) {
    setEntries((prev) =>
      prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e))
    );
  }

  function addEntry() {
    setEntries((prev) => [
      ...prev,
      {
        id: `custom_${Date.now()}`,
        label: "New feature",
        featureType: "custom_feature",
        colorHint: { hex: "#888888", description: "describe color" },
        shapeHint: "describe shape",
        defaultMaterial: "",
        renderStyle: { fill: "#cccccc", stroke: "#666666" },
        unit: "sqft",
      },
    ]);
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h2 className="mb-2 text-2xl font-semibold">Legend editor</h2>
        <p className="mb-6 text-stone-600">
          Changes save to storage and flow into the plan renderer automatically. Annotation palette
          drives CV import color classification.
        </p>
        <AnnotationPaletteSection />
        <h3 className="mb-4 mt-10 text-lg font-semibold">Plan legend (render styles)</h3>
        <div className="space-y-4">
          {entries.map((e, i) => (
            <div
              key={e.id}
              className="grid gap-2 rounded-lg border border-stone-200 bg-white p-4 md:grid-cols-2"
            >
              <label className="text-sm">
                Label
                <input
                  className="mt-1 w-full rounded border px-2 py-1"
                  value={e.label}
                  onChange={(ev) => update(i, { label: ev.target.value })}
                />
              </label>
              <label className="text-sm">
                featureType
                <input
                  className="mt-1 w-full rounded border px-2 py-1 font-mono text-sm"
                  value={e.featureType}
                  onChange={(ev) => update(i, { featureType: ev.target.value })}
                />
              </label>
              <label className="text-sm md:col-span-2">
                Color hint
                <input
                  className="mt-1 w-full rounded border px-2 py-1"
                  value={e.colorHint.description}
                  onChange={(ev) =>
                    update(i, {
                      colorHint: { ...e.colorHint, description: ev.target.value },
                    })
                  }
                />
              </label>
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={addEntry}
            className="rounded-lg border border-stone-300 px-4 py-2 text-sm"
          >
            Add entry
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save legend"}
          </button>
          {message ? <span className="self-center text-sm text-stone-600">{message}</span> : null}
        </div>
      </main>
    </>
  );
}
