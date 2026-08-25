"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Image as KonvaImage, Layer, Line, Rect, Stage, Transformer } from "react-konva";
import type Konva from "konva";
import type { LegendEntry } from "@/config/legend";
import {
  getUtahPlant,
  isTreeFeatureType,
  UTAH_PLANT_PALETTE,
} from "@/config/utah-plants";
import type { GeorefDisplayContext } from "@/lib/georef-display";
import {
  circleNormPoints,
  createDrawnFeature,
  isCirclePolygonFeature,
  normalizedRadius,
  radiusPx,
  rectangleNormPoints,
  squareNormPointsFromFeet,
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
  flatPxPoints,
  insertVertexAt,
  moveFeature,
  normToPx,
  pxToNorm,
  snapPxPoint,
  transformFeaturePoints,
  updateVertex,
} from "@/lib/feature-geometry";
import { labelForFeatureType, styleForFeatureType } from "@/lib/feature-styles";
import { canopyRadiusNorm, plantNotes } from "@/lib/plant-scale";
import { useBoundedHistory } from "@/hooks/useBoundedHistory";
import { useStageViewport } from "@/hooks/useStageViewport";
import type { InterpretFeature } from "@/lib/interpret-schema";
import {
  appendStrokePoint,
  smoothPolygonEdgeWithStroke,
} from "@/lib/polygon-smooth";
import type { TilePyramid } from "@/lib/tile-pyramid-schema";

type EditorTool = "select" | DrawShapeKind | "smoothEdge";
type BaseLayer = "annotated" | "clean";

/** Debounce before persisting editor geometry (avoids hammering save + UI flash). */
const EDITOR_AUTOSAVE_MS = 4000;
/** 44px touch target diameter for vertex handles. */
const VERTEX_HIT_RADIUS = 22;
const NUDGE_STEP_PX = 2;
const NUDGE_STEP_LARGE_PX = 10;

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
  return tool === "polygon" || tool === "polyline" || tool === "point" || tool === "square";
}

function isDrawTool(tool: EditorTool): boolean {
  return tool !== "select" && tool !== "smoothEdge";
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
  const smoothStrokeRef = useRef(false);
  const smoothStrokePointsRef = useRef<{ x: number; y: number }[]>([]);
  const featuresRef = useRef<InterpretFeature[]>([]);
  const lastSavedJsonRef = useRef("");
  const selectedLineRef = useRef<Konva.Line>(null);
  const draggingVertexRef = useRef(false);

  const [containerW, setContainerW] = useState(800);
  const [tool, setTool] = useState<EditorTool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingVertex, setDraggingVertex] = useState(false);
  const [drawPoints, setDrawPoints] = useState<{ x: number; y: number }[]>([]);
  const [smoothStroke, setSmoothStroke] = useState<{ x: number; y: number }[]>([]);
  const [drawFeatureType, setDrawFeatureType] = useState(legend[0]?.featureType ?? "lawn");
  const [squareSideFt, setSquareSideFt] = useState(3);
  const [selectedPlantId, setSelectedPlantId] = useState("");
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

  featuresRef.current = features;

  useEffect(() => {
    const incoming = JSON.stringify(initialFeatures);
    if (incoming === lastSavedJsonRef.current) return;
    lastSavedJsonRef.current = incoming;
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
  const activePlant = selectedPlantId ? getUtahPlant(selectedPlantId) : undefined;

  const commitFeatures = useCallback(
    (next: InterpretFeature[]) => {
      push(cloneFeatures(next));
    },
    [push]
  );

  function plantPlacementRadius(): number | undefined {
    if (!activePlant) return undefined;
    return canopyRadiusNorm(
      activePlant.canopyDiameterFt,
      displayW,
      displayH,
      pixelsPerFoot
    );
  }

  function addFeatureFromDraw(
    geometryKind: "polygon" | "polyline" | "point",
    points: { x: number; y: number }[],
    radius?: number,
    overrides?: {
      featureType?: string;
      label?: string;
      notes?: string;
    }
  ) {
    if (geometryKind === "point" && points.length < 1) return;
    if (geometryKind === "polyline" && points.length < 2) return;
    if (geometryKind === "polygon" && points.length < 3) return;

    const plant = activePlant;
    const featureType = overrides?.featureType ?? plant?.featureType ?? drawFeatureType;
    const pointRadius =
      radius ??
      (geometryKind === "point" && plant
        ? plantPlacementRadius()
        : undefined);

    const f = createDrawnFeature({
      featureType,
      legend,
      geometryKind,
      points,
      radius: pointRadius,
      features,
      georefContext,
      displayW,
      displayH,
      label: overrides?.label ?? plant?.commonName,
      notes: overrides?.notes ?? (plant ? plantNotes(plant) : ""),
    });
    commitFeatures([...features, f]);
    setSelectedId(f.id);
    setDrawPoints([]);
    setShapeDrag(null);
    setTool("select");
  }

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
      const payload = {
        features,
        editorSettings: { hiddenFeatureTypes: [...hiddenTypes] },
      };
      lastSavedJsonRef.current = JSON.stringify(features);
      onAutosaveRef.current(payload);
      setSaveLabel("Saved");
      const clear = setTimeout(() => setSaveLabel(""), 1500);
      return () => clearTimeout(clear);
    }, EDITOR_AUTOSAVE_MS);
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
    const g = selectedGroupRef.current;
    if (!g || draggingVertex) return;
    g.position({ x: 0, y: 0 });
  }, [features, selectedId, draggingVertex]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        if (isDrawTool(tool) && isClickShapeTool(tool) && drawPoints.length > 0) {
          e.preventDefault();
          setDrawPoints((prev) => prev.slice(0, -1));
          return;
        }
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (isDrawTool(tool) && isClickShapeTool(tool) && drawPoints.length > 0) {
          e.preventDefault();
          setDrawPoints((prev) => prev.slice(0, -1));
          return;
        }
        if (selectedId && tool === "select") {
          e.preventDefault();
          commitFeatures(featuresRef.current.filter((f) => f.id !== selectedId));
          setSelectedId(null);
        }
      }
      if (
        selectedId &&
        tool === "select" &&
        (e.key === "ArrowUp" ||
          e.key === "ArrowDown" ||
          e.key === "ArrowLeft" ||
          e.key === "ArrowRight")
      ) {
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_STEP_LARGE_PX : NUDGE_STEP_PX;
        let dx = 0;
        let dy = 0;
        if (e.key === "ArrowUp") dy = -step;
        if (e.key === "ArrowDown") dy = step;
        if (e.key === "ArrowLeft") dx = -step;
        if (e.key === "ArrowRight") dx = step;
        const next = featuresRef.current.map((f) => {
          if (f.id !== selectedId) return f;
          return georefContext
            ? moveFeatureGeoref(f, dx, dy, georefContext)
            : moveFeature(f, dx / displayW, dy / displayH);
        });
        commitFeatures(next);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, selectedId, commitFeatures, tool, georefContext, displayW, displayH, drawPoints.length]);

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

  function finishPolygonOrPolyline() {
    const kind = tool === "polyline" ? "polyline" : "polygon";
    addFeatureFromDraw(kind, drawPoints);
  }

  function handlePointerDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (tool === "select") return;
    if (isDragShapeTool(tool)) {
      const stage = e.target.getStage();
      if (!stage) return;
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
        const r =
          activePlant && plantPlacementRadius() != null
            ? plantPlacementRadius()!
            : normalizedRadius(start, current, displayW, displayH);
        if (r > 0.002) addFeatureFromDraw("point", [start], r);
      } else {
        const pts = circleNormPoints(start, current, displayW, displayH);
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
    if (!stage) return;
    const norm = contentNormFromStage(stage);
    if (!norm) return;
    const pt = applySnapNorm(norm);

    if (tool === "point" || (tool === "circle" && drawEntry?.unit === "each")) {
      const r = activePlant ? plantPlacementRadius() : 0.025;
      addFeatureFromDraw("point", [pt], r);
      return;
    }

    if (tool === "square") {
      if (!pixelsPerFoot || pixelsPerFoot <= 0) return;
      const pts = squareNormPointsFromFeet(pt, squareSideFt, displayW, displayH, pixelsPerFoot);
      addFeatureFromDraw("polygon", pts);
      return;
    }

    setDrawPoints((prev) => [...prev, pt]);
  }

  function resetSelectedGroupPosition() {
    const g = selectedGroupRef.current;
    if (g) g.position({ x: 0, y: 0 });
  }

  function applyVertexPx(
    feature: InterpretFeature,
    vertexIndex: number,
    nextPx: { x: number; y: number }
  ): InterpretFeature {
    return georefContext
      ? updateFeatureVertexGeoref(feature, vertexIndex, nextPx, georefContext)
      : updateVertex(feature, vertexIndex, pxToNorm(nextPx, displayW, displayH));
  }

  function syncSelectedLinePoints(
    feature: InterpretFeature,
    vertexIndex: number,
    nextPx: { x: number; y: number }
  ) {
    const line = selectedLineRef.current;
    if (!line) return;
    const pts = geometryToPxPoints(feature, displayW, displayH, georefContext);
    if (vertexIndex < 0 || vertexIndex >= pts.length) return;
    pts[vertexIndex] = nextPx;
    line.points(flatPxPoints(pts));
    line.getLayer()?.batchDraw();
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

  function onGroupDragStart(e: Konva.KonvaEventObject<DragEvent>) {
    if (draggingVertexRef.current) {
      e.target.stopDrag();
    }
  }

  function onGroupDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
    const node = e.target;
    if (!selectedId) return;
    const dxPx = node.x() / viewport.zoom;
    const dyPx = node.y() / viewport.zoom;
    node.position({ x: 0, y: 0 });
    if (Math.abs(dxPx) < 0.5 && Math.abs(dyPx) < 0.5) return;

    const next = featuresRef.current.map((f) => {
      if (f.id !== selectedId) return f;
      return georefContext
        ? moveFeatureGeoref(f, dxPx, dyPx, georefContext)
        : moveFeature(f, dxPx / displayW, dyPx / displayH);
    });
    commitFeatures(next);
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
  const drawing = isDrawTool(tool);
  const smoothing = tool === "smoothEdge";
  const overlayActive = drawing || smoothing;
  const canSmooth =
    selected != null &&
    selected.geometry.kind === "polygon" &&
    !hiddenTypes.has(selected.featureType);

  const previewPoints = useMemo(() => {
    if (shapeDrag && tool === "rectangle") {
      return rectangleNormPoints(shapeDrag.start, shapeDrag.current);
    }
    if (shapeDrag && tool === "circle" && !drawAsPoint) {
      return circleNormPoints(shapeDrag.start, shapeDrag.current, displayW, displayH);
    }
    return drawPoints;
  }, [shapeDrag, tool, drawAsPoint, drawPoints, displayW, displayH]);

  function selectDrawTool(next: DrawShapeKind) {
    setTool(next);
    setDrawPoints([]);
    setShapeDrag(null);
    setSmoothStroke([]);
    smoothStrokePointsRef.current = [];
    smoothStrokeRef.current = false;
    setSelectedId(null);
    dragShapeRef.current = false;
  }

  function handleSmoothPointerDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (tool !== "smoothEdge") return;
    const stage = e.target.getStage();
    if (!stage) return;
    const content = viewport.pointerToContent(stage);
    if (!content) return;
    smoothStrokeRef.current = true;
    smoothStrokePointsRef.current = [content];
    setSmoothStroke([content]);
  }

  function handleSmoothPointerMove(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (!smoothStrokeRef.current || tool !== "smoothEdge") return;
    const stage = e.target.getStage();
    if (!stage) return;
    const content = viewport.pointerToContent(stage);
    if (!content) return;
    smoothStrokePointsRef.current = appendStrokePoint(smoothStrokePointsRef.current, content);
    setSmoothStroke(smoothStrokePointsRef.current);
  }

  function handleSmoothPointerUp() {
    if (!smoothStrokeRef.current || tool !== "smoothEdge") return;
    smoothStrokeRef.current = false;
    const stroke = smoothStrokePointsRef.current;
    const target = selectedId ? features.find((f) => f.id === selectedId) : null;
    if (target?.geometry.kind === "polygon") {
      const next = smoothPolygonEdgeWithStroke(
        target,
        stroke,
        displayW,
        displayH,
        georefContext
      );
      if (next) {
        commitFeatures(features.map((f) => (f.id === target.id ? next : f)));
      }
    }
    smoothStrokePointsRef.current = [];
    setSmoothStroke([]);
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
          setSmoothStroke([]);
          smoothStrokePointsRef.current = [];
          smoothStrokeRef.current = false;
        })}
        {toolBtn(tool === "polygon", "Polygon", () => selectDrawTool("polygon"))}
        {toolBtn(tool === "rectangle", "Rectangle", () => selectDrawTool("rectangle"))}
        {toolBtn(tool === "square", "Square (ft)", () => selectDrawTool("square"), !pixelsPerFoot)}
        {toolBtn(tool === "circle", "Circle", () => selectDrawTool("circle"))}
        {toolBtn(tool === "polyline", "Polyline", () => selectDrawTool("polyline"))}
        {toolBtn(tool === "point", "Point", () => selectDrawTool("point"))}
        {toolBtn(
          tool === "smoothEdge",
          "Smooth edge",
          () => {
            setTool("smoothEdge");
            setDrawPoints([]);
            setShapeDrag(null);
            setSmoothStroke([]);
            smoothStrokePointsRef.current = [];
            smoothStrokeRef.current = false;
            dragShapeRef.current = false;
          },
          !canSmooth
        )}
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
              onChange={(e) => {
                setDrawFeatureType(e.target.value);
                if (!isTreeFeatureType(e.target.value)) setSelectedPlantId("");
              }}
            >
              {legend.map((e) => (
                <option key={e.id} value={e.featureType}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-emerald-950">
            <span className="font-medium">Utah / Salt Lake plant</span>
            <select
              className="mt-1 min-h-11 w-full min-w-[12rem] rounded border px-2 py-2"
              value={selectedPlantId}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedPlantId(id);
                const plant = getUtahPlant(id);
                if (plant) {
                  setDrawFeatureType(plant.featureType);
                  if (tool !== "point" && tool !== "circle") setTool("point");
                }
              }}
            >
              <option value="">Custom size (manual)</option>
              {UTAH_PLANT_PALETTE.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.commonName} (~{p.canopyDiameterFt} ft)
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
            {tool === "square" &&
              (pixelsPerFoot
                ? `Tap to place a ${squareSideFt}'×${squareSideFt}' square (center at tap).`
                : "Calibrate scale to use square-by-feet.")}
            {tool === "circle" &&
              (drawAsPoint
                ? activePlant
                  ? `Tap to place ${activePlant.commonName} at ~${activePlant.canopyDiameterFt} ft canopy.`
                  : "Press and drag from center to set canopy radius."
                : "Press and drag a circle.")}
            {tool === "point" &&
              (activePlant
                ? `Tap to place ${activePlant.commonName} (~${activePlant.canopyDiameterFt} ft canopy).`
                : "Tap once to place a point feature.")}
          </p>
          {(tool === "polygon" || tool === "polyline") && (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={drawPoints.length === 0}
                onClick={() => setDrawPoints((prev) => prev.slice(0, -1))}
                className="min-h-11 rounded border px-4 py-2 text-sm disabled:opacity-50"
              >
                Undo point
              </button>
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
          {tool === "square" && pixelsPerFoot ? (
            <label className="block text-sm text-emerald-950">
              <span className="font-medium">Square side (ft)</span>
              <input
                type="number"
                min={0.5}
                step={0.5}
                className="mt-1 min-h-11 w-24 rounded border px-2 py-2"
                value={squareSideFt}
                onChange={(e) => setSquareSideFt(Math.max(0.5, Number(e.target.value) || 3))}
              />
            </label>
          ) : null}
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
            style={{ cursor: overlayActive ? "crosshair" : "default", touchAction: "none" }}
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
                  const highlightSmooth = isSel && smoothing;

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
                        listening={!overlayActive}
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
                      stroke={highlightSmooth ? "#f59e0b" : isSel ? "#059669" : style.stroke}
                      strokeWidth={highlightSmooth ? 4 : isSel ? 3 : style.strokeWidth}
                      opacity={style.opacity}
                      listening={!overlayActive}
                      onClick={(ev) => {
                        ev.cancelBubble = true;
                        if (tool === "select") setSelectedId(f.id);
                      }}
                    />
                  );
                })}

                {smoothing && smoothStroke.length > 1 ? (
                  <Line
                    points={flatPxPoints(smoothStroke)}
                    stroke="#f59e0b"
                    strokeWidth={4}
                    opacity={0.95}
                    lineCap="round"
                    lineJoin="round"
                    listening={false}
                  />
                ) : null}

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
                      listening={false}
                    />
                    {tool === "circle" && shapeDrag && drawAsPoint ? (
                      <Circle
                        x={normToPx(shapeDrag.start, displayW, displayH).x}
                        y={normToPx(shapeDrag.start, displayW, displayH).y}
                        radius={radiusPx(shapeDrag.start, shapeDrag.current, displayW, displayH)}
                        fill={drawStyle.fill}
                        stroke={drawStyle.stroke}
                        strokeWidth={drawStyle.strokeWidth}
                        opacity={drawStyle.opacity * 0.85}
                        listening={false}
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
                          listening={false}
                        />
                      );
                    })}
                  </>
                ) : null}

                {selected && tool === "select" && !hiddenTypes.has(selected.featureType) ? (
                  <Group
                    ref={selectedGroupRef}
                    draggable={!draggingVertex}
                    onDragStart={onGroupDragStart}
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
                        <>
                          <Line
                            points={flatFeaturePoints(selected, displayW, displayH, georefContext)}
                            closed={selected.geometry.kind === "polygon"}
                            fill={
                              selected.geometry.kind === "polygon" ? selStyle.fill : undefined
                            }
                            stroke="#ffffff"
                            strokeWidth={1 / viewport.zoom}
                            opacity={selStyle.opacity}
                            listening={false}
                          />
                          <Line
                            ref={selectedLineRef}
                            points={flatFeaturePoints(selected, displayW, displayH, georefContext)}
                            closed={selected.geometry.kind === "polygon"}
                            fill={
                              selected.geometry.kind === "polygon" ? selStyle.fill : undefined
                            }
                            stroke="#059669"
                            strokeWidth={2 / viewport.zoom}
                            opacity={selStyle.opacity}
                          />
                        </>
                      );
                    })()}

                    {selected.geometry.kind !== "point" && !isCirclePolygonFeature(selected)
                      ? geometryToPxPoints(selected, displayW, displayH, georefContext).map(
                          (px, vi) => (
                            <Circle
                              key={`v-${vi}`}
                              x={px.x}
                              y={px.y}
                              radius={6 / viewport.zoom}
                              stroke="#ffffff"
                              strokeWidth={2 / viewport.zoom}
                              fill="#059669"
                              hitStrokeWidth={VERTEX_HIT_RADIUS / viewport.zoom}
                              draggable
                              onMouseDown={(ev) => {
                                ev.cancelBubble = true;
                              }}
                              onDragStart={(ev) => {
                                ev.cancelBubble = true;
                                draggingVertexRef.current = true;
                                setDraggingVertex(true);
                                resetSelectedGroupPosition();
                              }}
                              onDragMove={(ev) => {
                                ev.cancelBubble = true;
                                let nextPx = { x: ev.target.x(), y: ev.target.y() };
                                if (snapEnabled && snapSegments.length > 0) {
                                  nextPx = snapPxPoint(nextPx, snapSegments, 12);
                                }
                                ev.target.position(nextPx);
                                resetSelectedGroupPosition();
                                const currentFeature = featuresRef.current.find(
                                  (f) => f.id === selected.id
                                );
                                if (currentFeature) {
                                  syncSelectedLinePoints(currentFeature, vi, nextPx);
                                }
                              }}
                              onDragEnd={(ev) => {
                                ev.cancelBubble = true;
                                draggingVertexRef.current = false;
                                setDraggingVertex(false);
                                let nextPx = { x: ev.target.x(), y: ev.target.y() };
                                if (snapEnabled && snapSegments.length > 0) {
                                  nextPx = snapPxPoint(nextPx, snapSegments, 12);
                                }
                                resetSelectedGroupPosition();
                                const next = featuresRef.current.map((f) =>
                                  f.id === selected.id ? applyVertexPx(f, vi, nextPx) : f
                                );
                                commitFeatures(next);
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

                {drawing ? (
                  <Rect
                    x={0}
                    y={0}
                    width={displayW}
                    height={displayH}
                    fill="rgba(0,0,0,0)"
                    onClick={handleStageClick}
                    onTap={handleStageClick}
                    onMouseDown={handlePointerDown}
                    onMouseMove={handlePointerMove}
                    onMouseUp={handlePointerUp}
                  />
                ) : null}

                {smoothing ? (
                  <Rect
                    x={0}
                    y={0}
                    width={displayW}
                    height={displayH}
                    fill="rgba(0,0,0,0)"
                    onMouseDown={handleSmoothPointerDown}
                    onMouseMove={handleSmoothPointerMove}
                    onMouseUp={handleSmoothPointerUp}
                    onTouchStart={handleSmoothPointerDown}
                    onTouchMove={handleSmoothPointerMove}
                    onTouchEnd={handleSmoothPointerUp}
                  />
                ) : null}
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
              <p className="mt-2 text-xs text-stone-500">
                Arrow keys nudge 2px · Shift+arrow 10px
              </p>
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
              {selected.geometry.kind === "polygon" ? (
                <button
                  type="button"
                  onClick={() => {
                    setTool("smoothEdge");
                    setDrawPoints([]);
                    setShapeDrag(null);
                    setSmoothStroke([]);
                    smoothStrokePointsRef.current = [];
                    smoothStrokeRef.current = false;
                    dragShapeRef.current = false;
                  }}
                  className="mt-2 min-h-11 w-full rounded bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900"
                >
                  Smooth edge…
                </button>
              ) : null}
            </div>
              ) : (
            <p className="text-stone-500">
              {drawing
                ? "Drawing — finish the current shape or switch to Select."
                : smoothing
                  ? "Drag along an edge to smooth it."
                  : "Select a polygon, then use Smooth edge to round a side."}
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
