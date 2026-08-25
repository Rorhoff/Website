import { createHash } from "node:crypto";
import { getStorage } from "@/lib/storage";
import type { RenderQuality } from "@/lib/render/types";

export function renderCacheKey(
  prompt: string,
  quality: RenderQuality,
  referenceImages: Buffer[]
): string {
  const h = createHash("sha256");
  h.update(prompt);
  h.update(quality);
  if (referenceImages.length) {
    h.update(Buffer.concat(referenceImages));
  }
  return h.digest("hex").slice(0, 16);
}

export function renderCacheFilename(cacheKey: string): string {
  return `render-cache-${cacheKey}.png`;
}

export async function getCachedRenderBuffer(
  projectId: string,
  cacheKey: string
): Promise<Buffer | null> {
  const storage = getStorage();
  const filename = renderCacheFilename(cacheKey);
  if (!(await storage.projectFileExists(projectId, filename))) {
    return null;
  }
  return storage.readProjectFile(projectId, filename);
}

export async function saveCachedRender(
  projectId: string,
  cacheKey: string,
  image: Buffer
): Promise<string> {
  const storage = getStorage();
  const filename = renderCacheFilename(cacheKey);
  await storage.saveProjectFile(projectId, filename, image);
  return filename;
}
