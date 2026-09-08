import type { MapDocument, MapSpriteSlot } from "./types";
import { exportMap, serializeMap } from "./schema";
import { spriteApiUrl } from "./sprites";

export type SaveResult = { ok: true; id: string; status: "draft" } | { ok: false; error: string };
export type PublishResult =
  | { ok: true; id: string; status: "published"; name: string }
  | { ok: false; error: string };

export type SpriteUploadResult =
  | { ok: true; slot: MapSpriteSlot; url: string }
  | { ok: false; error: string };

export type SpriteDeleteResult = { ok: true } | { ok: false; error: string };

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string };
    if (typeof body.detail === "string") return body.detail;
  } catch {
    /* ignore */
  }
  return res.statusText || `HTTP ${res.status}`;
}

export async function fetchMapDraft(id: string): Promise<MapDocument | null> {
  try {
    const res = await fetch(`/api/mw/maps/${encodeURIComponent(id.trim())}`);
    if (!res.ok) return null;
    return (await res.json()) as MapDocument;
  } catch {
    return null;
  }
}

export async function saveMapDraft(doc: MapDocument): Promise<SaveResult> {
  const body = exportMap(doc);
  try {
    const res = await fetch("/api/mw/maps/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: serializeMap(body),
    });
    if (!res.ok) return { ok: false, error: await readError(res) };
    const data = (await res.json()) as { id: string };
    return { ok: true, id: data.id, status: "draft" };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function publishMap(doc: MapDocument): Promise<PublishResult> {
  const body = exportMap(doc);
  const id = body.id.trim();
  if (!id) return { ok: false, error: "Map id is required before publishing." };
  try {
    const res = await fetch(`/api/mw/maps/${encodeURIComponent(id)}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: serializeMap(body),
    });
    if (!res.ok) return { ok: false, error: await readError(res) };
    const data = (await res.json()) as { id: string; name: string };
    return { ok: true, id: data.id, status: "published", name: data.name };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function uploadSprite(
  mapId: string,
  slot: MapSpriteSlot,
  file: File
): Promise<SpriteUploadResult> {
  const form = new FormData();
  form.append("file", file);
  try {
    const res = await fetch(
      `/api/mw/maps/${encodeURIComponent(mapId)}/sprites/${slot}`,
      { method: "POST", body: form }
    );
    if (!res.ok) return { ok: false, error: await readError(res) };
    const data = (await res.json()) as { url: string };
    return { ok: true, slot, url: data.url };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function deleteSprite(mapId: string, slot: MapSpriteSlot): Promise<SpriteDeleteResult> {
  try {
    const res = await fetch(
      `/api/mw/maps/${encodeURIComponent(mapId)}/sprites/${slot}`,
      { method: "DELETE" }
    );
    if (!res.ok) return { ok: false, error: await readError(res) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Upload pending sprite PNGs and merge server URLs into the map document. */
export async function flushPendingSprites(
  doc: MapDocument,
  pending: Partial<Record<MapSpriteSlot, File>>
): Promise<{ ok: true; doc: MapDocument } | { ok: false; error: string }> {
  const mapId = doc.id.trim();
  if (!mapId) return { ok: false, error: "Map id is required to save sprite art." };
  const sprites = { ...(doc.sprites ?? {}) };
  for (const [slot, file] of Object.entries(pending) as [MapSpriteSlot, File][]) {
    const result = await uploadSprite(mapId, slot, file);
    if (!result.ok) return result;
    sprites[slot] = result.url;
  }
  return { ok: true, doc: { ...doc, sprites } };
}
