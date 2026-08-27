import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

type Pan = { x: number; y: number };

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.2;

/** Pan/zoom for HTML image viewers (calibration, previews). */
export function useImageViewport(containerRef: RefObject<HTMLElement | null>) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const stateRef = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  const mousePanRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(
    null
  );

  stateRef.current = { zoom, pan };

  const applyZoomAt = useCallback((nextZoom: number, pointerX: number, pointerY: number) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
    const { zoom: oldZoom, pan: oldPan } = stateRef.current;
    const mousePointTo = {
      x: (pointerX - oldPan.x) / oldZoom,
      y: (pointerY - oldPan.y) / oldZoom,
    };
    setZoom(clamped);
    setPan({
      x: pointerX - mousePointTo.x * clamped,
      y: pointerY - mousePointTo.y * clamped,
    });
  }, []);

  const resetViewport = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    mousePanRef.current = null;
    setIsPanning(false);
  }, []);

  const zoomIn = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    applyZoomAt(stateRef.current.zoom * ZOOM_STEP, rect.width / 2, rect.height / 2);
  }, [applyZoomAt, containerRef]);

  const zoomOut = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    applyZoomAt(stateRef.current.zoom / ZOOM_STEP, rect.width / 2, rect.height / 2);
  }, [applyZoomAt, containerRef]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      const pointerX = e.clientX - rect.left;
      const pointerY = e.clientY - rect.top;
      const dir = e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
      applyZoomAt(stateRef.current.zoom * dir, pointerX, pointerY);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyZoomAt, containerRef]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const btn = e.button;
      const canPan = btn === 1 || btn === 2 || (btn === 0 && e.shiftKey);
      if (!canPan) return;
      e.preventDefault();
      mousePanRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: stateRef.current.pan.x,
        panY: stateRef.current.pan.y,
      };
      setIsPanning(true);
    },
    []
  );

  useEffect(() => {
    if (!isPanning) return;
    const onMove = (e: MouseEvent) => {
      if (!mousePanRef.current) return;
      setPan({
        x: mousePanRef.current.panX + (e.clientX - mousePanRef.current.x),
        y: mousePanRef.current.panY + (e.clientY - mousePanRef.current.y),
      });
    };
    const onUp = () => {
      mousePanRef.current = null;
      setIsPanning(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isPanning]);

  return {
    zoom,
    pan,
    isPanning,
    resetViewport,
    zoomIn,
    zoomOut,
    onMouseDown,
    transformStyle: {
      transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
      transformOrigin: "0 0",
    } as const,
  };
}
