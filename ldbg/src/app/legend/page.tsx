"use client";

import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { DEFAULT_LEGEND, type LegendEntry } from "@/config/legend";
import { withBasePath } from "@/lib/paths";

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
          Changes save to storage and flow into AI prompts and the plan renderer automatically.
        </p>
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
