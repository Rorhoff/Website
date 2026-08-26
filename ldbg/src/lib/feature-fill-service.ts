import { createHash } from "node:crypto";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { DEFAULT_WATERCOLOR_PRESET, resolveWatercolorParams } from "@/config/watercolor";
import type { LegendEntry } from "@/config/legend";
import {
  computeFeatureCropBox,
  cropFeatureFromImage,
  upscaleCropLongEdge,
  type FeatureCropBox,
} from "@/lib/feature-crop";
import { buildFeatureFillPrompt } from "@/lib/feature-fill-prompt";
import {
  FEATURE_FILL_PROMPT_VERSION,
  featureCropPreviewFilename,
  featureFillImageFilename,
  type FeatureFillEntry,
} from "@/lib/feature-fill-schema";
import { getPixelsPerFoot } from "@/lib/georef";
import { getGeorefDisplayContext } from "@/lib/georef-display";
import type { InterpretFeature } from "@/lib/interpret-schema";
import { runPythonScript } from "@/lib/run-python";
import { GeminiRenderProvider } from "@/lib/render/gemini";
import { getLegend, getStorage } from "@/lib/storage";
import type { Project } from "@/lib/project-schema";

function storageRoot(): string {
  return process.env.LDBG_STORAGE_DIR ?? path.join(process.cwd(), "storage");
}

function projectDir(projectId: string): string {
  return path.join(storageRoot(), projectId);
}

function featuresForProject(project: Project): InterpretFeature[] {
  return project.features?.length
    ? project.features
    : project.interpretation?.features ?? [];
}

function fillHash(
  feature: InterpretFeature,
  prompt: string,
  cropBox: FeatureCropBox
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        v: FEATURE_FILL_PROMPT_VERSION,
        id: feature.id,
        g: feature.geometry,
        w: feature.widthFt,
        t: feature.featureType,
        n: feature.notes,
        p: prompt,
        b: cropBox,
      })
    )
    .digest("hex")
    .slice(0, 16);
}

async function assertFillImageValid(buf: Buffer): Promise<void> {
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height || meta.width < 8 || meta.height < 8) {
    throw new Error("Model returned an empty or invalid image");
  }
  const stats = await sharp(buf).stats();
  const avg = stats.channels.reduce((s, c) => s + c.mean, 0) / stats.channels.length;
  if (avg < 2) throw new Error("Model returned a nearly blank image");
}

async function applyTextureSteps(cropPath: string, outPath: string): Promise<void> {
  const params = resolveWatercolorParams(DEFAULT_WATERCOLOR_PRESET);
  if (!params) return;
  const paramsPath = path.join(path.dirname(outPath), `_tex-params-${path.basename(outPath)}.json`);
  await fs.writeFile(paramsPath, JSON.stringify(params, null, 2), "utf8");
  const paper = path.join(process.cwd(), "public", "textures", "paper-cold-press.jpg");
  const args = [
    cropPath,
    "--params-json",
    paramsPath,
    "--out-full",
    outPath,
    "--texture-only",
  ];
  if (await fs.stat(paper).then(() => true).catch(() => false)) {
    args.push("--paper-texture", paper);
  }
  const script = path.join(process.cwd(), "scripts", "watercolor.py");
  const { code, stderr, stdout } = await runPythonScript(script, args, { timeoutMs: 120_000 });
  if (code !== 0) {
    throw new Error(`Texture pass failed: ${stderr || stdout}`.slice(0, 400));
  }
}

export async function previewFeatureCrop(
  projectId: string,
  featureId: string
): Promise<{ entry: FeatureFillEntry; cropPreviewFilename: string; cropBox: FeatureCropBox }> {
  const storage = getStorage();
  const project = await storage.loadProject(projectId);
  if (!project) throw new Error("Project not found");
  const clean = project.images.clean;
  if (!clean) throw new Error("Clean orthophoto required");

  const features = featuresForProject(project);
  const feature = features.find((f) => f.id === featureId);
  if (!feature || feature.existing) throw new Error("Feature not found");

  const georefCtx = getGeorefDisplayContext(project, clean.width, clean.height);
  const cropBox = computeFeatureCropBox(feature, clean.width, clean.height, georefCtx);
  const cleanBuf = await storage.readProjectFile(projectId, clean.filename);
  if (!cleanBuf) throw new Error("Clean orthophoto file missing");

  const cropBuf = await cropFeatureFromImage(cleanBuf, cropBox);
  const previewName = featureCropPreviewFilename(featureId);
  await storage.saveProjectFile(projectId, previewName, cropBuf);

  const entry: FeatureFillEntry = {
    featureId,
    status: "none",
    cropPreviewFilename: previewName,
    cropBox,
  };

  const updated = {
    ...project,
    updatedAt: new Date().toISOString(),
    featureFills: {
      ...(project.featureFills ?? {}),
      [featureId]: entry,
    },
  };
  await storage.saveProject(updated);

  return { entry, cropPreviewFilename: previewName, cropBox };
}

export async function fillFeature(
  projectId: string,
  featureId: string,
  options?: { force?: boolean; quality?: "draft" | "final" }
): Promise<{ entry: FeatureFillEntry; project: Project }> {
  const storage = getStorage();
  let project = await storage.loadProject(projectId);
  if (!project) throw new Error("Project not found");
  const clean = project.images.clean;
  if (!clean) throw new Error("Clean orthophoto required");

  const legend = await getLegend();
  const features = featuresForProject(project);
  const feature = features.find((f) => f.id === featureId);
  if (!feature || feature.existing) throw new Error("Feature not found");

  const pixelsPerFoot = getPixelsPerFoot(project);
  const georefCtx = getGeorefDisplayContext(project, clean.width, clean.height);
  const cropBox =
    project.featureFills?.[featureId]?.cropBox ??
    computeFeatureCropBox(feature, clean.width, clean.height, georefCtx);
  const prompt = buildFeatureFillPrompt(
    feature,
    legend,
    clean.width,
    clean.height,
    pixelsPerFoot,
    georefCtx
  );
  const hash = fillHash(feature, prompt, cropBox);

  const existing = project.featureFills?.[featureId];
  if (existing?.status === "filled" && existing.hash === hash && !options?.force) {
    return { entry: existing, project };
  }

  project = {
    ...project,
    updatedAt: new Date().toISOString(),
    featureFills: {
      ...(project.featureFills ?? {}),
      [featureId]: {
        featureId,
        status: "generating",
        cropBox,
        prompt,
        hash,
      },
    },
  };
  await storage.saveProject(project);

  const cleanBuf = await storage.readProjectFile(projectId, clean.filename);
  if (!cleanBuf) throw new Error("Clean orthophoto file missing");
  const cropBuf = await cropFeatureFromImage(cleanBuf, cropBox);
  const upscaled = await upscaleCropLongEdge(cropBuf, 1024);

  const provider = new GeminiRenderProvider(options?.quality ?? "draft");
  const aspect =
    cropBox.width >= cropBox.height ? ("4:3" as const) : ("3:4" as const);
  const result = await provider.generate({
    prompt,
    referenceImages: [upscaled],
    aspectRatio: aspect,
    resolution: options?.quality === "final" ? "2K" : "1K",
  });

  await assertFillImageValid(result.image);

  const resized = await sharp(result.image)
    .resize(Math.round(cropBox.width), Math.round(cropBox.height), { fit: "fill" })
    .png()
    .toBuffer();

  const meta = await sharp(resized).metadata();
  const aspectOk =
    meta.width &&
    meta.height &&
    Math.abs(meta.width / meta.height - cropBox.width / cropBox.height) < 0.35;
  if (!aspectOk) {
    throw new Error("Model returned unexpected aspect ratio");
  }

  const tmpIn = path.join(projectDir(projectId), `_fill-raw-${featureId}.png`);
  const tmpOut = path.join(projectDir(projectId), `_fill-tex-${featureId}.png`);
  await fs.writeFile(tmpIn, resized);
  try {
    await applyTextureSteps(tmpIn, tmpOut);
  } catch {
    await fs.copyFile(tmpIn, tmpOut);
  }
  const finalBuf = await fs.readFile(tmpOut);
  await fs.unlink(tmpIn).catch(() => {});
  await fs.unlink(tmpOut).catch(() => {});

  const imageFilename = featureFillImageFilename(featureId, hash);
  await storage.saveProjectFile(projectId, imageFilename, finalBuf);

  const entry: FeatureFillEntry = {
    featureId,
    status: "filled",
    imageFilename,
    cropPreviewFilename: featureCropPreviewFilename(featureId),
    cropBox,
    prompt,
    hash,
    generatedAt: new Date().toISOString(),
  };

  project = await storage.loadProject(projectId);
  if (!project) throw new Error("Project not found");
  project = {
    ...project,
    updatedAt: new Date().toISOString(),
    featureFills: {
      ...(project.featureFills ?? {}),
      [featureId]: entry,
    },
    featureFillTotalCostUsd: (project.featureFillTotalCostUsd ?? 0) + 0.05,
  };
  await storage.saveProject(project);

  return { entry, project };
}

export async function fillAllEmptyFeatures(
  projectId: string
): Promise<{ queued: string[] }> {
  const storage = getStorage();
  const project = await storage.loadProject(projectId);
  if (!project) throw new Error("Project not found");
  const features = featuresForProject(project).filter(
    (f) =>
      !f.existing &&
      f.featureType !== "property_boundary" &&
      (project.featureFills?.[f.id]?.status !== "filled")
  );
  for (const f of features) {
    try {
      await fillFeature(projectId, f.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Fill failed";
      const cur = await storage.loadProject(projectId);
      if (cur) {
        await storage.saveProject({
          ...cur,
          featureFills: {
            ...(cur.featureFills ?? {}),
            [f.id]: {
              featureId: f.id,
              status: "failed",
              error: msg,
            },
          },
        });
      }
    }
  }
  return { queued: features.map((f) => f.id) };
}
