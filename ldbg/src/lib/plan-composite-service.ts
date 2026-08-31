import { createHash } from "node:crypto";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import type { Project } from "@/lib/project-schema";
import { getStorage } from "@/lib/storage";

/** Stage 3 — raster composite: clean orthophoto + filled feature crops at crop boxes. */
export async function buildPlanCompositePng(
  projectId: string,
  project: Project
): Promise<{ buffer: Buffer; width: number; height: number; hash: string }> {
  const clean = project.images.clean;
  if (!clean) throw new Error("Clean orthophoto required for composite");

  const storage = getStorage();
  const cleanBuf = await storage.readProjectFile(projectId, clean.filename);
  if (!cleanBuf) throw new Error("Clean orthophoto file missing");

  const meta = await sharp(cleanBuf).metadata();
  const width = meta.width ?? clean.width;
  const height = meta.height ?? clean.height;

  const overlays: sharp.OverlayOptions[] = [];
  const fillParts: unknown[] = [];

  for (const [featureId, entry] of Object.entries(project.featureFills ?? {})) {
    if (entry.status !== "filled" || !entry.imageFilename || !entry.cropBox) continue;
    const fillBuf = await storage.readProjectFile(projectId, entry.imageFilename);
    if (!fillBuf) continue;
    const box = entry.cropBox;
    overlays.push({
      input: fillBuf,
      left: Math.max(0, Math.round(box.x)),
      top: Math.max(0, Math.round(box.y)),
    });
    fillParts.push({ featureId, hash: entry.hash, box });
  }

  fillParts.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const hash = createHash("sha256")
    .update(JSON.stringify({ w: width, h: height, clean: clean.filename, fills: fillParts }))
    .digest("hex")
    .slice(0, 16);

  const buffer =
    overlays.length > 0
      ? await sharp(cleanBuf).composite(overlays).png().toBuffer()
      : await sharp(cleanBuf).png().toBuffer();

  return { buffer, width, height, hash };
}

/** Cached composite PNG URL for board schematic side panel. */
export async function resolvePlanSchematicFilename(
  projectId: string,
  project: Project
): Promise<string | undefined> {
  if (!project.images.clean) return undefined;
  try {
    const { buffer, hash } = await buildPlanCompositePng(projectId, project);
    const existing = await readCompositeCache(projectId, hash);
    if (!existing) {
      await saveCompositeCache(projectId, hash, buffer);
    }
    return `derived/composite-${hash}.png`;
  } catch {
    return undefined;
  }
}

export async function saveCompositeCache(
  projectId: string,
  hash: string,
  buffer: Buffer
): Promise<string> {
  const rel = `derived/composite-${hash}.png`;
  const storage = getStorage();
  await storage.saveProjectFile(projectId, rel, buffer);
  return rel;
}

export async function readCompositeCache(
  projectId: string,
  hash: string
): Promise<Buffer | null> {
  const rel = `derived/composite-${hash}.png`;
  return getStorage().readProjectFile(projectId, rel);
}
