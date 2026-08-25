import fs from "fs/promises";
import path from "path";
import {
  DtmCacheSchema,
  ElevationAnalysisResultSchema,
  StoredElevationAnalysisSchema,
  type StoredElevationAnalysis,
} from "@/lib/elevation-schema";
import { isProjectedGeometry } from "@/lib/feature-georef";
import type { InterpretFeature } from "@/lib/interpret-schema";
import type { Project } from "@/lib/project-schema";
import { getWebodmStoredPath } from "@/lib/elevation-utils";
import { runPythonScript } from "@/lib/run-python";
import { getStorage } from "@/lib/storage";

export const DTM_CACHE_FILENAME = "dtm-cache.json";

function ldbgRoot(): string {
  return process.cwd();
}

function dtmScriptPath(): string {
  return path.join(ldbgRoot(), "scripts", "dtm_analyze.py");
}

function storageRoot(): string {
  return process.env.LDBG_STORAGE_DIR ?? path.join(ldbgRoot(), "storage");
}

function projectDir(projectId: string): string {
  return path.join(storageRoot(), projectId);
}

function georefFeatures(features: InterpretFeature[]): InterpretFeature[] {
  return features.filter((f) => isProjectedGeometry(f.geometry));
}

async function runPythonJson(args: string[]): Promise<Record<string, unknown>> {
  const { stdout, stderr, code } = await runPythonScript(dtmScriptPath(), args, {
    timeoutMs: 300_000,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout.trim() || "{}") as Record<string, unknown>;
  } catch {
    throw new Error(
      `DTM script returned invalid JSON (exit ${code}). ${stderr || stdout}`.slice(0, 500)
    );
  }

  if (code !== 0 || parsed.error) {
    throw new Error(String(parsed.error ?? stderr ?? "DTM script failed"));
  }

  return parsed;
}

export async function buildDtmCacheForProject(projectId: string): Promise<Project> {
  const storage = getStorage();
  const project = await storage.loadProject(projectId);
  if (!project) throw new Error("Project not found");

  const dtmRel = getWebodmStoredPath(project, "dtm");
  if (!dtmRel) throw new Error("Project has no DTM — ingest odm_dem/dtm.tif with WebODM export");

  const dtmAbs = path.join(projectDir(projectId), dtmRel);
  const cacheAbs = path.join(projectDir(projectId), DTM_CACHE_FILENAME);

  const raw = await runPythonJson([
    "build-cache",
    dtmAbs,
    "--out",
    cacheAbs,
  ]);

  void raw;

  const cacheFile = JSON.parse(await fs.readFile(cacheAbs, "utf8")) as Record<string, unknown>;
  const dtmCache = DtmCacheSchema.parse({
    crs: cacheFile.crs,
    width: cacheFile.width,
    height: cacheFile.height,
    cellSizeMeters: cacheFile.cellSizeMeters,
    transform: cacheFile.transform,
    boundsProjected: cacheFile.boundsProjected,
    nodata: cacheFile.nodata ?? undefined,
    minElevationMeters: cacheFile.minElevationMeters,
    maxElevationMeters: cacheFile.maxElevationMeters,
    builtAt: cacheFile.builtAt,
    filename: DTM_CACHE_FILENAME,
  });

  const updated: Project = {
    ...project,
    dtmCache,
    updatedAt: new Date().toISOString(),
  };
  await storage.saveProject(updated);
  return updated;
}

export type ElevationAnalyzeOptions = {
  force?: boolean;
  contourMinorFt?: number;
  contourMajorFt?: number;
};

export type ElevationAnalyzeSuccess = {
  elevationAnalysis: StoredElevationAnalysis;
  cached: boolean;
};

export type ElevationAnalyzeFailure = { error: string };

export async function runElevationAnalysisForProject(
  projectId: string,
  options?: ElevationAnalyzeOptions
): Promise<ElevationAnalyzeSuccess | ElevationAnalyzeFailure> {
  const storage = getStorage();
  let project = await storage.loadProject(projectId);
  if (!project) return { error: "Project not found" };

  const dtmRel = getWebodmStoredPath(project, "dtm");
  if (!dtmRel) {
    return { error: "No DTM on this project — re-ingest WebODM export with odm_dem/dtm.tif" };
  }

  const features =
    project.features?.length
      ? project.features
      : project.interpretation?.features ?? [];
  const georef = georefFeatures(features);
  if (georef.length === 0) {
    return { error: "No georeferenced features — run interpret on a WebODM project first" };
  }

  if (!options?.force && project.elevationAnalysis) {
    return { elevationAnalysis: project.elevationAnalysis, cached: true };
  }

  const dir = projectDir(projectId);
  const dtmAbs = path.join(dir, dtmRel);
  const cacheAbs = path.join(dir, DTM_CACHE_FILENAME);

  if (!project.dtmCache || !(await fileExists(cacheAbs))) {
    try {
      project = await buildDtmCacheForProject(projectId);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "DTM cache build failed" };
    }
  }

  const featuresAbs = path.join(dir, ".elevation-features.json");
  await fs.writeFile(
    featuresAbs,
    JSON.stringify({ features: georef }),
    "utf8"
  );

  const minor = options?.contourMinorFt ?? project.planSettings?.contourMinorFt ?? 1;
  const major = options?.contourMajorFt ?? project.planSettings?.contourMajorFt ?? 5;

  try {
    const raw = await runPythonJson([
      "analyze",
      dtmAbs,
      "--features",
      featuresAbs,
      "--cache",
      cacheAbs,
      "--contour-minor-ft",
      String(minor),
      "--contour-major-ft",
      String(major),
    ]);

    const result = ElevationAnalysisResultSchema.parse(raw);
    const elevationAnalysis = StoredElevationAnalysisSchema.parse({
      ...result,
      analyzedAt: new Date().toISOString(),
      dtmSource: dtmRel,
    });

    const updated: Project = {
      ...project,
      elevationAnalysis,
      updatedAt: new Date().toISOString(),
    };
    await storage.saveProject(updated);

    console.info(
      `[elevation] project=${projectId} features=${result.features.length} contours=${result.contours.length}`
    );

    return { elevationAnalysis, cached: false };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Elevation analysis failed" };
  } finally {
    await fs.unlink(featuresAbs).catch(() => {});
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export function elevationFactsForDesignContent(
  analysis: StoredElevationAnalysis
): Record<string, unknown>[] {
  return analysis.features.map((f) => {
    const row: Record<string, unknown> = {
      featureId: f.featureId,
      featureType: f.featureType,
      label: f.label,
      elevationFeet: f.elevationFeet,
      slopePct: f.slopePct,
    };
    if (f.flags.length) row.flags = f.flags;
    if (f.cutFill) row.cutFillCubicYards = f.cutFill;
    if (f.waterFeatureHead) row.waterFeatureHead = f.waterFeatureHead;
    if (f.retainingWall) {
      row.retainingWallMaxExposedFeet = Math.max(
        ...f.retainingWall.samples.map((s) => s.exposedHeightFeet)
      );
    }
    return row;
  });
}
