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
import { formatPythonCommandLine, resolvePythonCommand, runPythonScript, validatePythonInterpreter } from "@/lib/run-python";
import { getStorage } from "@/lib/storage";
import {
  WatercolorCacheEntrySchema,
  normalizeWatercolorJob,
  type WatercolorCacheEntry,
  type WatercolorJob,
} from "@/lib/watercolor-schema";

const DERIVED_DIR = "derived";
const JOB_FILENAME = "derived/watercolor-job.json";
const IO_TAIL_CHARS = 4000;

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

function tailText(text: string, max = IO_TAIL_CHARS): string {
  if (text.length <= max) return text;
  return text.slice(-max);
}

function formatSpawnFailure(
  msg: string,
  pythonCommand: string,
  commandLine: string,
  stdout: string,
  stderr: string,
  code?: number
): string {
  const parts = [msg];
  if (code != null) parts.push(`exit ${code}`);
  parts.push(`interpreter: ${pythonCommand}`);
  if (stderr.trim()) parts.push(`stderr: ${tailText(stderr, 800)}`);
  else if (stdout.trim()) parts.push(`stdout: ${tailText(stdout, 800)}`);
  parts.push(`command: ${commandLine}`);
  return parts.join(" · ");
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

export type WatercolorSourceKind = "annotated" | "display" | "print";

export function getWatercolorSource(
  project: Project,
  kind: WatercolorSourceKind = "display"
): { filename: string; width: number; height: number } | undefined {
  switch (kind) {
    case "annotated":
      return project.images.annotated ?? getDisplayImage(project);
    case "print":
      return getPrintBoardImage(project) ?? getDisplayImage(project);
    default:
      return getDisplayImage(project);
  }
}

export function getWatercolorSourceForPlan(
  project: Project,
  forPrint: boolean
): { filename: string; width: number; height: number } | undefined {
  return getWatercolorSource(project, forPrint ? "print" : "display");
}

export async function readWatercolorJob(projectId: string): Promise<WatercolorJob> {
  const jobPath = path.join(projectDir(projectId), JOB_FILENAME);
  try {
    const raw = JSON.parse(await fs.readFile(jobPath, "utf8")) as unknown;
    return normalizeWatercolorJob(raw);
  } catch {
    return { status: "idle", progress: 0 };
  }
}

async function writeWatercolorJob(projectId: string, job: WatercolorJob): Promise<void> {
  const jobPath = path.join(projectDir(projectId), JOB_FILENAME);
  await fs.mkdir(path.dirname(jobPath), { recursive: true });
  await fs.writeFile(jobPath, JSON.stringify(job, null, 2), "utf8");
}

async function writeWatercolorFailed(
  projectId: string,
  job: Omit<WatercolorJob, "status"> & { error: string }
): Promise<void> {
  await writeWatercolorJob(projectId, {
    ...job,
    status: "failed",
    completedAt: new Date().toISOString(),
  });
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

  const previewRel = watercolorCacheFilename(preset, hash, true);
  const fullRel = watercolorCacheFilename(preset, hash, false);
  const previewExists = await storage.projectFileExists(projectId, previewRel);
  const fullExists = await storage.projectFileExists(projectId, fullRel);
  if (!previewExists || !fullExists) return undefined;

  const cached = getWatercolorCacheEntry(project, preset, hash);
  if (cached) return cached;

  const source = getWatercolorSource(project, "annotated") ?? getDisplayImage(project);
  const entry = WatercolorCacheEntrySchema.parse({
    preset,
    hash,
    fullFilename: fullRel.replace(/\\/g, "/"),
    previewFilename: previewRel.replace(/\\/g, "/"),
    width: source?.width ?? 1,
    height: source?.height ?? 1,
    sourceFilename: source?.filename ?? "",
    filteredAt: new Date().toISOString(),
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

type WatercolorFilterContext = {
  projectId: string;
  preset: WatercolorPresetId;
  hash: string;
  startedAt: string;
  jobBase: Pick<WatercolorJob, "preset" | "startedAt" | "cacheHash">;
};

async function runWatercolorFilter(
  ctx: WatercolorFilterContext,
  sourceAbs: string,
  paramOverrides?: Partial<WatercolorParams>
): Promise<WatercolorCacheEntry> {
  const { projectId, preset, hash, jobBase } = ctx;
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

  let pythonCommand = (() => {
    const resolution = resolvePythonCommand();
    validatePythonInterpreter(resolution);
    return resolution.command;
  })();
  const commandLinePreview = formatPythonCommandLine(
    pythonCommand,
    watercolorScriptPath(),
    args
  );
  let lastProgressWrite = 0;

  const onStdoutLine = (line: string) => {
    try {
      const msg = JSON.parse(line) as {
        type?: string;
        progress?: number;
        step?: string;
        error?: string;
      };
      if (msg.type === "progress" && typeof msg.progress === "number") {
        const now = Date.now();
        if (now - lastProgressWrite < 400) return;
        lastProgressWrite = now;
        void writeWatercolorJob(projectId, {
          ...jobBase,
          status: "running",
          progress: msg.progress,
          step: msg.step ?? "filtering",
          pythonInterpreter: pythonCommand,
          commandLine: commandLinePreview,
        });
      }
    } catch {
      /* non-JSON stdout line */
    }
  };

  let stdout = "";
  let stderr = "";
  let code = 1;
  let commandLine = "";

  try {
    ({ stdout, stderr, code, pythonCommand, commandLine } = await runPythonScript(
      watercolorScriptPath(),
      args,
      {
        timeoutMs: 600_000,
        onStdoutLine,
      }
    ));
  } catch (e) {
    const err = e as Error & {
      pythonCommand?: string;
      commandLine?: string;
      stdout?: string;
      stderr?: string;
    };
    const py = err.pythonCommand ?? pythonCommand;
    const cmd = err.commandLine ?? commandLine;
    const out = err.stdout ?? stdout;
    const errOut = err.stderr ?? stderr;
    const msg = formatSpawnFailure(
      err.message,
      py,
      cmd,
      out,
      errOut
    );
    await writeWatercolorFailed(projectId, {
      ...jobBase,
      progress: 0,
      error: msg,
      pythonInterpreter: py,
      commandLine: cmd,
      stdout: tailText(out),
      stderr: tailText(errOut),
    });
    throw Object.assign(new Error(msg), {
      pythonCommand: py,
      commandLine: cmd,
      stdout: out,
      stderr: errOut,
    });
  }

  console.info(
    `[ldbg] watercolor finished project=${projectId} exit=${code} interpreter=${pythonCommand}`
  );
  if (stderr.trim()) {
    console.warn(`[ldbg] watercolor stderr project=${projectId}: ${tailText(stderr, 1200)}`);
  }

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
    const msg = formatSpawnFailure(
      `Watercolor filter returned invalid JSON`,
      pythonCommand,
      commandLine,
      stdout,
      stderr,
      code
    );
    await writeWatercolorFailed(projectId, {
      ...jobBase,
      progress: 0,
      error: msg,
      pythonInterpreter: pythonCommand,
      commandLine,
      stdout: tailText(stdout),
      stderr: tailText(stderr),
    });
    throw Object.assign(new Error(msg), { pythonCommand, commandLine, stdout, stderr });
  }

  if (code !== 0 || parsed.error) {
    const msg = formatSpawnFailure(
      String(parsed.error ?? "Watercolor filter failed"),
      pythonCommand,
      commandLine,
      stdout,
      stderr,
      code
    );
    await writeWatercolorFailed(projectId, {
      ...jobBase,
      progress: 0,
      error: msg,
      pythonInterpreter: pythonCommand,
      commandLine,
      stdout: tailText(stdout),
      stderr: tailText(stderr),
    });
    throw Object.assign(new Error(msg), { pythonCommand, commandLine, stdout, stderr });
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
    pipelineSteps: parsed.pipelineSteps,
    paramsUsed: parsed.paramsUsed,
    paperTextureApplied: parsed.paperTextureApplied,
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
  options?: {
    forPrintSource?: boolean;
    sourceKind?: WatercolorSourceKind;
    paramOverrides?: Partial<WatercolorParams>;
  }
): Promise<void> {
  const sourceKind: WatercolorSourceKind =
    options?.sourceKind ?? (options?.forPrintSource ? "print" : "display");
  const startedAt = new Date().toISOString();
  const resolution = resolvePythonCommand();
  validatePythonInterpreter(resolution);
  const pythonInterpreter = resolution.command;

  await writeWatercolorJob(projectId, {
    status: "running",
    preset,
    progress: 0,
    step: "starting",
    startedAt,
    pythonInterpreter,
    sourceKind,
  });

  try {
    const storage = getStorage();
    const project = await storage.loadProject(projectId);
    if (!project) throw new Error("Project not found");

    const source = getWatercolorSource(project, sourceKind);
    if (!source) throw new Error("No source orthophoto for watercolor filter");

    const paramOverrides =
      options?.paramOverrides ?? project.planSettings?.watercolorParamOverrides;
    const sourceAbs = path.join(projectDir(projectId), source.filename);
    const hash = await computeWatercolorCacheKey(sourceAbs, preset, paramOverrides);

    const jobBase = {
      preset,
      startedAt,
      cacheHash: hash,
      sourceKind,
    };

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
        pythonInterpreter,
      });
      return;
    }

    await writeWatercolorJob(projectId, {
      ...jobBase,
      status: "running",
      progress: 5,
      step: "spawn",
      pythonInterpreter,
    });

    await runWatercolorFilter(
      { projectId, preset, hash, startedAt, jobBase },
      sourceAbs,
      paramOverrides
    );

    await writeWatercolorJob(projectId, {
      status: "complete",
      preset,
      progress: 100,
      step: "complete",
      startedAt,
      completedAt: new Date().toISOString(),
      cacheHash: hash,
      pythonInterpreter,
    });
  } catch (e) {
    const err = e as Error & {
      pythonCommand?: string;
      commandLine?: string;
      stdout?: string;
      stderr?: string;
    };
    const msg = err.message || "Watercolor job failed";
    const existing = await readWatercolorJob(projectId);
    if (existing.status !== "failed") {
      await writeWatercolorFailed(projectId, {
        preset,
        progress: existing.progress ?? 0,
        step: existing.step,
        error: msg,
        pythonInterpreter: err.pythonCommand ?? pythonInterpreter,
        commandLine: err.commandLine,
        stdout: err.stdout ? tailText(err.stdout) : undefined,
        stderr: err.stderr ? tailText(err.stderr) : undefined,
        startedAt,
        cacheHash: existing.cacheHash,
      });
    }
    throw e;
  }
}

/** Start background watercolor generation; returns immediately. */
export function startWatercolorJob(
  projectId: string,
  preset: WatercolorPresetId,
  options?: {
    forPrintSource?: boolean;
    sourceKind?: WatercolorSourceKind;
    paramOverrides?: Partial<WatercolorParams>;
  }
): void {
  if (!presetUsesFilter(preset)) return;

  const existing = runningJobs.get(projectId);
  if (existing) return;

  const job = executeWatercolorJob(projectId, preset, options).finally(() => {
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

  const startedAt = new Date().toISOString();
  return runWatercolorFilter(
    {
      projectId,
      preset,
      hash,
      startedAt,
      jobBase: { preset, startedAt, cacheHash: hash },
    },
    sourceAbs,
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
