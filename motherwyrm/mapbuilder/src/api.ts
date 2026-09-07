import type { MapDocument } from "./types";
import { exportMap, serializeMap } from "./schema";

export type SaveResult = { ok: true; id: string; status: "draft" } | { ok: false; error: string };
export type PublishResult =
  | { ok: true; id: string; status: "published"; name: string }
  | { ok: false; error: string };

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string };
    if (typeof body.detail === "string") return body.detail;
  } catch {
    /* ignore */
  }
  return res.statusText || `HTTP ${res.status}`;
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
