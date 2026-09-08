import type { MapDocument, MapSpriteSlot } from "./types";

/** Built-in game art used when a map has no custom upload for that slot. */
export const DEFAULT_SPRITE_PATHS: Record<MapSpriteSlot, string> = {
  mother_blue: "/mw/assets/mother_blue.png",
  mother_red: "/mw/assets/mother_red.png",
  whelp_blue: "/mw/assets/whelp_blue.png",
  whelp_red: "/mw/assets/whelp_red.png",
  wyrm: "/mw/assets/wyrm.png",
};

export const SPRITE_SLOTS: MapSpriteSlot[] = [
  "mother_blue",
  "mother_red",
  "whelp_blue",
  "whelp_red",
  "wyrm",
];

export const SPRITE_LABELS: Record<MapSpriteSlot, string> = {
  mother_blue: "Mother (blue)",
  mother_red: "Mother (red)",
  whelp_blue: "Whelp (blue)",
  whelp_red: "Whelp (red)",
  wyrm: "Wyrm (cow)",
};

const cache = new Map<string, HTMLImageElement>();
const loading = new Set<string>();

export function spriteApiUrl(mapId: string, slot: MapSpriteSlot): string {
  return `/api/mw/maps/${encodeURIComponent(mapId)}/sprites/${slot}.png`;
}

export function resolveSpriteUrl(doc: MapDocument, slot: MapSpriteSlot, blobOverrides?: Partial<Record<MapSpriteSlot, string>>): string {
  if (blobOverrides?.[slot]) return blobOverrides[slot]!;
  if (doc.sprites?.[slot]) return doc.sprites[slot]!;
  return DEFAULT_SPRITE_PATHS[slot];
}

export function getCachedSprite(url: string): HTMLImageElement | undefined {
  return cache.get(url);
}

/** Load a PNG into the cache; calls onReady when drawn art is available. */
export function ensureSpriteLoaded(url: string, onReady: () => void): HTMLImageElement | undefined {
  const hit = cache.get(url);
  if (hit) return hit;
  if (loading.has(url)) return undefined;
  loading.add(url);
  const img = new Image();
  img.onload = () => {
    cache.set(url, img);
    loading.delete(url);
    onReady();
  };
  img.onerror = () => {
    loading.delete(url);
  };
  img.src = url;
  return undefined;
}

export function preloadMapSprites(
  doc: MapDocument,
  onReady: () => void,
  blobOverrides?: Partial<Record<MapSpriteSlot, string>>
): void {
  for (const slot of SPRITE_SLOTS) {
    ensureSpriteLoaded(resolveSpriteUrl(doc, slot, blobOverrides), onReady);
  }
}

/** Draw sprite with feet anchored at (x, y). */
export function drawSpriteAtFeet(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  targetH = 48
): void {
  const scale = targetH / img.height;
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, x - w / 2, y - h, w, h);
}

export function invalidateSpriteCache(url?: string): void {
  if (url) cache.delete(url);
  else cache.clear();
}
