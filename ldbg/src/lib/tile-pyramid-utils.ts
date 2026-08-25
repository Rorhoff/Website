import { withBasePath } from "@/lib/paths";
import type { TilePyramid } from "@/lib/tile-pyramid-schema";
import { pickTileZoom } from "@/lib/tile-pyramid-schema";

export function tileUrl(
  projectId: string,
  pyramid: TilePyramid,
  z: number,
  x: number,
  y: number
): string {
  return withBasePath(
    `/api/projects/${projectId}/tiles/${z}/${x}/${y}.jpg`
  );
}

export function useTilePyramid(
  pyramid: TilePyramid | undefined,
  fullWidth: number,
  displayWidth: number
): { pyramid: TilePyramid; zoom: number } | undefined {
  if (!pyramid) return undefined;
  return {
    pyramid,
    zoom: pickTileZoom(pyramid, fullWidth, displayWidth),
  };
}
