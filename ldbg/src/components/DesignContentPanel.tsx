"use client";

import { useCallback, useEffect, useState } from "react";
import { formatUsd } from "@/lib/interpret-cost";
import type {
  MaterialFinish,
  PlantEntry,
  RenderPrompt,
  StoredDesignContent,
  TakeoffLine,
} from "@/lib/design-content-schema";
import { withBasePath } from "@/lib/paths";

type Props = {
  projectId: string;
  designContent?: StoredDesignContent;
  onDesignContentChange: (content: StoredDesignContent) => void;
  hasFeatures: boolean;
  calibrated: boolean;
};

export function DesignContentPanel({
  projectId,
  designContent,
  onDesignContentChange,
  hasFeatures,
  calibrated,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<StoredDesignContent | null>(designContent ?? null);

  useEffect(() => {
    if (designContent) setDraft(designContent);
  }, [designContent]);

  const content = draft ?? designContent;

  const syncDraft = useCallback((next: StoredDesignContent) => {
    setDraft(next);
    onDesignContentChange(next);
  }, [onDesignContentChange]);

  async function generate(force = false) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(withBasePath("/api/design-content"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, force }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      syncDraft(data.designContent);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function save(approved = false) {
    if (!content) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(withBasePath("/api/design-content"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, designContent: content, approved }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      syncDraft(data.designContent);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function updateConcept(i: number, value: string) {
    if (!content) return;
    const bullets = [...content.conceptOverview];
    bullets[i] = value;
    syncDraft({ ...content, conceptOverview: bullets });
  }

  function addConceptBullet() {
    if (!content) return;
    syncDraft({
      ...content,
      conceptOverview: [...content.conceptOverview, ""],
    });
  }

  function updatePlant(i: number, patch: Partial<PlantEntry>) {
    if (!content) return;
    const plants = content.plantPalette.map((p, idx) =>
      idx === i ? { ...p, ...patch } : p
    );
    syncDraft({ ...content, plantPalette: plants });
  }

  function updateMaterial(i: number, patch: Partial<MaterialFinish>) {
    if (!content) return;
    const mats = content.materialsAndFinishes.map((m, idx) =>
      idx === i ? { ...m, ...patch } : m
    );
    syncDraft({ ...content, materialsAndFinishes: mats });
  }

  function updateTakeoff(i: number, patch: Partial<TakeoffLine>) {
    if (!content) return;
    const lines = content.takeoff.map((t, idx) =>
      idx === i ? { ...t, ...patch } : t
    );
    syncDraft({ ...content, takeoff: lines });
  }

  function updateRenderPrompt(i: number, patch: Partial<RenderPrompt>) {
    if (!content) return;
    const prompts = content.renderPrompts.map((r, idx) =>
      idx === i ? { ...r, ...patch } : r
    );
    syncDraft({ ...content, renderPrompts: prompts });
  }

  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">Design content</h2>
          <p className="text-sm text-stone-600">
            Claude drafts board copy — concept, plants, materials, takeoff context, and render
            prompts. Edit everything before approving.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !hasFeatures}
            onClick={() => generate(!!content)}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Generating…" : content ? "Re-generate" : "Generate content"}
          </button>
          {content ? (
            <>
              <button
                type="button"
                disabled={saving}
                onClick={() => save(false)}
                className="rounded-lg border border-stone-300 px-4 py-2 text-sm disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save edits"}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => save(true)}
                className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Approve & save
              </button>
            </>
          ) : null}
        </div>
      </div>

      {!hasFeatures ? (
        <p className="text-sm text-amber-800">Add features via interpret before generating content.</p>
      ) : !calibrated ? (
        <p className="text-sm text-amber-800">
          Calibrate scale for accurate takeoff quantities (takeoff is computed server-side).
        </p>
      ) : null}

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}

      {content?.approvedAt ? (
        <p className="text-sm text-emerald-700">
          Approved {new Date(content.approvedAt).toLocaleString()}
        </p>
      ) : null}

      {content?.tokenUsage ? (
        <p className="text-xs text-stone-500">
          Tokens: {content.tokenUsage.input} in / {content.tokenUsage.output} out
          {content.estimatedCostUsd != null
            ? ` · est. ${formatUsd(content.estimatedCostUsd)}`
            : ""}
        </p>
      ) : null}

      {!content ? (
        <p className="text-sm text-stone-500">No design content yet.</p>
      ) : (
        <div className="space-y-6">
          <div>
            <h3 className="font-medium text-stone-900">Concept overview</h3>
            <ul className="mt-2 space-y-2">
              {content.conceptOverview.map((bullet, i) => (
                <li key={i}>
                  <textarea
                    className="w-full rounded border border-stone-300 px-3 py-2 text-sm"
                    rows={2}
                    value={bullet}
                    onChange={(e) => updateConcept(i, e.target.value)}
                  />
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={addConceptBullet}
              className="mt-2 text-sm text-emerald-700 underline"
            >
              Add bullet
            </button>
          </div>

          <div>
            <h3 className="font-medium text-stone-900">Plant palette</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-stone-50 text-stone-600">
                  <tr>
                    <th className="px-2 py-1">Common</th>
                    <th className="px-2 py-1">Botanical</th>
                    <th className="px-2 py-1">Size</th>
                    <th className="px-2 py-1">Water</th>
                    <th className="px-2 py-1">Sun</th>
                    <th className="px-2 py-1">Placement</th>
                    <th className="px-2 py-1">Why chosen</th>
                  </tr>
                </thead>
                <tbody>
                  {content.plantPalette.map((p, i) => (
                    <tr key={i} className="border-t border-stone-100">
                      {(
                        [
                          "commonName",
                          "botanicalName",
                          "matureSize",
                          "waterNeeds",
                          "sunExposure",
                          "placement",
                          "whyChosen",
                        ] as const
                      ).map((field) => (
                        <td key={field} className="px-1 py-1">
                          <input
                            className="w-full min-w-24 rounded border px-1 py-0.5"
                            value={p[field]}
                            onChange={(e) => updatePlant(i, { [field]: e.target.value })}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="font-medium text-stone-900">Materials & finishes</h3>
            {content.materialsAndFinishes.length === 0 ? (
              <p className="mt-1 text-sm text-stone-500">None generated.</p>
            ) : (
              <ul className="mt-2 space-y-3">
                {content.materialsAndFinishes.map((m, i) => (
                  <li
                    key={m.featureId}
                    className="rounded-lg border border-stone-200 p-3 text-sm"
                  >
                    <p className="font-medium text-stone-800">
                      {m.label}{" "}
                      <span className="text-stone-400">({m.featureId})</span>
                    </p>
                    <input
                      className="mt-2 w-full rounded border px-2 py-1"
                      value={m.material}
                      placeholder="Material"
                      onChange={(e) => updateMaterial(i, { material: e.target.value })}
                    />
                    <textarea
                      className="mt-1 w-full rounded border px-2 py-1"
                      rows={2}
                      value={m.description}
                      onChange={(e) => updateMaterial(i, { description: e.target.value })}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="font-medium text-stone-900">Takeoff</h3>
            <p className="text-xs text-stone-500">
              Quantities computed from your polygons; waste 10% hardscape / 5% turf.
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-stone-50 text-stone-600">
                  <tr>
                    <th className="px-2 py-1">Feature</th>
                    <th className="px-2 py-1">Unit</th>
                    <th className="px-2 py-1">Qty</th>
                    <th className="px-2 py-1">Waste %</th>
                    <th className="px-2 py-1">With waste</th>
                    <th className="px-2 py-1">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {content.takeoff.map((t, i) => (
                    <tr key={t.featureId} className="border-t border-stone-100">
                      <td className="px-2 py-1">{t.label}</td>
                      <td className="px-2 py-1">{t.unit}</td>
                      <td className="px-2 py-1">{t.quantity}</td>
                      <td className="px-2 py-1">{t.wasteFactorPct}</td>
                      <td className="px-2 py-1">{t.quantityWithWaste}</td>
                      <td className="px-1 py-1">
                        <input
                          className="w-full min-w-32 rounded border px-1 py-0.5"
                          value={t.notes ?? ""}
                          onChange={(e) => updateTakeoff(i, { notes: e.target.value })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="font-medium text-stone-900">Render prompts</h3>
            <div className="mt-2 space-y-4">
              {content.renderPrompts.map((r, i) => (
                <div key={r.id} className="rounded-lg border border-stone-200 p-3">
                  <input
                    className="mb-2 w-full rounded border px-2 py-1 text-sm font-medium"
                    value={r.title}
                    onChange={(e) => updateRenderPrompt(i, { title: e.target.value })}
                  />
                  <textarea
                    className="w-full rounded border px-2 py-1 text-sm"
                    rows={4}
                    value={r.prompt}
                    onChange={(e) => updateRenderPrompt(i, { prompt: e.target.value })}
                  />
                  <p className="mt-1 text-xs text-stone-400">id: {r.id}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
