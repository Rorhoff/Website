import { createHash } from "node:crypto";
import sharp from "sharp";
import { getPixelsPerFoot } from "@/lib/georef";
import { getGeorefDisplayContext } from "@/lib/georef-display";
import { generatePlanMaskPng } from "@/lib/plan-mask";
import { buildPlanRenderPrompt } from "@/lib/plan-render-prompt";
import { verifyPlanRenderRegistration } from "@/lib/plan-render-registration";
import {
  planMaskFilename,
  planRenderFilenames,
  type PlanRenderCacheEntry,
  type PlanRenderJob,
  PLAN_RENDER_PROMPT_VERSION,
} from "@/lib/plan-render-schema";
import { GeminiRenderProvider } from "@/lib/render/gemini";
import type { RenderQuality } from "@/lib/render/types";
import type { InterpretFeature } from "@/lib/interpret-schema";
import { getLegend, getStorage } from "@/lib/storage";
import type { Project } from "@/lib/project-schema";

const JOB_REL = "plan-render-job.json";
const PREVIEW_LONG_EDGE = 2000;

function planRenderCacheKey(
  cleanHash: string,
  featuresJson: string,
  quality: "draft" | "final"
): string {
  const h = createHash("sha256");
  h.update(String(PLAN_RENDER_PROMPT_VERSION));
  h.update(cleanHash);
  h.update(featuresJson);
  h.update(quality);
  return h.digest("hex").slice(0, 16);
}

async function hashFile(projectId: string, filename: string): Promise<string> {
  const buf = await getStorage().readProjectFile(projectId, filename);
  if (!buf) throw new Error(`Missing file ${filename}`);
  return createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

function featuresFingerprint(features: InterpretFeature[]): string {
  return JSON.stringify(
    features
      .filter((f) => !f.existing)
      .map((f) => ({
        id: f.id,
        t: f.featureType,
        g: f.geometry,
        w: f.widthFt,
        fr: f.fringeWidthIn,
        sm: f.smoothing,
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  );
}

export async function readPlanRenderJob(projectId: string): Promise<PlanRenderJob> {
  const raw = await getStorage().readProjectFile(projectId, JOB_REL);
  if (!raw) return { status: "idle", progress: 0 };
  return JSON.parse(raw.toString()) as PlanRenderJob;
}

async function writePlanRenderJob(projectId: string, job: PlanRenderJob): Promise<void> {
  await getStorage().saveProjectFile(
    projectId,
    JOB_REL,
    Buffer.from(JSON.stringify(job, null, 2))
  );
}

export function findPlanRenderEntry(
  project: Project,
  quality: RenderQuality = "draft"
): PlanRenderCacheEntry | undefined {
  return Object.values(project.planRenderCache ?? {}).find((e) => e.quality === quality);
}

export async function generatePlanMaskOnly(
  projectId: string
): Promise<{ maskFilename: string; colorMap: PlanRenderCacheEntry["colorMap"] }> {
  const storage = getStorage();
  const project = await storage.loadProject(projectId);
  if (!project) throw new Error("Project not found");
  const features = project.features ?? project.interpretation?.features ?? [];
  const clean = project.images.clean;
  if (!clean) throw new Error("Clean orthophoto required");
  if (features.length === 0) throw new Error("No features");

  const legend = await getLegend();
  const pixelsPerFoot = getPixelsPerFoot(project);
  const georefCtx = getGeorefDisplayContext(project, clean.width, clean.height);

  const mask = await generatePlanMaskPng(
    features,
    legend,
    clean.width,
    clean.height,
    pixelsPerFoot,
    georefCtx
  );

  const hash = createHash("sha256")
    .update(featuresFingerprint(features))
    .digest("hex")
    .slice(0, 16);
  const maskRel = planMaskFilename(hash);
  await storage.saveProjectFile(projectId, maskRel, mask.png);

  return { maskFilename: maskRel, colorMap: mask.colorMap };
}

export async function ensurePlanRenderCache(
  projectId: string,
  options?: { quality?: RenderQuality; force?: boolean }
): Promise<{ entry: PlanRenderCacheEntry; project: Project }> {
  const quality = options?.quality ?? "draft";
  const storage = getStorage();
  let project = await storage.loadProject(projectId);
  if (!project) throw new Error("Project not found");

  const features = project.features ?? project.interpretation?.features ?? [];
  if (features.length === 0) throw new Error("No features to render");

  const clean = project.images.clean;
  if (!clean) throw new Error("Clean orthophoto required for plan render");

  const cleanHash = await hashFile(projectId, clean.filename);
  const fp = featuresFingerprint(features);
  const hash = planRenderCacheKey(cleanHash, fp, quality);

  const existing = project.planRenderCache?.[hash];
  if (existing && !options?.force) {
    return { entry: existing, project };
  }

  await writePlanRenderJob(projectId, {
    status: "running",
    progress: 10,
    step: "Building mask",
  });

  const legend = await getLegend();
  const pixelsPerFoot = getPixelsPerFoot(project);
  const georefCtx = getGeorefDisplayContext(project, clean.width, clean.height);
  const cleanBuf = await storage.readProjectFile(projectId, clean.filename);
  if (!cleanBuf) throw new Error("Clean orthophoto file missing");

  const mask = await generatePlanMaskPng(
    features,
    legend,
    clean.width,
    clean.height,
    pixelsPerFoot,
    georefCtx
  );

  const maskRel = planMaskFilename(hash);
  await storage.saveProjectFile(projectId, maskRel, mask.png);

  await writePlanRenderJob(projectId, {
    status: "running",
    progress: 35,
    step: "Calling image model",
  });

  const prompt = buildPlanRenderPrompt(
    features,
    legend,
    clean.width,
    clean.height,
    pixelsPerFoot,
    georefCtx
  );

  const provider = new GeminiRenderProvider(quality);
  const aspect = clean.width >= clean.height ? "4:3" : "3:4";
  const result = await provider.generate({
    prompt,
    referenceImages: [mask.png, cleanBuf],
    aspectRatio: aspect,
    resolution: quality === "final" ? "4K" : "2K",
  });

  await writePlanRenderJob(projectId, {
    status: "running",
    progress: 75,
    step: "Verifying registration",
  });

  let outImage = result.image;
  const outMeta = await sharp(outImage).metadata();
  if (outMeta.width !== clean.width || outMeta.height !== clean.height) {
    outImage = await sharp(outImage)
      .resize(clean.width, clean.height, { fit: "fill" })
      .png()
      .toBuffer();
  }

  const reg = await verifyPlanRenderRegistration(
    cleanBuf,
    outImage,
    clean.width,
    clean.height
  );

  const renderRel = planRenderFilenames(hash, false);
  const previewRel = planRenderFilenames(hash, true);
  const preview = await sharp(outImage)
    .resize({
      width: clean.width >= clean.height ? PREVIEW_LONG_EDGE : undefined,
      height: clean.height > clean.width ? PREVIEW_LONG_EDGE : undefined,
      fit: "inside",
    })
    .png()
    .toBuffer();
  await storage.saveProjectFile(projectId, renderRel, outImage);
  await storage.saveProjectFile(projectId, previewRel, preview);

  const entry: PlanRenderCacheEntry = {
    hash,
    maskFilename: maskRel,
    renderFilename: renderRel,
    previewFilename: previewRel,
    colorMap: mask.colorMap,
    registrationDisplacementPct: reg.meanDisplacementPct,
    registrationPassed: reg.passed,
    quality,
    generatedAt: new Date().toISOString(),
    model: quality === "final" ? "gemini-final" : "gemini-draft",
  };

  project = {
    ...project,
    updatedAt: new Date().toISOString(),
    planRenderCache: {
      ...(project.planRenderCache ?? {}),
      [hash]: entry,
    },
    planSettings: {
      baseMode: reg.passed ? "ai_render" : (project.planSettings?.baseMode ?? "orthophoto"),
      basePreset: project.planSettings?.basePreset ?? "off",
      orthophotoOpacity: project.planSettings?.orthophotoOpacity ?? 0.4,
      showFeatureOutlines: project.planSettings?.showFeatureOutlines ?? true,
      showContours: project.planSettings?.showContours ?? false,
      showDrainageArrows: project.planSettings?.showDrainageArrows ?? false,
      contourMinorFt: project.planSettings?.contourMinorFt ?? 1,
      contourMajorFt: project.planSettings?.contourMajorFt ?? 5,
      watercolorParamOverrides: project.planSettings?.watercolorParamOverrides,
    },
  };
  await storage.saveProject(project);

  await writePlanRenderJob(projectId, {
    status: "complete",
    progress: 100,
    step: reg.details,
  });

  return { entry, project };
}

const running = new Map<string, Promise<void>>();

export async function startPlanRenderJob(
  projectId: string,
  options?: { quality?: RenderQuality; force?: boolean }
): Promise<PlanRenderJob> {
  const key = `${projectId}:${options?.quality ?? "draft"}`;
  if (!running.has(key)) {
    const p = ensurePlanRenderCache(projectId, options)
      .then(() => {
        running.delete(key);
      })
      .catch(async (e) => {
        running.delete(key);
        await writePlanRenderJob(projectId, {
          status: "error",
          progress: 0,
          error: e instanceof Error ? e.message : "Plan render failed",
        });
      });
    running.set(key, p);
  }
  return { status: "running", progress: 5, step: "Starting…" };
}

export { PLAN_RENDER_PROMPT_VERSION, planRenderCacheKey };
