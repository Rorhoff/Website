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
};

export function InterpretPanel({
  projectId,
  interpretation,
  onInterpretation,
  calibrated,
  needsAnnotated,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rawDump, setRawDump] = useState(false);

  const review = useMemo(
    () => (interpretation ? reviewItems(interpretation) : []),
    [interpretation]
  );
  const pendingReview =
    interpretation != null &&
    needsReview(interpretation) &&
    !interpretation.reviewClearedAt;

  async function runInterpret(force = false) {
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
        throw new Error(data.error ?? "Interpret failed");
      }
      onInterpretation(data.interpretation);
      if (data.rawResponse) {
        setError(`Validation failed — raw response included below`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Interpret failed");
    } finally {
      setBusy(false);
    }
  }

  async function clearReview() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(withBasePath("/api/interpret"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, reviewCleared: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not clear review");
      onInterpretation(data.interpretation);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clear review failed");
    } finally {
      setBusy(false);
    }
  }

  const canRun = calibrated && !needsAnnotated;

  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">Interpret annotations</h2>
          <p className="text-sm text-stone-600">
            Claude vision reads your annotated orthophoto and returns structured features.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !canRun}
            onClick={() => runInterpret(!!interpretation)}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            title={
              needsAnnotated
                ? "Export annotation base and upload your annotated sketch first"
                : calibrated
                  ? undefined
                  : "Save scale calibration first"
            }
          >
            {busy ? "Running…" : interpretation ? "Re-run interpret" : "Run interpret"}
          </button>
          {interpretation ? (
            <button
              type="button"
              onClick={() => setRawDump((v) => !v)}
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-700"
            >
              {rawDump ? "Hide JSON" : "Show JSON"}
            </button>
          ) : null}
        </div>
      </div>

      {needsAnnotated ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Export annotation base, draw on your phone, and upload the annotated sketch before
          running interpret.
        </p>
      ) : null}

      {!calibrated && !needsAnnotated ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Calibrate scale before interpreting — metadata and scale help Claude contextualize the
          site.
        </p>
      ) : null}

      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}

      {interpretation ? (
        <div className="grid gap-3 text-sm text-stone-700 sm:grid-cols-3">
          <p>
            <span className="font-medium text-stone-900">{interpretation.features.length}</span>{" "}
            features
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

      {pendingReview ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="font-medium text-amber-950">Review queue — clear before continuing</p>
          <ul className="mt-2 list-inside list-disc text-sm text-amber-900">
            {review.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy}
            onClick={clearReview}
            className="mt-3 rounded-md bg-amber-800 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            Mark review cleared
          </button>
        </div>
      ) : interpretation && interpretation.reviewClearedAt ? (
        <p className="text-sm text-emerald-700">Review cleared — ready for polygon editor (M3).</p>
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
    </section>
  );
}
