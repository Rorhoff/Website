"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalibrationPin } from "@/components/CalibrationPin";
import { computePixelsPerFoot } from "@/lib/calibration";
import { normalizedImagePointFromClick } from "@/lib/calibration-image-point";
import type { Calibration } from "@/lib/project-schema";

type Point = { x: number; y: number };

type Props = {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  calibration?: Calibration;
  northRotationDeg: number;
  onCalibrationChange: (cal: Calibration | undefined) => void;
  /** Called after Apply scale — parent should persist so interpret works without a separate Save. */
  onApply: (cal: Calibration) => void;
  onNorthChange: (deg: number) => void;
  onSave: (payload: { calibration?: Calibration; northRotationDeg: number }) => void;
  saving: boolean;
};

export function CalibrationTool({
  imageUrl,
  imageWidth,
  imageHeight,
  calibration,
  northRotationDeg,
  onCalibrationChange,
  onApply,
  onNorthChange,
  onSave,
  saving,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [pointA, setPointA] = useState<Point | null>(
    calibration?.pointA ?? null
  );
  const [pointB, setPointB] = useState<Point | null>(
    calibration?.pointB ?? null
  );
  const [distanceFeet, setDistanceFeet] = useState(
    calibration?.distanceFeet?.toString() ?? ""
  );
  const [clickTarget, setClickTarget] = useState<"A" | "B">("A");
  const [draggingNorth, setDraggingNorth] = useState(false);

  useEffect(() => {
    if (!draggingNorth) return;

    const updateNorthFromPointer = (clientX: number, clientY: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const deg =
        (Math.atan2(clientY - cy, clientX - cx) * 180) / Math.PI + 90;
      onNorthChange(Math.round(deg));
    };

    const onMove = (e: MouseEvent) => updateNorthFromPointer(e.clientX, e.clientY);
    const onUp = () => setDraggingNorth(false);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draggingNorth, onNorthChange]);

  const handleImageClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const p = normalizedImagePointFromClick(e, imageRef.current);
      if (!p) return;
      if (clickTarget === "A") {
        setPointA(p);
        setClickTarget("B");
      } else {
        setPointB(p);
      }
    },
    [clickTarget]
  );

  function buildCalibration(): Calibration | undefined {
    if (!pointA || !pointB) return calibration;
    const feet = parseFloat(distanceFeet);
    if (!feet || feet <= 0) return calibration;
    try {
      return {
        pointA,
        pointB,
        distanceFeet: feet,
        pixelsPerFoot: computePixelsPerFoot(
          pointA,
          pointB,
          imageWidth,
          imageHeight,
          feet
        ),
      };
    } catch {
      return calibration;
    }
  }

  function applyCalibration() {
    if (!pointA || !pointB) return;
    const feet = parseFloat(distanceFeet);
    if (!feet || feet <= 0) return;
    const pixelsPerFoot = computePixelsPerFoot(
      pointA,
      pointB,
      imageWidth,
      imageHeight,
      feet
    );
    const cal: Calibration = {
      pointA,
      pointB,
      distanceFeet: feet,
      pixelsPerFoot,
    };
    onCalibrationChange(cal);
    onApply(cal);
  }

  function clearCalibration() {
    setPointA(null);
    setPointB(null);
    setDistanceFeet("");
    setClickTarget("A");
    onCalibrationChange(undefined);
  }

  const pxf =
    calibration?.pixelsPerFoot ??
    (pointA && pointB && distanceFeet
      ? buildCalibration()?.pixelsPerFoot
      : undefined);

  return (
    <div className="space-y-4 rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">Scale calibration</h2>
          <p className="text-sm text-stone-600">
            Click two points with a known distance (driveway width, GCP, etc.).
            Image: {imageWidth}×{imageHeight}px
          </p>
        </div>
        {pxf ? (
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-900">
            {pxf.toFixed(2)} px/ft
          </span>
        ) : (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-900">
            Not calibrated
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <button
          type="button"
          className={`rounded-md px-3 py-1 ${clickTarget === "A" ? "bg-emerald-700 text-white" : "bg-stone-100"}`}
          onClick={() => setClickTarget("A")}
        >
          Set point A {pointA ? "✓" : ""}
        </button>
        <button
          type="button"
          className={`rounded-md px-3 py-1 ${clickTarget === "B" ? "bg-emerald-700 text-white" : "bg-stone-100"}`}
          onClick={() => setClickTarget("B")}
        >
          Set point B {pointB ? "✓" : ""}
        </button>
      </div>

      <div
        ref={containerRef}
        className="relative mx-auto max-w-full cursor-crosshair overflow-hidden rounded-lg border border-stone-300 bg-stone-100"
        style={{ aspectRatio: `${imageWidth} / ${imageHeight}` }}
        onClick={handleImageClick}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          src={imageUrl}
          alt="Calibration base"
          className="block h-full w-full object-contain"
          draggable={false}
        />
        {pointA ? <CalibrationPin label="A" point={pointA} color="#059669" /> : null}
        {pointB ? <CalibrationPin label="B" point={pointB} color="#2563eb" /> : null}
        {pointA && pointB ? (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 1 1"
            preserveAspectRatio="none"
          >
            <line
              x1={pointA.x}
              y1={pointA.y}
              x2={pointB.x}
              y2={pointB.y}
              stroke="#f59e0b"
              strokeWidth={0.004}
              strokeDasharray="0.01 0.008"
            />
          </svg>
        ) : null}
        <NorthArrow
          rotationDeg={northRotationDeg}
          dragging={draggingNorth}
          onMouseDown={() => setDraggingNorth(true)}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="text-stone-600">Real-world distance (feet)</span>
          <input
            type="number"
            min="0.1"
            step="0.1"
            className="mt-1 block w-40 rounded-md border border-stone-300 px-3 py-2"
            value={distanceFeet}
            onChange={(e) => setDistanceFeet(e.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={applyCalibration}
          disabled={!pointA || !pointB || !distanceFeet || saving}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Apply scale"}
        </button>
        <button
          type="button"
          onClick={clearCalibration}
          className="rounded-lg border border-stone-300 px-4 py-2 text-sm"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() =>
            onSave({
              calibration: buildCalibration(),
              northRotationDeg,
            })
          }
          disabled={saving}
          className="rounded-lg bg-stone-800 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save project"}
        </button>
      </div>
      <p className="text-xs text-stone-500">
        North arrow: drag the handle on the image to set north ({northRotationDeg}°).
      </p>
    </div>
  );
}

function NorthArrow({
  rotationDeg,
  dragging,
  onMouseDown,
}: {
  rotationDeg: number;
  dragging: boolean;
  onMouseDown: () => void;
}) {
  return (
    <div
      className="absolute right-4 top-4 select-none"
      style={{ transform: `rotate(${rotationDeg}deg)` }}
    >
      <div className="flex flex-col items-center">
        <div className="text-xs font-bold text-stone-800">N</div>
        <div className="h-8 w-0.5 bg-stone-800" />
        <button
          type="button"
          className={`mt-1 h-4 w-4 cursor-grab rounded-full border-2 border-stone-800 bg-white active:cursor-grabbing ${dragging ? "ring-2 ring-emerald-500" : ""}`}
          title="Drag to rotate north"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onMouseDown();
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}
