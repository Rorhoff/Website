"use client";

import { useMemo, useState } from "react";
import { formatUsd } from "@/lib/interpret-cost";
import {
  needsReview,
  reviewItems,
  type StoredInterpretation,
} from "@/lib/interpret-schema";
import { withBasePath } from "@/lib/paths";

type Props = {
  projectId: string;
  interpretation?: StoredInterpretation;
  onInterpretation: (next: StoredInterpretation) => void;
  calibrated: boolean;
  needsAnnotated?: boolean;
  hasHandDrawnFeatures?: boolean;
};

export function InterpretPanel({
  projectId,
  interpretation,
  onInterpretation,
  calibrated,
  needsAnnotated,
  hasHandDrawnFeatures,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rawDump, setRawDump] = useState(false);
  const [open, setOpen] = useState(!!interpretation);

  const review = useMemo(
    () => (interpretation ? reviewItems(interpretation) : []),
    [interpretation]
  );

  async function runInterpret(force = false) {
    if (
      hasHandDrawnFeatures &&
      !window.confirm(
        "Import from annotated photo will replace your current hand-drawn features with Claude's interpretation. Continue?"
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(withBasePath("/api/interpret"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, force }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Import failed");
      }
      onInterpretation(data.interpretation);
      setOpen(true);
      if (data.rawResponse) {
        setError("Validation failed — raw response included below");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const canRun = !needsAnnotated;

  return (
    <section className="rounded-xl border border-stone-200 bg-stone-50">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h2 className="text-base font-semibold text-stone-800">
            Import from annotated photo
            <span className="ml-2 text-xs font-normal text-stone-500">(optional)</span>
          </h2>
          <p className="text-sm text-stone-600">
            Claude vision can seed features from a hand-annotated orthophoto — correct them in the
            feature editor above.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !canRun}
            onClick={() => runInterpret(!!interpretation)}
            className="min-h-11 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 disabled:opacity-50"
            title={
              needsAnnotated
                ? "Export annotation base and upload your annotated sketch first"
                : undefined
            }
          >
            {busy ? "Importing…" : interpretation ? "Re-import" : "Import from photo"}
          </button>
          {interpretation ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="min-h-11 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700"
            >
              {open ? "Hide details" : "Show details"}
            </button>
          ) : null}
        </div>
      </div>

      {open ? (
        <div className="space-y-4 border-t border-stone-200 bg-white p-4">
          {needsAnnotated ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Export annotation base, draw on your phone, and upload the annotated sketch before
              importing.
            </p>
          ) : null}

          {!calibrated && !needsAnnotated ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Scale is not set — import still works, but measurements and exports need calibration or
              WebODM georeferencing.
            </p>
          ) : null}

          {error ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
          ) : null}

          {interpretation ? (
            <div className="grid gap-3 text-sm text-stone-700 sm:grid-cols-3">
              <p>
                <span className="font-medium text-stone-900">
                  {interpretation.features.length}
                </span>{" "}
                features imported
              </p>
              <p>
                Tokens: {interpretation.tokenUsage?.input ?? "—"} in /{" "}
                {interpretation.tokenUsage?.output ?? "—"} out
              </p>
              <p>
                Est. cost:{" "}
                {interpretation.estimatedCostUsd != null
                  ? formatUsd(interpretation.estimatedCostUsd)
                  : "—"}
              </p>
            </div>
          ) : null}

          {interpretation && needsReview(interpretation) && review.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="font-medium text-amber-950">Import notes (informational)</p>
              <ul className="mt-2 list-inside list-disc text-sm text-amber-900">
                {review.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-amber-800">
                These do not block editing — refine shapes in the feature editor.
              </p>
            </div>
          ) : null}

          {interpretation?.siteObservations?.length ? (
            <div>
              <p className="text-sm font-medium text-stone-800">Site observations</p>
              <ul className="mt-1 list-inside list-disc text-sm text-stone-600">
                {interpretation.siteObservations.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {rawDump && interpretation ? (
            <pre className="max-h-96 overflow-auto rounded-lg bg-stone-900 p-4 text-xs text-stone-100">
              {JSON.stringify(interpretation, null, 2)}
            </pre>
          ) : null}

          {interpretation ? (
            <button
              type="button"
              onClick={() => setRawDump((v) => !v)}
              className="text-sm text-stone-600 underline"
            >
              {rawDump ? "Hide JSON" : "Show JSON"}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
