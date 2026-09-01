import { createHash } from "node:crypto";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import {
  buildStylePassPrompt,
  presetUsesStylePass,
  type StylePresetId,
} from "@/config/styles";
import {
  buildPlanCompositePng,
  saveCompositeCache,
} from "@/lib/plan-composite-service";
import { GeminiRenderProvider } from "@/lib/render/gemini";
import { getPythonCommand, runPythonScript } from "@/lib/run-python";
import type { Project } from "@/lib/project-schema";
import { getStorage } from "@/lib/storage";
import {
  RegistrationResultSchema,
  StylePassCacheEntrySchema,
  StylePassJobSchema,
  stylePassFilenames,
  type RegistrationResult,
  type StylePassCacheEntry,
  type StylePassJob,
} from "@/lib/style-pass-schema";

const JOB_FILENAME = "derived/style-pass-job.json";
const runningJobs = new Map<string, Promise<void>>();

function projectDir(projectId: string): string {
  const root = process.env.LDBG_STORAGE_DIR ?? path.join(process.cwd(), "storage");
  return path.join(root, projectId);
}

function styleCacheKey(compositeHash: string, preset: StylePresetId): string {
  return createHash("sha256").update(`${compositeHash}:${preset}`).digest("hex").slice(0, 16);
}

export async function readStylePassJob(projectId: string): Promise<StylePassJob> {
  const jobPath = path.join(projectDir(projectId), JOB_FILENAME);
  try {
    const raw = JSON.parse(await fs.readFile(jobPath, "utf8")) as unknown;
    return StylePassJobSchema.parse(raw);
  } catch {
    return { status: "idle", progress: 0 };
  }
}

async function writeStylePassJob(projectId: string, job: StylePassJob): Promise<void> {
  const jobPath = path.join(projectDir(projectId), JOB_FILENAME);
  await fs.mkdir(path.dirname(jobPath), { recursive: true });
  await fs.writeFile(jobPath, JSON.stringify(job, null, 2), "utf8");
}

export function getStylePassCacheEntry(
  project: Project,
  preset: StylePresetId,
  hash: string
): StylePassCacheEntry | undefined {
  return project.stylePassCache?.[`${preset}:${hash}`];
}

async function loadReferenceImages(preset: StylePresetId): Promise<Buffer[]> {
  const refs = (await import("@/config/styles")).stylePresetReferencePaths(preset);
  const bufs: Buffer[] = [];
  for (const rel of refs) {
    const abs = path.join(process.cwd(), "public", rel.replace(/^\//, ""));
    try {
      bufs.push(await fs.readFile(abs));
    } catch {
      /* optional refs */
    }
  }
  return bufs;
}

async function runRegistration(
  compositeAbs: string,
  styledAbs: string,
  outAbs: string,
  imageWidth: number
): Promise<RegistrationResult> {
  const script = path.join(process.cwd(), "scripts", "register_style.py");
  let pythonCommand = getPythonCommand();
  let stdout = "";
  let code = 1;
  try {
    ({ stdout, code, pythonCommand } = await runPythonScript(
      script,
      [compositeAbs, styledAbs, "--out", outAbs, "--width", String(imageWidth)],
      { timeoutMs: 120_000 }
    ));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Registration subprocess failed";
    return RegistrationResultSchema.parse({
      inlierCount: 0,
      residualPct: 100,
      passed: false,
      labelMode: "failed",
      error: `${msg} (interpreter: ${pythonCommand})`,
    });
  }
  const line = stdout.trim().split("\n").pop() ?? "{}";
  const parsed = JSON.parse(line) as Record<string, unknown>;
  if (code !== 0 || parsed.error) {
    const regErr = String(parsed.error ?? "Registration failed");
    return RegistrationResultSchema.parse({
      inlierCount: 0,
      residualPct: 100,
      passed: false,
      labelMode: "failed",
      error: `${regErr} (interpreter: ${pythonCommand})`,
    });
  }
  return RegistrationResultSchema.parse({
    inlierCount: parsed.inlierCount ?? 0,
    residualPct: parsed.residualPct ?? 100,
    passed: parsed.passed ?? false,
    labelMode: parsed.labelMode ?? "failed",
  });
}

export async function runStylePassForProject(
  projectId: string,
  preset: StylePresetId,
  options?: { quality?: "draft" | "final" }
): Promise<StylePassCacheEntry | undefined> {
  if (!presetUsesStylePass(preset)) return undefined;

  const storage = getStorage();
  const project = await storage.loadProject(projectId);
  if (!project) throw new Error("Project not found");

  const prompt = buildStylePassPrompt(preset);
  if (!prompt) throw new Error("Invalid style preset");

  const { buffer: compositeBuf, width, height, hash: compositeHash } =
    await buildPlanCompositePng(projectId, project);
  const cacheHash = styleCacheKey(compositeHash, preset);

  const cached = getStylePassCacheEntry(project, preset, cacheHash);
  if (cached) {
    const ok = await storage.projectFileExists(projectId, cached.registeredFilename);
    if (ok) return cached;
  }

  const compositeRel = await saveCompositeCache(projectId, compositeHash, compositeBuf);
  const files = stylePassFilenames(cacheHash);
  const compositeAbs = path.join(projectDir(projectId), compositeRel);
  const styledAbs = path.join(projectDir(projectId), files.styled);
  const registeredAbs = path.join(projectDir(projectId), files.registered);
  const previewAbs = path.join(projectDir(projectId), files.preview);

  await fs.mkdir(path.dirname(styledAbs), { recursive: true });

  const refs = await loadReferenceImages(preset);
  const provider = new GeminiRenderProvider(options?.quality ?? "draft");
  const aspect =
    width >= height ? ("4:3" as const) : ("3:4" as const);
  const result = await provider.generate({
    prompt,
    referenceImages: [compositeBuf, ...refs],
    aspectRatio: aspect,
    resolution: options?.quality === "final" ? "2K" : "1K",
  });

  await fs.writeFile(styledAbs, result.image);

  const registration = await runRegistration(compositeAbs, styledAbs, registeredAbs, width);

  if (!registration.passed) {
    throw new Error(
      registration.error ??
        `Registration failed (${registration.inlierCount} inliers, ${registration.residualPct}% residual)`
    );
  }

  const previewLong = 2000;
  const scale = previewLong / Math.max(width, height);
  if (scale < 1) {
    await sharp(await fs.readFile(registeredAbs))
      .resize(Math.round(width * scale), Math.round(height * scale))
      .png()
      .toBuffer()
      .then((b) => fs.writeFile(previewAbs, b));
  } else {
    await fs.copyFile(registeredAbs, previewAbs);
  }

  const entry = StylePassCacheEntrySchema.parse({
    preset,
    hash: cacheHash,
    compositeFilename: compositeRel,
    styledFilename: files.styled,
    registeredFilename: files.registered,
    previewFilename: files.preview,
    width,
    height,
    registration,
    generatedAt: new Date().toISOString(),
    estimatedCostUsd: 0.08,
  });

  const updated: Project = {
    ...project,
    stylePassCache: {
      ...(project.stylePassCache ?? {}),
      [`${preset}:${cacheHash}`]: entry,
    },
    updatedAt: new Date().toISOString(),
  };
  await storage.saveProject(updated);
  return entry;
}

async function executeStylePassJob(projectId: string, preset: StylePresetId): Promise<void> {
  const startedAt = new Date().toISOString();
  await writeStylePassJob(projectId, {
    status: "running",
    preset,
    progress: 10,
    step: "composite",
    startedAt,
  });

  try {
    await writeStylePassJob(projectId, {
      status: "running",
      preset,
      progress: 40,
      step: "style-pass",
      startedAt,
    });

    const entry = await runStylePassForProject(projectId, preset);

    await writeStylePassJob(projectId, {
      status: "complete",
      preset,
      progress: 100,
      step: "complete",
      cacheHash: entry?.hash,
      startedAt,
      completedAt: new Date().toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Style pass failed";
    const pythonInterpreter =
      (e as { pythonCommand?: string }).pythonCommand ?? getPythonCommand();
    await writeStylePassJob(projectId, {
      status: "error",
      preset,
      progress: 0,
      error: msg,
      pythonInterpreter,
      startedAt,
      completedAt: new Date().toISOString(),
    });
    throw e;
  }
}

export function startStylePassJob(projectId: string, preset: StylePresetId): void {
  if (!presetUsesStylePass(preset)) return;
  if (runningJobs.has(projectId)) return;
  const job = executeStylePassJob(projectId, preset).finally(() => {
    runningJobs.delete(projectId);
  });
  runningJobs.set(projectId, job);
}

export async function resolveStylePassUrls(
  project: Project,
  projectId: string,
  preset: StylePresetId,
  forPrint: boolean
): Promise<{ preview?: string; registered?: string; hash?: string; registration?: RegistrationResult }> {
  if (!presetUsesStylePass(preset)) return {};

  try {
    const { hash: compositeHash } = await buildPlanCompositePng(projectId, project);
    const cacheHash = styleCacheKey(compositeHash, preset);
    const entry = getStylePassCacheEntry(project, preset, cacheHash);
    if (!entry) return { hash: cacheHash };

    const storage = getStorage();
    const file = forPrint ? entry.registeredFilename : entry.previewFilename;
    const exists = await storage.projectFileExists(projectId, file);
    if (!exists) return { hash: cacheHash };

    return {
      hash: cacheHash,
      preview: entry.previewFilename,
      registered: entry.registeredFilename,
      registration: entry.registration,
    };
  } catch {
    return {};
  }
}

/** Effective style preset from plan settings (migrates legacy watercolor basePreset). */
export function resolveStylePreset(project: Project): StylePresetId {
  const ps = project.planSettings;
  if (ps?.stylePreset) return ps.stylePreset;
  const legacy = ps?.basePreset;
  if (
    legacy === "watercolor-soft" ||
    legacy === "watercolor-heavy" ||
    legacy === "ink-wash"
  ) {
    return "watercolor-plan";
  }
  if (legacy === "off" || legacy === "desaturated") return "off";
  return "off";
}
