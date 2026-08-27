"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { CalibrationPin } from "@/components/CalibrationPin";
import { computePixelsPerFoot } from "@/lib/calibration";
import { normalizedImagePointFromClick } from "@/lib/calibration-image-point";
import { useImageViewport } from "@/hooks/useImageViewport";
import type { Calibration } from "@/lib/project-schema";

type Point = { x: number; y: number };

type Props = {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  calibration?: Calibration;
  northRotationDeg: number;
  onCalibrationChange: (cal: Calibration | undefined) => void;
  /** Fired when A/B/distance produce a computable scale (same logic as the px/ft badge). */
  onScaleDraft?: (cal: Calibration | undefined) => void;
  /** Called after Apply scale — parent should persist so scale survives reload. */
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
  onScaleDraft,
  onApply,
  onNorthChange,
  onSave,
  saving,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const suppressImageClickRef = useRef(false);
  const viewport = useImageViewport(containerRef);
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
    const onUp = () => {
      suppressImageClickRef.current = true;
      setDraggingNorth(false);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draggingNorth, onNorthChange]);

  const handleImageClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (suppressImageClickRef.current) {
        suppressImageClickRef.current = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
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
    if (!pointA || !pointB) return undefined;
    const feet = parseFloat(distanceFeet);
    if (!feet || feet <= 0) return undefined;
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
      return undefined;
    }
  }

  useEffect(() => {
    if (!pointA || !pointB) {
      onScaleDraft?.(undefined);
      return;
    }
    const feet = parseFloat(distanceFeet);
    if (!feet || feet <= 0) {
      onScaleDraft?.(undefined);
      return;
    }
    try {
      onScaleDraft?.({
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
      });
    } catch {
      onScaleDraft?.(undefined);
    }
  }, [pointA, pointB, distanceFeet, imageWidth, imageHeight, onScaleDraft]);

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
    onScaleDraft?.(undefined);
  }

  const pxf = buildCalibration()?.pixelsPerFoot ?? calibration?.pixelsPerFoot;

  return (
    <div className="space-y-4 rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">Scale calibration</h2>
          <p className="text-sm text-stone-600">
            Click two points with a known distance (driveway width, GCP, etc.). Use +/− or scroll
            wheel to zoom; drag with middle mouse (or Shift+drag) to pan. Image: {imageWidth}×
            {imageHeight}px
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pxf ? (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-900">
              {pxf.toFixed(2)} px/ft
            </span>
          ) : (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-900">
              Not calibrated
            </span>
          )}
          <span className="rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-700">
            {Math.round(viewport.zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={viewport.zoomOut}
            disabled={viewport.zoom <= 1}
            className="min-h-8 min-w-8 rounded-md bg-stone-100 px-2 text-sm disabled:opacity-40"
            title="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={viewport.zoomIn}
            disabled={viewport.zoom >= 8}
            className="min-h-8 min-w-8 rounded-md bg-stone-100 px-2 text-sm disabled:opacity-40"
            title="Zoom in"
          >
            +
          </button>
          {viewport.zoom > 1 ? (
            <button
              type="button"
              onClick={viewport.resetViewport}
              className="rounded-md bg-stone-100 px-3 py-1 text-sm text-stone-800"
            >
              Reset zoom
            </button>
          ) : null}
        </div>
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
        className={`relative mx-auto max-w-full overflow-hidden rounded-lg border border-stone-300 bg-stone-100 ${viewport.isPanning ? "cursor-grabbing" : ""}`}
        style={{ aspectRatio: `${imageWidth} / ${imageHeight}` }}
        onMouseDown={viewport.onMouseDown}
      >
        <div className="absolute inset-0" style={viewport.transformStyle}>
          <div
            className="absolute inset-0 cursor-crosshair"
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
          </div>
          <NorthArrow
            rotationDeg={northRotationDeg}
            dragging={draggingNorth}
            onPointerDown={(e) => {
              suppressImageClickRef.current = true;
              e.preventDefault();
              setDraggingNorth(true);
            }}
          />
          {pointA && pointB && distanceFeet ? (
            <CalibrationScaleBadge
              pointA={pointA}
              pointB={pointB}
              distanceFeet={parseFloat(distanceFeet) || 0}
              imageRef={imageRef}
              zoom={viewport.zoom}
            />
          ) : null}
        </div>
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

function CalibrationScaleBadge({
  pointA,
  pointB,
  distanceFeet,
  imageRef,
  zoom,
}: {
  pointA: Point;
  pointB: Point;
  distanceFeet: number;
  imageRef: RefObject<HTMLImageElement | null>;
  zoom: number;
}) {
  const [barPx, setBarPx] = useState(0);

  useEffect(() => {
    const img = imageRef.current;
    if (!img || distanceFeet <= 0) return;
    const update = () => {
      const w = img.clientWidth;
      const h = img.clientHeight;
      if (w <= 0 || h <= 0) return;
      const dx = (pointB.x - pointA.x) * w;
      const dy = (pointB.y - pointA.y) * h;
      setBarPx(Math.max(12, Math.min(w * 0.35, Math.hypot(dx, dy))));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(img);
    return () => ro.disconnect();
  }, [pointA, pointB, distanceFeet, imageRef, zoom]);

  if (barPx <= 0) return null;

  return (
    <div
      className="pointer-events-none absolute right-3 top-[4.75rem] z-10 select-none text-stone-800"
      aria-hidden
    >
      <div className="flex flex-col items-center">
        <div
          className="h-1 rounded-sm border border-stone-700 bg-white"
          style={{ width: barPx }}
        >
          <div className="h-full w-1/2 bg-stone-800" />
        </div>
        <span className="mt-0.5 text-[10px] font-semibold leading-none">
          {distanceFeet} ft
        </span>
      </div>
    </div>
  );
}

function NorthArrow({
  rotationDeg,
  dragging,
  onPointerDown,
}: {
  rotationDeg: number;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div
      className="pointer-events-none absolute right-4 top-4 z-10 select-none"
      style={{ transform: `rotate(${rotationDeg}deg)` }}
    >
      <div className="flex flex-col items-center">
        <div className="text-xs font-bold text-stone-800">N</div>
        <div className="h-8 w-0.5 bg-stone-800" />
        <button
          type="button"
          className={`pointer-events-auto mt-1 h-4 w-4 cursor-grab touch-none rounded-full border-2 border-stone-800 bg-white active:cursor-grabbing ${dragging ? "ring-2 ring-emerald-500" : ""}`}
          title="Drag to rotate north"
          onPointerDown={onPointerDown}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}
