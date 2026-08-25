"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Image as KonvaImage, Layer, Line, Stage, Transformer } from "react-konva";
import type Konva from "konva";
import type { LegendEntry } from "@/config/legend";
import {
  centroidNorm,
  cloneFeatures,
  collectSnapSegments,
  deleteVertexAt,
  featureAreaSqFt,
  featurePerimeterLf,
  flatNormPoints,
  insertVertexAt,
  moveFeature,
  newFeatureId,
  normToPx,
  pxToNorm,
  snapPxPoint,
  transformFeaturePoints,
  updateVertex,
} from "@/lib/feature-geometry";
import { labelForFeatureType, styleForFeatureType } from "@/lib/feature-styles";
import { useBoundedHistory } from "@/hooks/useBoundedHistory";
import type { InterpretFeature } from "@/lib/interpret-schema";

type Tool = "select" | "draw";

export type EditorSettings = {
  hiddenFeatureTypes: string[];
};

type Props = {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  features: InterpretFeature[];
  legend: LegendEntry[];
  pixelsPerFoot?: number;
  editorSettings?: EditorSettings;
  onAutosave: (payload: {
    features: InterpretFeature[];
    editorSettings: EditorSettings;
  }) => void;
};

function useHtmlImage(src: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
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

export default function PolygonEditor({
  imageUrl,
  imageWidth,
  imageHeight,
  features: initialFeatures,
  legend,
  pixelsPerFoot,
  editorSettings,
  onAutosave,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const selectedGroupRef = useRef<Konva.Group>(null);
  const skipSaveRef = useRef(true);
  const onAutosaveRef = useRef(onAutosave);
  onAutosaveRef.current = onAutosave;

  const [containerW, setContainerW] = useState(800);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawPoints, setDrawPoints] = useState<{ x: number; y: number }[]>([]);
  const [drawFeatureType, setDrawFeatureType] = useState(legend[0]?.featureType ?? "lawn");
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(
    () => new Set(editorSettings?.hiddenFeatureTypes ?? [])
  );
  const [saveLabel, setSaveLabel] = useState("");

  const image = useHtmlImage(imageUrl);

  const history = useBoundedHistory<InterpretFeature[]>(
    cloneFeatures(initialFeatures)
  );
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
  const scale = Math.min(containerW / imageWidth, maxH / imageHeight, 1);
  const displayW = Math.round(imageWidth * scale);
  const displayH = Math.round(imageHeight * scale);

  const snapSegments = useMemo(
    () => collectSnapSegments(features, displayW, displayH),
    [features, displayW, displayH]
  );

  const selected = features.find((f) => f.id === selectedId) ?? null;
  const drawEntry = legend.find((e) => e.featureType === drawFeatureType);
  const drawAsPoint = drawEntry?.unit === "each";

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
        if (selectedId) {
          e.preventDefault();
          commitFeatures(features.filter((f) => f.id !== selectedId));
          setSelectedId(null);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, selectedId, features, commitFeatures]);

  function pointerToNorm(stage: Konva.Stage) {
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    return pxToNorm(pos, displayW, displayH);
  }

  function applySnapNorm(p: { x: number; y: number }) {
    if (!snapEnabled || snapSegments.length === 0) return p;
    const px = normToPx(p, displayW, displayH);
    const snapped = snapPxPoint(px, snapSegments, 10);
    return pxToNorm(snapped, displayW, displayH);
  }

  function handleStageClick(e: Konva.KonvaEventObject<MouseEvent>) {
    if (tool !== "draw") {
      if (e.target === e.target.getStage()) setSelectedId(null);
      return;
    }
    const stage = e.target.getStage();
    if (!stage) return;
    const norm = pointerToNorm(stage);
    if (!norm) return;
    const pt = applySnapNorm(norm);

    if (drawAsPoint) {
      const prefix = drawFeatureType.replace(/_/g, "-");
      const entry = legend.find((l) => l.featureType === drawFeatureType);
      const f: InterpretFeature = {
        id: newFeatureId(prefix, features),
        featureType: drawFeatureType,
        label: entry?.label ?? drawFeatureType,
        geometry: {
          kind: "point",
          points: [pt],
          radius: 0.025,
        },
        existing: false,
        confidence: 1,
        notes: "",
      };
      commitFeatures([...features, f]);
      setSelectedId(f.id);
      setTool("select");
      return;
    }

    setDrawPoints((prev) => [...prev, pt]);
  }

  function finishDraw() {
    if (drawPoints.length < 3) return;
    const prefix = drawFeatureType.replace(/_/g, "-");
    const entry = legend.find((l) => l.featureType === drawFeatureType);
    const f: InterpretFeature = {
      id: newFeatureId(prefix, features),
      featureType: drawFeatureType,
      label: entry?.label ?? drawFeatureType,
      geometry: { kind: "polygon", points: drawPoints },
      existing: false,
      confidence: 1,
      notes: "",
    };
    commitFeatures([...features, f]);
    setDrawPoints([]);
    setSelectedId(f.id);
    setTool("select");
  }

  function cancelDraw() {
    setDrawPoints([]);
    setTool("select");
  }

  function onTransformEnd() {
    const group = selectedGroupRef.current;
    if (!group || !selected) return;
    const center = centroidNorm(selected.geometry.points);
    const scaleX = group.scaleX();
    const scaleY = group.scaleY();
    const rotation = group.rotation();
    group.scaleX(1);
    group.scaleY(1);
    group.rotation(0);
    group.x(0);
    group.y(0);
    updateFeature(selected.id, (f) =>
      transformFeaturePoints(f, displayW, displayH, center, scaleX, scaleY, rotation)
    );
  }

  function onGroupDragEnd(e: Konva.KonvaEventObject<DragEvent>) {
    const node = e.target;
    const dx = node.x() / displayW;
    const dy = node.y() / displayH;
    node.x(0);
    node.y(0);
    if (!selected) return;
    updateFeature(selected.id, (f) => moveFeature(f, dx, dy));
  }

  const area =
    selected && pixelsPerFoot
      ? featureAreaSqFt(selected, displayW, displayH, pixelsPerFoot)
      : null;
  const perimeter =
    selected && pixelsPerFoot
      ? featurePerimeterLf(selected, displayW, displayH, pixelsPerFoot)
      : null;

  const types = featureTypes(features, legend);

  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">Polygon editor</h2>
          <p className="text-sm text-stone-600">
            Refine Claude&apos;s shapes on the clean orthophoto — drag vertices, transform features,
            draw new areas.
          </p>
        </div>
        <span className="text-xs text-stone-500">{saveLabel}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setTool("select");
            setDrawPoints([]);
          }}
          className={`rounded-md px-3 py-1.5 text-sm ${tool === "select" ? "bg-emerald-700 text-white" : "bg-stone-100"}`}
        >
          Select
        </button>
        <button
          type="button"
          onClick={() => {
            setTool("draw");
            setDrawPoints([]);
            setSelectedId(null);
          }}
          className={`rounded-md px-3 py-1.5 text-sm ${tool === "draw" ? "bg-emerald-700 text-white" : "bg-stone-100"}`}
        >
          Draw new
        </button>
        <button
          type="button"
          disabled={!canUndo}
          onClick={undo}
          className="rounded-md bg-stone-100 px-3 py-1.5 text-sm disabled:opacity-40"
        >
          Undo
        </button>
        <button
          type="button"
          disabled={!canRedo}
          onClick={redo}
          className="rounded-md bg-stone-100 px-3 py-1.5 text-sm disabled:opacity-40"
        >
          Redo
        </button>
        <label className="flex items-center gap-2 rounded-md bg-stone-100 px-3 py-1.5 text-sm">
          <input
            type="checkbox"
            checked={snapEnabled}
            onChange={(e) => setSnapEnabled(e.target.checked)}
          />
          Snap to existing edges
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
        <div ref={containerRef} className="overflow-hidden rounded-lg border border-stone-200 bg-stone-900">
          <Stage
            width={displayW}
            height={displayH}
            onClick={handleStageClick}
            style={{ cursor: tool === "draw" ? "crosshair" : "default" }}
          >
            <Layer>
              {image ? (
                <KonvaImage image={image} width={displayW} height={displayH} listening={false} />
              ) : null}

              {features.map((f) => {
                if (hiddenTypes.has(f.featureType)) return null;
                const isSel = f.id === selectedId;
                if (isSel && tool === "select") return null;
                const style = styleForFeatureType(f.featureType, legend, f.existing);
                const pts = flatNormPoints(f.geometry.points, displayW, displayH);

                if (f.geometry.kind === "point") {
                  const c = normToPx(f.geometry.points[0], displayW, displayH);
                  const r =
                    (f.geometry.radius ?? 0.02) * Math.max(displayW, displayH);
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
                      onClick={(e) => {
                        e.cancelBubble = true;
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
                    onClick={(e) => {
                      e.cancelBubble = true;
                      if (tool === "select") setSelectedId(f.id);
                    }}
                  />
                );
              })}

              {tool === "draw" && drawPoints.length > 0 ? (
                <>
                  <Line
                    points={flatNormPoints(drawPoints, displayW, displayH)}
                    stroke="#059669"
                    strokeWidth={2}
                    dash={[6, 4]}
                    closed={drawPoints.length >= 3 && !drawAsPoint}
                  />
                  {drawPoints.map((p, i) => {
                    const px = normToPx(p, displayW, displayH);
                    return (
                      <Circle key={i} x={px.x} y={px.y} radius={4} fill="#059669" />
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
                      const c = normToPx(selected.geometry.points[0], displayW, displayH);
                      const r =
                        (selected.geometry.radius ?? 0.02) *
                        Math.max(displayW, displayH);
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
                        points={flatNormPoints(selected.geometry.points, displayW, displayH)}
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
                    ? selected.geometry.points.map((p, vi) => {
                        const px = normToPx(p, displayW, displayH);
                        return (
                          <Circle
                            key={`v-${vi}`}
                            x={px.x}
                            y={px.y}
                            radius={7}
                            fill="#fff"
                            stroke="#059669"
                            strokeWidth={2}
                            draggable
                            onDragMove={(e) => {
                              let norm = pxToNorm(
                                { x: e.target.x(), y: e.target.y() },
                                displayW,
                                displayH
                              );
                              norm = applySnapNorm(norm);
                              e.target.x(normToPx(norm, displayW, displayH).x);
                              e.target.y(normToPx(norm, displayW, displayH).y);
                              patchFeatures(
                                features.map((f) =>
                                  f.id === selected.id ? updateVertex(f, vi, norm) : f
                                )
                              );
                            }}
                            onDragEnd={(e) => {
                              let norm = pxToNorm(
                                { x: e.target.x(), y: e.target.y() },
                                displayW,
                                displayH
                              );
                              norm = applySnapNorm(norm);
                              commitFeatures(
                                features.map((f) =>
                                  f.id === selected.id ? updateVertex(f, vi, norm) : f
                                )
                              );
                            }}
                          />
                        );
                      })
                    : null}

                  {selected.geometry.kind === "polygon"
                    ? selected.geometry.points.map((p, ei) => {
                        const next = selected.geometry.points[(ei + 1) % selected.geometry.points.length];
                        const mid = {
                          x: (p.x + next.x) / 2,
                          y: (p.y + next.y) / 2,
                        };
                        const mpx = normToPx(mid, displayW, displayH);
                        return (
                          <Circle
                            key={`m-${ei}`}
                            x={mpx.x}
                            y={mpx.y}
                            radius={5}
                            fill="#d1fae5"
                            stroke="#059669"
                            strokeWidth={1}
                            onClick={(e) => {
                              e.cancelBubble = true;
                              updateFeature(selected.id, (f) => insertVertexAt(f, ei));
                            }}
                          />
                        );
                      })
                    : null}
                </Group>
              ) : null}

              <Transformer
                ref={transformerRef}
                rotateEnabled
                enabledAnchors={[
                  "top-left",
                  "top-right",
                  "bottom-left",
                  "bottom-right",
                ]}
                boundBoxFunc={(oldBox, newBox) => {
                  if (newBox.width < 12 || newBox.height < 12) return oldBox;
                  return newBox;
                }}
              />
            </Layer>
          </Stage>
        </div>

        <aside className="space-y-4 text-sm">
          {tool === "draw" ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="font-medium text-emerald-900">Draw mode</p>
              <label className="mt-2 block text-xs text-emerald-800">
                Feature type
                <select
                  className="mt-1 w-full rounded border px-2 py-1"
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
              <p className="mt-2 text-xs text-emerald-800">
                {drawAsPoint
                  ? "Click once to place a point feature."
                  : "Click to add vertices. Need at least 3 points."}
              </p>
              {!drawAsPoint ? (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={drawPoints.length < 3}
                    onClick={finishDraw}
                    className="rounded bg-emerald-700 px-2 py-1 text-xs text-white disabled:opacity-50"
                  >
                    Finish shape
                  </button>
                  <button
                    type="button"
                    onClick={cancelDraw}
                    className="rounded border px-2 py-1 text-xs"
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {selected ? (
            <div className="rounded-lg border border-stone-200 p-3">
              <p className="font-medium text-stone-900">{selected.label || selected.id}</p>
              <label className="mt-2 block text-xs text-stone-600">
                Type
                <select
                  className="mt-1 w-full rounded border px-2 py-1"
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
                  {!legend.some((e) => e.featureType === selected.featureType) ? (
                    <option value={selected.featureType}>{selected.featureType}</option>
                  ) : null}
                </select>
              </label>
              {pixelsPerFoot ? (
                <dl className="mt-3 space-y-1 text-xs text-stone-600">
                  {area != null ? (
                    <div className="flex justify-between">
                      <dt>Area</dt>
                      <dd className="font-medium text-stone-900">
                        {area.toLocaleString(undefined, { maximumFractionDigits: 0 })} sq ft
                      </dd>
                    </div>
                  ) : null}
                  {perimeter != null ? (
                    <div className="flex justify-between">
                      <dt>{selected.geometry.kind === "polyline" ? "Length" : "Perimeter"}</dt>
                      <dd className="font-medium text-stone-900">
                        {perimeter.toLocaleString(undefined, { maximumFractionDigits: 1 })} lf
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : (
                <p className="mt-2 text-xs text-amber-700">Save calibration for measurements.</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    commitFeatures(features.filter((f) => f.id !== selected.id));
                    setSelectedId(null);
                  }}
                  className="rounded bg-red-50 px-2 py-1 text-xs text-red-800"
                >
                  Delete feature
                </button>
                {selected.geometry.kind !== "point" &&
                selected.geometry.points.length >
                  (selected.geometry.kind === "polygon" ? 3 : 2) ? (
                  <button
                    type="button"
                    onClick={() => {
                      const last = selected.geometry.points.length - 1;
                      const next = deleteVertexAt(selected, last);
                      if (next) updateFeature(selected.id, () => next);
                    }}
                    className="rounded bg-stone-100 px-2 py-1 text-xs"
                  >
                    Delete last vertex
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-stone-500">Select a feature to edit type, size, or delete.</p>
          )}

          <div className="rounded-lg border border-stone-200 p-3">
            <p className="font-medium text-stone-800">Layers</p>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {types.map((t) => (
                <li key={t}>
                  <label className="flex items-center gap-2 text-xs">
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
