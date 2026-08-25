"use client";

import { useEffect, useMemo, useState } from "react";
import { Image as KonvaImage } from "react-konva";
import type { TilePyramid } from "@/lib/tile-pyramid-schema";
import {
  pixelsPerTileAtZoom,
  pickTileZoom,
  tileIndicesForViewport,
} from "@/lib/tile-pyramid-schema";
import { tileUrl } from "@/lib/tile-pyramid-utils";

type Props = {
  projectId: string;
  pyramid: TilePyramid;
  editorWidth: number;
  editorHeight: number;
  fullWidth: number;
  fullHeight: number;
  displayW: number;
  displayH: number;
};

function useTileImages(urls: string[]) {
  const key = urls.join("|");
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const loaded = new Map<string, HTMLImageElement>();
    if (!urls.length) {
      setImages(new Map());
      return;
    }

    void Promise.all(
      urls.map(
        (url) =>
          new Promise<void>((resolve) => {
            const img = new window.Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
              loaded.set(url, img);
              resolve();
            };
            img.onerror = () => resolve();
            img.src = url;
          })
      )
    ).then(() => {
      if (!cancelled) setImages(new Map(loaded));
    });

    return () => {
      cancelled = true;
    };
  }, [key, urls]);

  return images;
}

export function TiledOrthoBackground({
  projectId,
  pyramid,
  editorWidth,
  editorHeight,
  fullWidth,
  fullHeight,
  displayW,
  displayH: _displayH,
}: Props) {
  void _displayH;
  void fullHeight;

  const scaleFullToEditor = editorWidth / fullWidth;
  const displayScale = displayW / editorWidth;
  const fullDisplayW = displayW / scaleFullToEditor;

  const zoom = pickTileZoom(pyramid, fullWidth, fullDisplayW);
  const ppt = pixelsPerTileAtZoom(pyramid, zoom);

  const viewFullW = editorWidth / scaleFullToEditor;
  const viewFullH = editorHeight / scaleFullToEditor;

  const tiles = useMemo(
    () =>
      tileIndicesForViewport(pyramid, zoom, 0, 0, viewFullW, viewFullH).map(
        ({ x, y }) => ({
          x,
          y,
          url: tileUrl(projectId, pyramid, zoom, x, y),
        })
      ),
    [pyramid, projectId, zoom, viewFullW, viewFullH]
  );

  const images = useTileImages(tiles.map((t) => t.url));

  return (
    <>
      {tiles.map(({ x, y, url }) => {
        const img = images.get(url);
        if (!img) return null;

        const srcX = x * ppt;
        const srcY = y * ppt;
        const editorX = srcX * scaleFullToEditor;
        const editorY = srcY * scaleFullToEditor;
        const tileEditorSize = ppt * scaleFullToEditor;
        const konvaX = editorX * displayScale;
        const konvaY = editorY * displayScale;
        const konvaSize = tileEditorSize * displayScale;

        return (
          <KonvaImage
            key={`${zoom}-${x}-${y}`}
            image={img}
            x={konvaX}
            y={konvaY}
            width={konvaSize}
            height={konvaSize}
            listening={false}
          />
        );
      })}
    </>
  );
}
