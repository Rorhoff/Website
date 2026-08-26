import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import {
  presetUsesFilter,
  resolveWatercolorParams,
  type WatercolorParams,
  type WatercolorPresetId,
} from "@/config/watercolor";
import type { Project } from "@/lib/project-schema";
import { getDisplayImage, getPrintBoardImage } from "@/lib/georef";
import { runPythonScript } from "@/lib/run-python";
import { getStorage } from "@/lib/storage";
import {
  WatercolorCacheEntrySchema,
  WatercolorJobSchema,
  type WatercolorCacheEntry,
  type WatercolorJob,
} from "@/lib/watercolor-schema";

const DERIVED_DIR = "derived";
const JOB_FILENAME = "derived/watercolor-job.json";

const runningJobs = new Map<string, Promise<void>>();

function ldbgRoot(): string {
  return process.cwd();
}

function storageRoot(): string {
  return process.env.LDBG_STORAGE_DIR ?? path.join(ldbgRoot(), "storage");
}

function projectDir(projectId: string): string {
  return path.join(storageRoot(), projectId);
}

function watercolorScriptPath(): string {
  return path.join(ldbgRoot(), "scripts", "watercolor.py");
}

function paperTexturePath(): string {
  return path.join(ldbgRoot(), "public", "textures", "paper-cold-press.jpg");
}

function derivedDir(projectId: string): string {
  return path.join(projectDir(projectId), DERIVED_DIR);
}

export function watercolorCacheFilename(preset: string, hash: string, preview = false): string {
  const suffix = preview ? "-preview" : "";
  return `${DERIVED_DIR}/base-${preset}-${hash}${suffix}.png`;
}

async function sha256File(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

function hashParams(preset: WatercolorPresetId, params: WatercolorParams): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ preset, params }))
    .digest("hex")
    .slice(0, 12);
}

export async function computeWatercolorCacheKey(
  sourcePath: string,
  preset: WatercolorPresetId,
  paramOverrides?: Partial<WatercolorParams>
): Promise<string> {
  const params = resolveWatercolorParams(preset, paramOverrides);
  if (!params) throw new Error(`Preset ${preset} does not use filter pipeline`);
  const fileHash = await sha256File(sourcePath);
  const paramHash = hashParams(preset, params);
  return `${fileHash}-${paramHash}`;
}

export function getWatercolorSourceForPlan(
  project: Project,
  forPrint: boolean
): { filename: string; width: number; height: number } | undefined {
  if (forPrint) {
    return getPrintBoardImage(project) ?? getDisplayImage(project);
  }
  return getDisplayImage(project);
}

export async function readWatercolorJob(projectId: string): Promise<WatercolorJob> {
  const jobPath = path.join(projectDir(projectId), JOB_FILENAME);
  try {
    const raw = JSON.parse(await fs.readFile(jobPath, "utf8")) as unknown;
    return WatercolorJobSchema.parse(raw);
  } catch {
    return { status: "idle", progress: 0 };
  }
}

async function writeWatercolorJob(projectId: string, job: WatercolorJob): Promise<void> {
  const jobPath = path.join(projectDir(projectId), JOB_FILENAME);
  await fs.mkdir(path.dirname(jobPath), { recursive: true });
  await fs.writeFile(jobPath, JSON.stringify(job, null, 2), "utf8");
}

export function getWatercolorCacheEntry(
  project: Project,
  preset: WatercolorPresetId,
  hash: string
): WatercolorCacheEntry | undefined {
  const key = `${preset}:${hash}`;
  return project.watercolorCache?.[key];
}

export async function findCachedWatercolor(
  projectId: string,
  preset: WatercolorPresetId,
  hash: string
): Promise<WatercolorCacheEntry | undefined> {
  const storage = getStorage();
  const project = await storage.loadProject(projectId);
  if (!project) return undefined;

  const entry = getWatercolorCacheEntry(project, preset, hash);
  if (!entry) return undefined;

  const fullExists = await storage.projectFileExists(projectId, entry.fullFilename);
  const previewExists = await storage.projectFileExists(projectId, entry.previewFilename);
  if (fullExists && previewExists) return entry;
  return undefined;
}

async function runWatercolorFilter(
  projectId: string,
  sourceAbs: string,
  preset: WatercolorPresetId,
  hash: string,
  paramOverrides?: Partial<WatercolorParams>
): Promise<WatercolorCacheEntry> {
  const params = resolveWatercolorParams(preset, paramOverrides);
  if (!params) throw new Error(`Preset ${preset} has no filter params`);

  const fullRel = watercolorCacheFilename(preset, hash, false);
  const previewRel = watercolorCacheFilename(preset, hash, true);
  const fullAbs = path.join(projectDir(projectId), fullRel);
  const previewAbs = path.join(projectDir(projectId), previewRel);
  const paramsPath = path.join(derivedDir(projectId), `params-${hash}.json`);

  await fs.mkdir(derivedDir(projectId), { recursive: true });
  await fs.writeFile(paramsPath, JSON.stringify(params, null, 2), "utf8");

  const paper = paperTexturePath();
  const args = [
    sourceAbs,
    "--params-json",
    paramsPath,
    "--out-full",
    fullAbs,
    "--out-preview",
    previewAbs,
  ];
  if (await fs.stat(paper).then(() => true).catch(() => false)) {
    args.push("--paper-texture", paper);
  }

  const { stdout, stderr, code } = await runPythonScript(
    watercolorScriptPath(),
    args,
    { timeoutMs: 600_000 }
  );

  const lines = stdout.trim().split("\n");
  let resultLine = lines[lines.length - 1] ?? "{}";
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]?.startsWith("{") && !lines[i]?.includes('"type":"progress"')) {
      resultLine = lines[i]!;
      break;
    }
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(resultLine) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Watercolor filter returned invalid JSON (exit ${code}). ${stderr || stdout}`.slice(0, 500)
    );
  }

  if (code !== 0 || parsed.error) {
    throw new Error(String(parsed.error ?? stderr ?? "Watercolor filter failed"));
  }

  const storage = getStorage();
  const project = await storage.loadProject(projectId);
  if (!project) throw new Error("Project not found");

  const sourceRel = path.relative(projectDir(projectId), sourceAbs).replace(/\\/g, "/");
  const entry = WatercolorCacheEntrySchema.parse({
    preset,
    hash,
    fullFilename: fullRel.replace(/\\/g, "/"),
    previewFilename: previewRel.replace(/\\/g, "/"),
    width: parsed.width,
    height: parsed.height,
    sourceFilename: sourceRel,
    filteredAt: parsed.filteredAt ?? new Date().toISOString(),
  });

  const cacheKey = `${preset}:${hash}`;
  const updated: Project = {
    ...project,
    watercolorCache: {
      ...(project.watercolorCache ?? {}),
      [cacheKey]: entry,
    },
    updatedAt: new Date().toISOString(),
  };
  await storage.saveProject(updated);
  return entry;
}

async function executeWatercolorJob(
  projectId: string,
  preset: WatercolorPresetId,
  forPrintSource: boolean,
  paramOverrides?: Partial<WatercolorParams>
): Promise<void> {
  const startedAt = new Date().toISOString();
  await writeWatercolorJob(projectId, {
    status: "running",
    preset,
    progress: 0,
    step: "starting",
    startedAt,
  });

  try {
    const storage = getStorage();
    const project = await storage.loadProject(projectId);
    if (!project) throw new Error("Project not found");

    const source = getWatercolorSourceForPlan(project, forPrintSource);
    if (!source) throw new Error("No source orthophoto for watercolor filter");

    const sourceAbs = path.join(projectDir(projectId), source.filename);
    const hash = await computeWatercolorCacheKey(sourceAbs, preset, paramOverrides);

    const cached = await findCachedWatercolor(projectId, preset, hash);
    if (cached) {
      await writeWatercolorJob(projectId, {
        status: "complete",
        preset,
        progress: 100,
        step: "cached",
        startedAt,
        completedAt: new Date().toISOString(),
        cacheHash: hash,
      });
      return;
    }

    await writeWatercolorJob(projectId, {
      status: "running",
      preset,
      progress: 10,
      step: "filtering",
      startedAt,
      cacheHash: hash,
    });

    await runWatercolorFilter(projectId, sourceAbs, preset, hash, paramOverrides);

    await writeWatercolorJob(projectId, {
      status: "complete",
      preset,
      progress: 100,
      step: "complete",
      startedAt,
      completedAt: new Date().toISOString(),
      cacheHash: hash,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Watercolor job failed";
    await writeWatercolorJob(projectId, {
      status: "error",
      preset,
      progress: 0,
      error: msg,
      startedAt,
      completedAt: new Date().toISOString(),
    });
    throw e;
  }
}

/** Start background watercolor generation; returns immediately. */
export function startWatercolorJob(
  projectId: string,
  preset: WatercolorPresetId,
  options?: { forPrintSource?: boolean; paramOverrides?: Partial<WatercolorParams> }
): void {
  if (!presetUsesFilter(preset)) return;

  const existing = runningJobs.get(projectId);
  if (existing) return;

  const job = executeWatercolorJob(
    projectId,
    preset,
    options?.forPrintSource ?? false,
    options?.paramOverrides
  ).finally(() => {
    runningJobs.delete(projectId);
  });
  runningJobs.set(projectId, job);
}

/** Ensure watercolor cache exists; runs synchronously if missing (for export). */
export async function ensureWatercolorForProject(
  projectId: string,
  preset: WatercolorPresetId,
  options?: { forPrint?: boolean; paramOverrides?: Partial<WatercolorParams> }
): Promise<WatercolorCacheEntry | undefined> {
  if (!presetUsesFilter(preset)) return undefined;

  const storage = getStorage();
  const project = await storage.loadProject(projectId);
  if (!project) throw new Error("Project not found");

  const forPrint = options?.forPrint ?? false;
  const source = getWatercolorSourceForPlan(project, forPrint);
  if (!source) return undefined;

  const sourceAbs = path.join(projectDir(projectId), source.filename);
  const hash = await computeWatercolorCacheKey(
    sourceAbs,
    preset,
    options?.paramOverrides ?? project.planSettings?.watercolorParamOverrides
  );

  const cached = await findCachedWatercolor(projectId, preset, hash);
  if (cached) return cached;

  return runWatercolorFilter(
    projectId,
    sourceAbs,
    preset,
    hash,
    options?.paramOverrides ?? project.planSettings?.watercolorParamOverrides
  );
}

export async function resolveWatercolorUrls(
  project: Project,
  projectId: string,
  forPrint: boolean
): Promise<{ preview?: string; full?: string; hash?: string }> {
  const preset = project.planSettings?.basePreset ?? "watercolor-soft";
  if (!presetUsesFilter(preset)) return {};

  const source = getWatercolorSourceForPlan(project, forPrint);
  if (!source) return {};

  const sourceAbs = path.join(projectDir(projectId), source.filename);
  let hash: string;
  try {
    hash = await computeWatercolorCacheKey(
      sourceAbs,
      preset,
      project.planSettings?.watercolorParamOverrides
    );
  } catch {
    return {};
  }

  const entry = getWatercolorCacheEntry(project, preset, hash);
  if (!entry) return { hash };

  const storage = getStorage();
  const previewExists = await storage.projectFileExists(projectId, entry.previewFilename);
  const fullExists = await storage.projectFileExists(projectId, entry.fullFilename);
  if (!previewExists || !fullExists) return { hash };

  return {
    hash,
    preview: entry.previewFilename,
    full: entry.fullFilename,
  };
}
