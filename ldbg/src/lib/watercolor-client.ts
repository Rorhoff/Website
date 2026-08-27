import { projectImageUrl } from "@/lib/image-utils";
import type { WatercolorJob } from "@/lib/watercolor-schema";

export type WatercolorPollResult = {
  job: WatercolorJob;
  cacheReady: boolean;
  entry?: { previewFilename: string; fullFilename?: string; hash?: string };
  cacheHash?: string;
};

/** Probe image URL and log status — used to debug derived/ read path. */
export async function probeProjectImageUrl(
  url: string,
  label = "watercolor preview"
): Promise<{ url: string; status: number; ok: boolean }> {
  try {
    let res = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { method: "GET", cache: "no-store" });
    }
    console.info(`[ldbg ${label}] ${url} → HTTP ${res.status}`);
    return { url, status: res.status, ok: res.ok };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[ldbg ${label}] ${url} → fetch failed: ${msg}`);
    return { url, status: 0, ok: false };
  }
}

/** Build preview URL from API entry and verify the file is reachable. */
export async function resolveWatercolorPreviewUrl(
  projectId: string,
  entry: { previewFilename: string } | undefined,
  cacheReady: boolean
): Promise<string | undefined> {
  if (!cacheReady || !entry?.previewFilename) return undefined;
  const url = projectImageUrl(projectId, entry.previewFilename);
  const probe = await probeProjectImageUrl(url);
  return probe.ok ? url : undefined;
}

export function formatWatercolorJobStatus(
  job: WatercolorJob | null,
  previewReady: boolean
): string | null {
  if (previewReady) return "Watercolor ready";
  if (!job || job.status === "idle") return "Queued — starting watercolor…";
  if (job.status === "running") {
    const pct = job.progress ?? 0;
    return job.step ? `${pct}% — ${job.step}` : `${pct}%`;
  }
  if (job.status === "complete") return "Complete — loading preview…";
  return null;
}
