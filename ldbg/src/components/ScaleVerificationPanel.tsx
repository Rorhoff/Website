"use client";

import { useCallback, useState } from "react";
import {
  evaluateScaleVerification,
  formatScaleVerificationSummary,
  SCALE_VERIFY_TOLERANCE,
} from "@/lib/scale-verification";
import type { ScaleVerification } from "@/lib/project-schema";

type Point = { x: number; y: number };

type Props = {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  pixelsPerFoot: number;
  scaleVerification?: ScaleVerification;
  georeferencingMode?: "gcp" | "gps";
  onChange: (verification: ScaleVerification | undefined) => void;
  onSave: () => void;
  saving: boolean;
};

export function ScaleVerificationPanel({
  imageUrl,
  imageWidth,
  imageHeight,
  pixelsPerFoot,
  scaleVerification,
  georeferencingMode,
  onChange,
  onSave,
  saving,
}: Props) {
  const [pointA, setPointA] = useState<Point | null>(
    scaleVerification?.pointA ?? null
  );
  const [pointB, setPointB] = useState<Point | null>(
    scaleVerification?.pointB ?? null
  );
  const [description, setDescription] = useState(
    scaleVerification?.description ?? ""
  );
  const [expectedFeet, setExpectedFeet] = useState(
    scaleVerification?.expectedFeet?.toString() ?? ""
  );
  const [clickTarget, setClickTarget] = useState<"A" | "B">("A");

  const handleImageClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const p = {
        x: Math.min(1, Math.max(0, x)),
        y: Math.min(1, Math.max(0, y)),
      };
      if (clickTarget === "A") {
        setPointA(p);
        setClickTarget("B");
      } else {
        setPointB(p);
        setClickTarget("A");
      }
    },
    [clickTarget]
  );

  function computeDraft(): ScaleVerification | null {
    if (!pointA || !pointB || !description.trim()) return null;
    const feet = parseFloat(expectedFeet);
    if (!feet || feet <= 0) return null;
    try {
      return evaluateScaleVerification({
        description,
        pointA,
        pointB,
        expectedFeet: feet,
        imageWidth,
        imageHeight,
        pixelsPerFoot,
      });
    } catch {
      return null;
    }
  }

  const draft = computeDraft();

  function applyVerification() {
    const v = computeDraft();
    if (v) onChange(v);
  }

  function clearCheck() {
    setPointA(null);
    setPointB(null);
    setDescription("");
    setExpectedFeet("");
    setClickTarget("A");
    onChange(undefined);
  }

  const active = scaleVerification ?? draft;

  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div>
        <h2 className="text-lg font-semibold text-stone-900">
          Independent scale verification
        </h2>
        <p className="text-sm text-stone-600">
          Click two points on a feature of known size (garage door, driveway width,
          surveyed line). Enter the true dimension. Export requires within{" "}
          {SCALE_VERIFY_TOLERANCE * 100}% — even for GCP projects.
        </p>
      </div>

      {georeferencingMode === "gps" ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <strong>GPS-only georeferencing</strong> — scale is unverified until this
          check passes.
        </div>
      ) : null}

      {georeferencingMode === "gcp" ? (
        <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
          GCP georeferenced — still required: one field measurement before export.
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 text-sm">
        <button
          type="button"
          className={`rounded px-3 py-1 ${clickTarget === "A" ? "bg-emerald-700 text-white" : "bg-stone-100"}`}
          onClick={() => setClickTarget("A")}
        >
          Set point A
        </button>
        <button
          type="button"
          className={`rounded px-3 py-1 ${clickTarget === "B" ? "bg-emerald-700 text-white" : "bg-stone-100"}`}
          onClick={() => setClickTarget("B")}
        >
          Set point B
        </button>
        <button
          type="button"
          className="rounded px-3 py-1 text-stone-600 hover:bg-stone-100"
          onClick={clearCheck}
        >
          Clear
        </button>
      </div>

      <div
        className="relative cursor-crosshair overflow-hidden rounded-lg border border-stone-300 bg-stone-900"
        onClick={handleImageClick}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Scale verification"
          className="block w-full select-none"
          draggable={false}
        />
        {pointA ? (
          <span
            className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-emerald-500"
            style={{ left: `${pointA.x * 100}%`, top: `${pointA.y * 100}%` }}
          />
        ) : null}
        {pointB ? (
          <span
            className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-sky-500"
            style={{ left: `${pointB.x * 100}%`, top: `${pointB.y * 100}%` }}
          />
        ) : null}
        {pointA && pointB ? (
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            <line
              x1={`${pointA.x * 100}%`}
              y1={`${pointA.y * 100}%`}
              x2={`${pointB.x * 100}%`}
              y2={`${pointB.y * 100}%`}
              stroke="#fff"
              strokeWidth={2}
              strokeDasharray="6 4"
            />
          </svg>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm sm:col-span-2">
          <span className="text-stone-600">What you measured</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Double garage door width"
            className="mt-1 w-full rounded border border-stone-300 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-stone-600">True dimension (feet)</span>
          <input
            type="number"
            min={0}
            step={0.1}
            value={expectedFeet}
            onChange={(e) => setExpectedFeet(e.target.value)}
            className="mt-1 w-full rounded border border-stone-300 px-3 py-2"
          />
        </label>
        <div className="text-sm">
          <span className="text-stone-600">Result</span>
          {active ? (
            <div
              className={`mt-1 rounded-lg px-3 py-2 ${
                active.passed
                  ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200"
                  : "bg-red-50 text-red-900 ring-1 ring-red-200"
              }`}
            >
              <p className="font-medium">{active.passed ? "Pass" : "Fail"}</p>
              <p className="mt-1 text-xs">
                Measured {active.measuredFeet.toFixed(2)} ft · expected{" "}
                {active.expectedFeet.toFixed(2)} ft · ratio {active.ratio.toFixed(4)}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-stone-500">Set two points and enter dimension.</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!draft}
          onClick={applyVerification}
          className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Apply check
        </button>
        <button
          type="button"
          disabled={saving || !scaleVerification}
          onClick={onSave}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save verification"}
        </button>
      </div>

      {scaleVerification?.passed ? (
        <p className="text-xs text-emerald-800">
          Saved: {formatScaleVerificationSummary(scaleVerification)}
        </p>
      ) : scaleVerification && !scaleVerification.passed ? (
        <p className="text-xs text-red-800">
          Saved check did not pass — board export is blocked until within{" "}
          {SCALE_VERIFY_TOLERANCE * 100}%.
        </p>
      ) : null}
    </section>
  );
}
