import { useCallback, useEffect, useRef, useState } from "react";
import type Konva from "konva";

type Pan = { x: number; y: number };

export function useStageViewport() {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [spacePan, setSpacePan] = useState(false);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(
    null
  );
  const mousePanRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(
    null
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        setSpacePan(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpacePan(false);
        mousePanRef.current = null;
        setIsPanning(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const resetViewport = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    pinchRef.current = null;
    panRef.current = null;
    mousePanRef.current = null;
    setIsPanning(false);
  }, []);

  function touchDistance(touches: TouchList): number {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  const onTouchStart = useCallback(
    (e: Konva.KonvaEventObject<TouchEvent>) => {
      const te = e.evt;
      if (te.touches.length === 2) {
        pinchRef.current = { dist: touchDistance(te.touches), zoom };
        panRef.current = null;
      } else if (te.touches.length === 1 && zoom > 1) {
        panRef.current = {
          x: te.touches[0].clientX,
          y: te.touches[0].clientY,
          panX: pan.x,
          panY: pan.y,
        };
      }
    },
    [zoom, pan.x, pan.y]
  );

  const onTouchMove = useCallback((e: Konva.KonvaEventObject<TouchEvent>) => {
    const te = e.evt;
    if (te.touches.length === 2 && pinchRef.current) {
      te.preventDefault();
      const dist = touchDistance(te.touches);
      if (dist > 0 && pinchRef.current.dist > 0) {
        const next = Math.min(5, Math.max(0.5, (pinchRef.current.zoom * dist) / pinchRef.current.dist));
        setZoom(next);
      }
    } else if (te.touches.length === 1 && panRef.current) {
      te.preventDefault();
      const dx = te.touches[0].clientX - panRef.current.x;
      const dy = te.touches[0].clientY - panRef.current.y;
      setPan({ x: panRef.current.panX + dx, y: panRef.current.panY + dy });
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    pinchRef.current = null;
    panRef.current = null;
  }, []);

  const onWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const scaleBy = 1.08;
    const stage = e.target.getStage();
    if (!stage) return;
    const oldScale = zoom;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const dir = e.evt.deltaY > 0 ? 1 / scaleBy : scaleBy;
    const next = Math.min(5, Math.max(0.5, oldScale * dir));
    const mousePointTo = {
      x: (pointer.x - pan.x) / oldScale,
      y: (pointer.y - pan.y) / oldScale,
    };
    setZoom(next);
    setPan({
      x: pointer.x - mousePointTo.x * next,
      y: pointer.y - mousePointTo.y * next,
    });
  }, [zoom, pan.x, pan.y]);

  const startMousePan = useCallback(
    (clientX: number, clientY: number) => {
      mousePanRef.current = {
        x: clientX,
        y: clientY,
        panX: pan.x,
        panY: pan.y,
      };
      setIsPanning(true);
    },
    [pan.x, pan.y]
  );

  /** Pan with middle mouse, right mouse, or Space + left mouse. */
  const onMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const btn = e.evt.button;
      const panGesture = btn === 1 || btn === 2 || (btn === 0 && spacePan);
      if (!panGesture) return;
      if (btn === 0 && spacePan) {
        e.evt.preventDefault();
      }
      if (btn === 1 || btn === 2) {
        e.evt.preventDefault();
      }
      startMousePan(e.evt.clientX, e.evt.clientY);
    },
    [spacePan, startMousePan]
  );

  const onMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!mousePanRef.current) return;
    e.evt.preventDefault();
    const dx = e.evt.clientX - mousePanRef.current.x;
    const dy = e.evt.clientY - mousePanRef.current.y;
    setPan({
      x: mousePanRef.current.panX + dx,
      y: mousePanRef.current.panY + dy,
    });
  }, []);

  const endMousePan = useCallback(() => {
    mousePanRef.current = null;
    setIsPanning(false);
  }, []);

  useEffect(() => {
    if (!isPanning) return;
    const onWindowMove = (e: MouseEvent) => {
      if (!mousePanRef.current) return;
      setPan({
        x: mousePanRef.current.panX + (e.clientX - mousePanRef.current.x),
        y: mousePanRef.current.panY + (e.clientY - mousePanRef.current.y),
      });
    };
    const onWindowUp = (e: MouseEvent) => {
      if (e.button === 0 || e.button === 1 || e.button === 2) endMousePan();
    };
    window.addEventListener("mousemove", onWindowMove);
    window.addEventListener("mouseup", onWindowUp);
    return () => {
      window.removeEventListener("mousemove", onWindowMove);
      window.removeEventListener("mouseup", onWindowUp);
    };
  }, [isPanning, endMousePan]);

  const onMouseUp = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.button === 0 || e.evt.button === 1 || e.evt.button === 2) {
        endMousePan();
      }
    },
    [endMousePan]
  );

  function pointerToContent(stage: Konva.Stage): { x: number; y: number } | null {
    const pos = stage.getPointerPosition();
    if (!pos) return null;
    return {
      x: (pos.x - pan.x) / zoom,
      y: (pos.y - pan.y) / zoom,
    };
  }

  return {
    zoom,
    pan,
    isPanning,
    spacePan,
    resetViewport,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onWheel,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    endMousePan,
    pointerToContent,
  };
}
