import type { MapDocument, MapSpriteSlot } from "./types";
import { DEFAULT_SHEET_FRAMES, type SheetFrame } from "./sprite-frames";

export type SpriteDrawSpec =
  | { kind: "image"; url: string }
  | { kind: "sheet"; url: string; frame: SheetFrame };

/** Built-in game art sheets when no custom PNG is uploaded for a slot. */
export const DEFAULT_SPRITE_PATHS: Record<MapSpriteSlot, string> = {
  mother_blue_idle: "/mw/assets/mother_blue.png",
  mother_blue_fly: "/mw/assets/mother_blue_fly.png",
  mother_blue_dive: "/mw/assets/mother_blue.png",
  mother_blue_claw: "/mw/assets/mother_blue.png",
  mother_red_idle: "/mw/assets/mother_red.png",
  mother_red_fly: "/mw/assets/mother_red_fly.png",
  mother_red_dive: "/mw/assets/mother_red.png",
  mother_red_claw: "/mw/assets/mother_red.png",
  whelp_blue: "/mw/assets/whelp_blue.png",
  whelp_red: "/mw/assets/whelp_red.png",
  wyrm: "/mw/assets/wyrm.png",
  background: "",
};

export const SPRITE_SLOTS: MapSpriteSlot[] = [
  "mother_blue_idle",
  "mother_blue_fly",
  "mother_blue_dive",
  "mother_blue_claw",
  "mother_red_idle",
  "mother_red_fly",
  "mother_red_dive",
  "mother_red_claw",
  "whelp_blue",
  "whelp_red",
  "wyrm",
  "background",
];

export const SPRITE_LABELS: Record<MapSpriteSlot, string> = {
  mother_blue_idle: "Idle",
  mother_blue_fly: "Fly",
  mother_blue_dive: "Dive",
  mother_blue_claw: "Claw",
  mother_red_idle: "Idle",
  mother_red_fly: "Fly",
  mother_red_dive: "Dive",
  mother_red_claw: "Claw",
  whelp_blue: "Wyrm (blue)",
  whelp_red: "Wyrm (red)",
  wyrm: "Cow",
  background: "Background scenery",
};

export const SPRITE_GROUPS: Array<{ title: string; slots: MapSpriteSlot[] }> = [
  { title: "Scenery", slots: ["background"] },
  { title: "Mother (blue)", slots: ["mother_blue_idle", "mother_blue_fly", "mother_blue_dive", "mother_blue_claw"] },
  { title: "Mother (red)", slots: ["mother_red_idle", "mother_red_fly", "mother_red_dive", "mother_red_claw"] },
  { title: "Wyrms", slots: ["whelp_blue", "whelp_red"] },
  { title: "Cow", slots: ["wyrm"] },
];

/** Which mother frame to show at the main spawn marker. */
export const MOTHER_PREVIEW_SLOT: Record<"blue" | "red", MapSpriteSlot> = {
  blue: "mother_blue_idle",
  red: "mother_red_idle",
};

const cache = new Map<string, HTMLImageElement>();
const loading = new Set<string>();

export function spriteApiUrl(mapId: string, slot: MapSpriteSlot): string {
  return `/api/mw/maps/${encodeURIComponent(mapId)}/sprites/${slot}.png`;
}

export function resolveSpriteDrawSpec(
  doc: MapDocument,
  slot: MapSpriteSlot,
  blobOverrides?: Partial<Record<MapSpriteSlot, string>>
): SpriteDrawSpec {
  const custom = blobOverrides?.[slot] ?? doc.sprites?.[slot];
  if (custom) return { kind: "image", url: custom };
  if (slot === "background") return { kind: "image", url: "" };
  const frame = DEFAULT_SHEET_FRAMES[slot];
  if (frame) return { kind: "sheet", url: frame.sheet, frame };
  return { kind: "image", url: DEFAULT_SPRITE_PATHS[slot] };
}

export function resolveSpriteUrl(
  doc: MapDocument,
  slot: MapSpriteSlot,
  blobOverrides?: Partial<Record<MapSpriteSlot, string>>
): string {
  return resolveSpriteDrawSpec(doc, slot, blobOverrides).url;
}

function cacheKey(spec: SpriteDrawSpec): string {
  if (spec.kind === "image") return spec.url;
  const f = spec.frame;
  return `${spec.url}#${f.x},${f.y},${f.w},${f.h}`;
}

export function getCachedSprite(spec: SpriteDrawSpec): HTMLImageElement | undefined {
  return cache.get(cacheKey(spec));
}

export function ensureSpriteLoaded(spec: SpriteDrawSpec, onReady: () => void): HTMLImageElement | undefined {
  if (!spec.url) return undefined;
  const key = cacheKey(spec);
  const hit = cache.get(key);
  if (hit) return hit;
  if (loading.has(key)) return undefined;
  loading.add(key);
  const img = new Image();
  img.onload = () => {
    cache.set(key, img);
    loading.delete(key);
    onReady();
  };
  img.onerror = () => loading.delete(key);
  img.src = spec.url;
  return undefined;
}

export function preloadMapSprites(
  doc: MapDocument,
  onReady: () => void,
  blobOverrides?: Partial<Record<MapSpriteSlot, string>>
): void {
  for (const slot of SPRITE_SLOTS) {
    ensureSpriteLoaded(resolveSpriteDrawSpec(doc, slot, blobOverrides), onReady);
  }
}

/** Draw sprite with feet anchored at (x, y). */
export function drawSpriteAtFeet(
  ctx: CanvasRenderingContext2D,
  spec: SpriteDrawSpec,
  img: HTMLImageElement,
  x: number,
  y: number,
  targetH = 48
): void {
  let sw = img.width;
  let sh = img.height;
  let sx = 0;
  let sy = 0;
  if (spec.kind === "sheet") {
    sx = spec.frame.x;
    sy = spec.frame.y;
    sw = spec.frame.w;
    sh = spec.frame.h;
  }
  const scale = targetH / sh;
  const w = sw * scale;
  const h = sh * scale;
  ctx.drawImage(img, sx, sy, sw, sh, x - w / 2, y - h, w, h);
}

export function invalidateSpriteCache(url?: string): void {
  if (!url) {
    cache.clear();
    return;
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(url)) cache.delete(key);
  }
}
