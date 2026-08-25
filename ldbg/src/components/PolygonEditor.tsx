"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Image as KonvaImage, Layer, Line, Stage, Transformer } from "react-konva";
import type Konva from "konva";
import type { LegendEntry } from "@/config/legend";
import type { GeorefDisplayContext } from "@/lib/georef-display";
import {
  circleNormPoints,
  createDrawnFeature,
  normalizedRadius,
  rectangleNormPoints,
  type DrawShapeKind,
} from "@/lib/draw-feature";
import {
  centroidNormFromFeature,
  deleteVertexAtGeoref,
  geometryRadiusPx,
  geometryToPxPoints,
  geometryVertexCount,
  insertVertexAtGeoref,
  moveFeatureGeoref,
  transformFeatureGeoref,
  updateFeatureVertexGeoref,
} from "@/lib/feature-georef";
import {
  cloneFeatures,
  collectSnapSegments,
  deleteVertexAt,
  featureAreaSqFt,
  featurePerimeterLf,
  flatFeaturePoints,
  flatNormPoints,
  insertVertexAt,
  moveFeature,
  normToPx,
  pxToNorm,
  snapPxPoint,
  transformFeaturePoints,
  updateVertex,
} from "@/lib/feature-geometry";
import { labelForFeatureType, styleForFeatureType } from "@/lib/feature-styles";
import { useBoundedHistory } from "@/hooks/useBoundedHistory";
import { useStageViewport } from "@/hooks/useStageViewport";
import type { InterpretFeature } from "@/lib/interpret-schema";
import type { TilePyramid } from "@/lib/tile-pyramid-schema";

type EditorTool = "select" | DrawShapeKind;
type BaseLayer = "annotated" | "clean";

/** 44px touch target diameter for vertex handles. */
const VERTEX_HIT_RADIUS = 22;

export type EditorSettings = {
  hiddenFeatureTypes: string[];
};

type Props = {
  annotatedImageUrl: string;
  cleanImageUrl?: string;
  imageWidth: number;
  imageHeight: number;
  features: InterpretFeature[];
  legend: LegendEntry[];
  pixelsPerFoot?: number;
  georefContext?: GeorefDisplayContext;
  editorSettings?: EditorSettings;
  projectId?: string;
  tilePyramid?: TilePyramid;
  fullOrthoWidth?: number;
  fullOrthoHeight?: number;
  onAutosave: (payload: {
    features: InterpretFeature[];
    editorSettings: EditorSettings;
  }) => void;
};

function useHtmlImage(src: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) {
      setImage(null);
      return;
    }
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setImage(img);
    img.src = src;
  }, [src]);
  return image;
}

function featureTypes(features: InterpretFeature[], legend: LegendEntry[]): string[] {
  const set = new Set<string>();
  for (const e of legend) set.add(e.featureType);
  for (const f of features) set.add(f.featureType);
  return [...set].sort();
}

function isDragShapeTool(tool: EditorTool): boolean {
  return tool === "rectangle" || tool === "circle";
}

function isClickShapeTool(tool: EditorTool): boolean {
  return tool === "polygon" || tool === "polyline" || tool === "point";
}

export default function PolygonEditor({
  annotatedImageUrl,
  cleanImageUrl,
  imageWidth,
  imageHeight,
  features: initialFeatures,
  legend,
  pixelsPerFoot,
  georefContext,
  editorSettings,
  onAutosave,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const selectedGroupRef = useRef<Konva.Group>(null);
  const skipSaveRef = useRef(true);
  const onAutosaveRef = useRef(onAutosave);
  onAutosaveRef.current = onAutosave;
  const dragShapeRef = useRef(false);

  const [containerW, setContainerW] = useState(800);
  const [tool, setTool] = useState<EditorTool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawPoints, setDrawPoints] = useState<{ x: number; y: number }[]>([]);
  const [drawFeatureType, setDrawFeatureType] = useState(legend[0]?.featureType ?? "lawn");
  const [shapeDrag, setShapeDrag] = useState<{
    start: { x: number; y: number };
    current: { x: number; y: number };
  } | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(
    () => new Set(editorSettings?.hiddenFeatureTypes ?? [])
  );
  const [saveLabel, setSaveLabel] = useState("");
  const [baseLayer, setBaseLayer] = useState<BaseLayer>("annotated");

  const viewport = useStageViewport();

  const activeImageUrl =
    baseLayer === "clean" && cleanImageUrl ? cleanImageUrl : annotatedImageUrl;
  const image = useHtmlImage(activeImageUrl);

  const history = useBoundedHistory<InterpretFeature[]>(cloneFeatures(initialFeatures));
  const [features, setFeatures] = useState<InterpretFeature[]>(() =>
    cloneFeatures(initialFeatures)
  );
  const { push, undo, redo, canUndo, canRedo, replace, index, current } = history;

  useEffect(() => {
    setFeatures(cloneFeatures(current));
  }, [index, current]);

  useEffect(() => {
    const snap = cloneFeatures(initialFeatures);
    replace(snap);
    setFeatures(snap);
    skipSaveRef.current = true;
  }, [initialFeatures, replace]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerW(el.clientWidth || 800));
    ro.observe(el);
    setContainerW(el.clientWidth || 800);
    return () => ro.disconnect();
  }, []);

  const maxH = typeof window !== "undefined" ? window.innerHeight * 0.62 : 520;
  const fitScale = Math.min(containerW / imageWidth, maxH / imageHeight, 1);
  const displayW = Math.round(imageWidth * fitScale);
  const displayH = Math.round(imageHeight * fitScale);

  const snapSegments = useMemo(
    () => collectSnapSegments(features, displayW, displayH, georefContext),
    [features, displayW, displayH, georefContext]
  );

  const selected = features.find((f) => f.id === selectedId) ?? null;
  const drawEntry = legend.find((e) => e.featureType === drawFeatureType);
  const drawStyle = styleForFeatureType(drawFeatureType, legend, false);
  const drawAsPoint =
    tool === "point" || (tool === "circle" && drawEntry?.unit === "each");

  const commitFeatures = useCallback(
    (next: InterpretFeature[]) => {
      push(cloneFeatures(next));
    },
    [push]
  );

  const patchFeatures = useCallback((next: InterpretFeature[]) => {
    setFeatures(cloneFeatures(next));
  }, []);

  const updateFeature = useCallback(
    (id: string, updater: (f: InterpretFeature) => InterpretFeature) => {
      commitFeatures(features.map((f) => (f.id === id ? updater(f) : f)));
    },
    [commitFeatures, features]
  );

  useEffect(() => {
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    setSaveLabel("Saving…");
    const t = setTimeout(() => {
      onAutosaveRef.current({
        features,
        editorSettings: { hiddenFeatureTypes: [...hiddenTypes] },
      });
      setSaveLabel("Saved");
      const clear = setTimeout(() => setSaveLabel(""), 1500);
      return () => clearTimeout(clear);
    }, 500);
    return () => clearTimeout(t);
  }, [features, hiddenTypes, index]);

  useEffect(() => {
    const tr = transformerRef.current;
    const node = selectedGroupRef.current;
    if (!tr) return;
    if (selectedId && node && tool === "select") {
      tr.nodes([node]);
      tr.getLayer()?.batchDraw();
    } else {
      tr.nodes([]);
    }
  }, [selectedId, tool, features, displayW, displayH]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId && tool === "select") {
          e.preventDefault();
          commitFeatures(features.filter((f) => f.id !== selectedId));
          setSelectedId(null);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, selectedId, features, commitFeatures, tool]);

  function contentNormFromStage(stage: Konva.Stage) {
    const content = viewport.pointerToContent(stage);
    if (!content) return null;
    return pxToNorm(content, displayW, displayH);
  }

  function applySnapNorm(p: { x: number; y: number }) {
    if (!snapEnabled || snapSegments.length === 0) return p;
    const px = normToPx(p, displayW, displayH);
    const snapped = snapPxPoint(px, snapSegments, 12);
    return pxToNorm(snapped, displayW, displayH);
  }

  function addFeatureFromDraw(
    geometryKind: "polygon" | "polyline" | "point",
    points: { x: number; y: number }[],
    radius?: number
  ) {
    if (geometryKind === "point" && points.length < 1) return;
    if (geometryKind === "polyline" && points.length < 2) return;
    if (geometryKind === "polygon" && points.length < 3) return;

    const f = createDrawnFeature({
      featureType: drawFeatureType,
      legend,
      geometryKind,
      points,
      radius,
      features,
      georefContext,
      displayW,
      displayH,
    });
    commitFeatures([...features, f]);
    setSelectedId(f.id);
    setDrawPoints([]);
    setShapeDrag(null);
    setTool("select");
  }

  function finishPolygonOrPolyline() {
    const kind = tool === "polyline" ? "polyline" : "polygon";
    addFeatureFromDraw(kind, drawPoints);
  }

  function handlePointerDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (tool === "select") return;
    if (isDragShapeTool(tool)) {
      const stage = e.target.getStage();
      if (!stage || e.target !== stage) return;
      const norm = contentNormFromStage(stage);
      if (!norm) return;
      dragShapeRef.current = true;
      setShapeDrag({ start: norm, current: norm });
    }
  }

  function handlePointerMove(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (!shapeDrag || !isDragShapeTool(tool)) return;
    const stage = e.target.getStage();
    if (!stage) return;
    const norm = contentNormFromStage(stage);
    if (!norm) return;
    setShapeDrag((prev) => (prev ? { ...prev, current: applySnapNorm(norm) } : null));
  }

  function handlePointerUp(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (!shapeDrag || !isDragShapeTool(tool) || !dragShapeRef.current) return;
    dragShapeRef.current = false;
    const { start, current } = shapeDrag;
    setShapeDrag(null);

    if (tool === "rectangle") {
      const pts = rectangleNormPoints(start, current);
      if (Math.abs(pts[1].x - pts[0].x) > 0.002 && Math.abs(pts[2].y - pts[1].y) > 0.002) {
        addFeatureFromDraw("polygon", pts);
      }
      return;
    }

    if (tool === "circle") {
      if (drawAsPoint) {
        const r = normalizedRadius(start, current);
        if (r > 0.002) addFeatureFromDraw("point", [start], r);
      } else {
        const pts = circleNormPoints(start, current);
        if (pts.length >= 3) addFeatureFromDraw("polygon", pts);
      }
    }
  }

  function handleStageClick(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (shapeDrag) return;
    if (tool === "select") {
      if (e.target === e.target.getStage()) setSelectedId(null);
      return;
    }
    if (!isClickShapeTool(tool)) return;

    const stage = e.target.getStage();
    if (!stage || e.target !== stage) return;
    const norm = contentNormFromStage(stage);
    if (!norm) return;
    const pt = applySnapNorm(norm);

    if (tool === "point" || (tool === "circle" && drawEntry?.unit === "each")) {
      const defaultRadius = 0.025;
      addFeatureFromDraw("point", [pt], defaultRadius);
      return;
    }

    setDrawPoints((prev) => [...prev, pt]);
  }

  function onTransformEnd() {
    const group = selectedGroupRef.current;
    if (!group || !selected) return;
    const center = centroidNormFromFeature(selected, displayW, displayH, georefContext);
    const scaleX = group.scaleX();
    const scaleY = group.scaleY();
    const rotation = group.rotation();
    group.scaleX(1);
    group.scaleY(1);
    group.rotation(0);
    group.x(0);
    group.y(0);
    updateFeature(selected.id, (f) =>
      georefContext
        ? transformFeatureGeoref(
            f,
            displayW,
            displayH,
            center,
            scaleX,
            scaleY,
            rotation,
            georefContext
          )
        : transformFeaturePoints(f, displayW, displayH, center, scaleX, scaleY, rotation)
    );
  }

  function onGroupDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
    const node = e.target;
    if (!selected) return;
    if (georefContext) {
      const dxPx = node.x() / viewport.zoom;
      const dyPx = node.y() / viewport.zoom;
      node.x(0);
      node.y(0);
      updateFeature(selected.id, (f) => moveFeatureGeoref(f, dxPx, dyPx, georefContext));
      return;
    }
    const dx = node.x() / viewport.zoom / displayW;
    const dy = node.y() / viewport.zoom / displayH;
    node.x(0);
    node.y(0);
    updateFeature(selected.id, (f) => moveFeature(f, dx, dy));
  }

  const canMeasure = georefContext != null || pixelsPerFoot != null;
  const area =
    selected && canMeasure
      ? featureAreaSqFt(selected, displayW, displayH, pixelsPerFoot, georefContext)
      : null;
  const perimeter =
    selected && canMeasure
      ? featurePerimeterLf(selected, displayW, displayH, pixelsPerFoot, georefContext)
      : null;

  const types = featureTypes(features, legend);
  const drawing = tool !== "select";

  const previewPoints = useMemo(() => {
    if (shapeDrag && tool === "rectangle") {
      return rectangleNormPoints(shapeDrag.start, shapeDrag.current);
    }
    if (shapeDrag && tool === "circle" && !drawAsPoint) {
      return circleNormPoints(shapeDrag.start, shapeDrag.current);
    }
    return drawPoints;
  }, [shapeDrag, tool, drawAsPoint, drawPoints]);

  function selectDrawTool(next: DrawShapeKind) {
    setTool(next);
    setDrawPoints([]);
    setShapeDrag(null);
    setSelectedId(null);
    dragShapeRef.current = false;
  }

  function toolBtn(active: boolean, label: string, onClick: () => void, disabled = false) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={`min-h-11 min-w-11 rounded-md px-3 py-2 text-sm disabled:opacity-40 ${
          active ? "bg-emerald-700 text-white" : "bg-stone-100"
        }`}
      >
        {label}
      </button>
    );
  }

  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">Feature editor</h2>
          <p className="text-sm text-stone-600">
            Draw features on the orthophoto — pick a legend type, choose a shape tool, tap or drag
            on the canvas. Pinch to zoom on touch devices.
          </p>
        </div>
        <span className="text-xs text-stone-500">{saveLabel}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {toolBtn(tool === "select", "Select", () => {
          setTool("select");
          setDrawPoints([]);
          setShapeDrag(null);
        })}
        {toolBtn(tool === "polygon", "Polygon", () => selectDrawTool("polygon"))}
        {toolBtn(tool === "rectangle", "Rectangle", () => selectDrawTool("rectangle"))}
        {toolBtn(tool === "circle", "Circle", () => selectDrawTool("circle"))}
        {toolBtn(tool === "polyline", "Polyline", () => selectDrawTool("polyline"))}
        {toolBtn(tool === "point", "Point", () => selectDrawTool("point"))}
        <button
          type="button"
          disabled={!canUndo}
          onClick={undo}
          className="min-h-11 rounded-md bg-stone-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          aria-label="Undo"
        >
          Undo
        </button>
        <button
          type="button"
          disabled={!canRedo}
          onClick={redo}
          className="min-h-11 rounded-md bg-stone-100 px-3 py-2 text-sm disabled:opacity-40"
        >
          Redo
        </button>
        {viewport.zoom !== 1 ? (
          <button
            type="button"
            onClick={viewport.resetViewport}
            className="min-h-11 rounded-md bg-stone-100 px-3 py-2 text-sm"
          >
            Reset zoom
          </button>
        ) : null}
      </div>

      {drawing ? (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <label className="block text-sm text-emerald-950">
            <span className="font-medium">Feature type</span>
            <select
              className="mt-1 min-h-11 w-full min-w-[12rem] rounded border px-2 py-2"
              value={drawFeatureType}
              onChange={(e) => setDrawFeatureType(e.target.value)}
            >
              {legend.map((e) => (
                <option key={e.id} value={e.featureType}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2 text-sm text-emerald-900">
            <span
              className="inline-block h-8 w-8 rounded border border-stone-300"
              style={{ background: drawStyle.fill, boxShadow: `inset 0 0 0 2px ${drawStyle.stroke}` }}
              aria-hidden
            />
            <span>{drawEntry?.label ?? drawFeatureType}</span>
          </div>
          <p className="text-xs text-emerald-800">
            {tool === "polygon" && "Tap each vertex, then Finish shape (min 3)."}
            {tool === "polyline" && "Tap each vertex, then Finish line (min 2)."}
            {tool === "rectangle" && "Press and drag a rectangle."}
            {tool === "circle" &&
              (drawAsPoint ? "Press and drag from center to set canopy radius." : "Press and drag a circle.")}
            {tool === "point" && "Tap once to place a point feature."}
          </p>
          {(tool === "polygon" || tool === "polyline") && (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={
                  tool === "polygon" ? drawPoints.length < 3 : drawPoints.length < 2
                }
                onClick={finishPolygonOrPolyline}
                className="min-h-11 rounded bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                Finish {tool === "polyline" ? "line" : "shape"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDrawPoints([]);
                  setTool("select");
                }}
                className="min-h-11 rounded border px-4 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <label className="flex min-h-11 items-center gap-2 rounded-md bg-stone-100 px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={snapEnabled}
            onChange={(e) => setSnapEnabled(e.target.checked)}
          />
          Snap to edges
        </label>
        <button
          type="button"
          onClick={() => setBaseLayer("annotated")}
          className={`min-h-11 rounded-md px-3 py-2 text-sm ${baseLayer === "annotated" ? "bg-emerald-700 text-white" : "bg-stone-100"}`}
        >
          Annotated base
        </button>
        <button
          type="button"
          disabled={!cleanImageUrl}
          onClick={() => setBaseLayer("clean")}
          className={`min-h-11 rounded-md px-3 py-2 text-sm disabled:opacity-40 ${baseLayer === "clean" ? "bg-emerald-700 text-white" : "bg-stone-100"}`}
        >
          Clean orthophoto
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
        <div ref={containerRef} className="overflow-hidden rounded-lg border border-stone-200 bg-stone-900">
          <Stage
            width={displayW}
            height={displayH}
            onClick={handleStageClick}
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onTouchStart={(e) => {
              if (e.evt.touches.length === 2) {
                viewport.onTouchStart(e);
                return;
              }
              if (e.evt.touches.length === 1) {
                if (tool === "select" && viewport.zoom > 1) {
                  viewport.onTouchStart(e);
                } else if (isDragShapeTool(tool)) {
                  handlePointerDown(e);
                }
              }
            }}
            onTouchMove={(e) => {
              if (e.evt.touches.length === 2) {
                viewport.onTouchMove(e);
                return;
              }
              handlePointerMove(e);
            }}
            onTouchEnd={(e) => {
              viewport.onTouchEnd();
              handlePointerUp(e);
            }}
            onWheel={viewport.onWheel}
            style={{ cursor: drawing ? "crosshair" : "default", touchAction: "none" }}
          >
            <Layer>
              <Group x={viewport.pan.x} y={viewport.pan.y} scaleX={viewport.zoom} scaleY={viewport.zoom}>
                {image ? (
                  <KonvaImage image={image} width={displayW} height={displayH} listening={false} />
                ) : null}

                {features.map((f) => {
                  if (hiddenTypes.has(f.featureType)) return null;
                  const isSel = f.id === selectedId;
                  if (isSel && tool === "select") return null;
                  const style = styleForFeatureType(f.featureType, legend, f.existing);
                  const pts = flatFeaturePoints(f, displayW, displayH, georefContext);

                  if (f.geometry.kind === "point") {
                    const pxPts = geometryToPxPoints(f, displayW, displayH, georefContext);
                    const c = pxPts[0] ?? { x: displayW / 2, y: displayH / 2 };
                    const r =
                      geometryRadiusPx(f, displayW, displayH, georefContext) ??
                      0.02 * Math.max(displayW, displayH);
                    return (
                      <Circle
                        key={f.id}
                        x={c.x}
                        y={c.y}
                        radius={r}
                        fill={style.fill}
                        stroke={isSel ? "#059669" : style.stroke}
                        strokeWidth={isSel ? 3 : style.strokeWidth}
                        opacity={style.opacity}
                        onClick={(ev) => {
                          ev.cancelBubble = true;
                          if (tool === "select") setSelectedId(f.id);
                        }}
                      />
                    );
                  }

                  return (
                    <Line
                      key={f.id}
                      points={pts}
                      closed={f.geometry.kind === "polygon"}
                      fill={f.geometry.kind === "polygon" ? style.fill : undefined}
                      stroke={isSel ? "#059669" : style.stroke}
                      strokeWidth={isSel ? 3 : style.strokeWidth}
                      opacity={style.opacity}
                      onClick={(ev) => {
                        ev.cancelBubble = true;
                        if (tool === "select") setSelectedId(f.id);
                      }}
                    />
                  );
                })}

                {drawing && previewPoints.length > 0 ? (
                  <>
                    <Line
                      points={flatNormPoints(previewPoints, displayW, displayH)}
                      stroke={drawStyle.stroke}
                      strokeWidth={drawStyle.strokeWidth}
                      fill={
                        tool === "polygon" || tool === "rectangle" || (tool === "circle" && !drawAsPoint)
                          ? drawStyle.fill
                          : undefined
                      }
                      opacity={drawStyle.opacity}
                      dash={tool === "polyline" || drawPoints.length > 0 ? [6, 4] : undefined}
                      closed={
                        tool === "polygon" ||
                        tool === "rectangle" ||
                        (tool === "circle" && !drawAsPoint && previewPoints.length >= 3)
                      }
                    />
                    {tool === "circle" && shapeDrag && drawAsPoint ? (
                      <Circle
                        x={normToPx(shapeDrag.start, displayW, displayH).x}
                        y={normToPx(shapeDrag.start, displayW, displayH).y}
                        radius={
                          normalizedRadius(shapeDrag.start, shapeDrag.current) *
                          Math.max(displayW, displayH)
                        }
                        fill={drawStyle.fill}
                        stroke={drawStyle.stroke}
                        strokeWidth={drawStyle.strokeWidth}
                        opacity={drawStyle.opacity * 0.85}
                      />
                    ) : null}
                    {drawPoints.map((p, i) => {
                      const px = normToPx(p, displayW, displayH);
                      return (
                        <Circle
                          key={i}
                          x={px.x}
                          y={px.y}
                          radius={VERTEX_HIT_RADIUS / viewport.zoom}
                          fill={drawStyle.stroke}
                          opacity={0.9}
                        />
                      );
                    })}
                  </>
                ) : null}

                {selected && tool === "select" && !hiddenTypes.has(selected.featureType) ? (
                  <Group
                    ref={selectedGroupRef}
                    draggable
                    onDragEnd={onGroupDragEnd}
                    onTransformEnd={onTransformEnd}
                  >
                    {(() => {
                      const selStyle = styleForFeatureType(
                        selected.featureType,
                        legend,
                        selected.existing
                      );
                      if (selected.geometry.kind === "point") {
                        const pxPts = geometryToPxPoints(
                          selected,
                          displayW,
                          displayH,
                          georefContext
                        );
                        const c = pxPts[0] ?? { x: displayW / 2, y: displayH / 2 };
                        const r =
                          geometryRadiusPx(selected, displayW, displayH, georefContext) ??
                          0.02 * Math.max(displayW, displayH);
                        return (
                          <Circle
                            x={c.x}
                            y={c.y}
                            radius={r}
                            fill={selStyle.fill}
                            stroke="#059669"
                            strokeWidth={3}
                            opacity={selStyle.opacity}
                          />
                        );
                      }
                      return (
                        <Line
                          points={flatFeaturePoints(selected, displayW, displayH, georefContext)}
                          closed={selected.geometry.kind === "polygon"}
                          fill={
                            selected.geometry.kind === "polygon" ? selStyle.fill : undefined
                          }
                          stroke="#059669"
                          strokeWidth={3}
                          opacity={selStyle.opacity}
                        />
                      );
                    })()}

                    {selected.geometry.kind !== "point"
                      ? geometryToPxPoints(selected, displayW, displayH, georefContext).map(
                          (px, vi) => (
                            <Circle
                              key={`v-${vi}`}
                              x={px.x}
                              y={px.y}
                              radius={VERTEX_HIT_RADIUS / viewport.zoom}
                              fill="#fff"
                              stroke="#059669"
                              strokeWidth={2}
                              draggable
                              onDragMove={(ev) => {
                                let nextPx = {
                                  x: (ev.target.x() - 0) ,
                                  y: ev.target.y(),
                                };
                                if (snapEnabled && snapSegments.length > 0) {
                                  nextPx = snapPxPoint(nextPx, snapSegments, 12);
                                }
                                ev.target.x(nextPx.x);
                                ev.target.y(nextPx.y);
                                patchFeatures(
                                  features.map((f) =>
                                    f.id === selected.id
                                      ? georefContext
                                        ? updateFeatureVertexGeoref(
                                            f,
                                            vi,
                                            nextPx,
                                            georefContext
                                          )
                                        : updateVertex(
                                            f,
                                            vi,
                                            pxToNorm(nextPx, displayW, displayH)
                                          )
                                      : f
                                  )
                                );
                              }}
                              onDragEnd={(ev) => {
                                let nextPx = { x: ev.target.x(), y: ev.target.y() };
                                if (snapEnabled && snapSegments.length > 0) {
                                  nextPx = snapPxPoint(nextPx, snapSegments, 12);
                                }
                                commitFeatures(
                                  features.map((f) =>
                                    f.id === selected.id
                                      ? georefContext
                                        ? updateFeatureVertexGeoref(
                                            f,
                                            vi,
                                            nextPx,
                                            georefContext
                                          )
                                        : updateVertex(
                                            f,
                                            vi,
                                            pxToNorm(nextPx, displayW, displayH)
                                          )
                                      : f
                                  )
                                );
                              }}
                            />
                          )
                        )
                      : null}
                  </Group>
                ) : null}

                <Transformer
                  ref={transformerRef}
                  rotateEnabled
                  enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]}
                  boundBoxFunc={(oldBox, newBox) => {
                    if (newBox.width < 12 || newBox.height < 12) return oldBox;
                    return newBox;
                  }}
                />
              </Group>
            </Layer>
          </Stage>
        </div>

        <aside className="space-y-4 text-sm">
          {selected ? (
            <div className="rounded-lg border border-stone-200 p-3">
              <p className="font-medium text-stone-900">{selected.label || selected.id}</p>
              <label className="mt-2 block text-xs text-stone-600">
                Type
                <select
                  className="mt-1 min-h-11 w-full rounded border px-2 py-2"
                  value={selected.featureType}
                  onChange={(e) => {
                    const entry = legend.find((l) => l.featureType === e.target.value);
                    updateFeature(selected.id, (f) => ({
                      ...f,
                      featureType: e.target.value,
                      label: entry?.label ?? f.label,
                    }));
                  }}
                >
                  {legend.map((e) => (
                    <option key={e.id} value={e.featureType}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </label>
              {canMeasure ? (
                <dl className="mt-3 space-y-1 text-xs text-stone-600">
                  {area != null ? (
                    <div className="flex justify-between">
                      <dt>Area</dt>
                      <dd>{area.toLocaleString(undefined, { maximumFractionDigits: 0 })} sq ft</dd>
                    </div>
                  ) : null}
                  {perimeter != null ? (
                    <div className="flex justify-between">
                      <dt>{selected.geometry.kind === "polyline" ? "Length" : "Perimeter"}</dt>
                      <dd>{perimeter.toLocaleString(undefined, { maximumFractionDigits: 1 })} lf</dd>
                    </div>
                  ) : null}
                </dl>
              ) : (
                <p className="mt-2 text-xs text-amber-700">Save calibration for measurements.</p>
              )}
              <button
                type="button"
                onClick={() => {
                  commitFeatures(features.filter((f) => f.id !== selected.id));
                  setSelectedId(null);
                }}
                className="mt-3 min-h-11 rounded bg-red-50 px-3 py-2 text-xs text-red-800"
              >
                Delete feature
              </button>
            </div>
          ) : (
            <p className="text-stone-500">
              {drawing
                ? "Drawing — finish the current shape or switch to Select."
                : "Select a feature to edit or delete."}
            </p>
          )}

          <div className="rounded-lg border border-stone-200 p-3">
            <p className="font-medium text-stone-800">Layers</p>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {types.map((t) => (
                <li key={t}>
                  <label className="flex min-h-11 items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={!hiddenTypes.has(t)}
                      onChange={(e) => {
                        setHiddenTypes((prev) => {
                          const n = new Set(prev);
                          if (e.target.checked) n.delete(t);
                          else n.add(t);
                          return n;
                        });
                      }}
                    />
                    {labelForFeatureType(t, legend)}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </section>
  );
}
