import path from "path";
import fs from "fs/promises";
import {
  AnnotationBaseSchema,
  type AnnotationBase,
  type Project,
} from "@/lib/project-schema";
import { runPythonScript } from "@/lib/run-python";
import { getStorage } from "@/lib/storage";

import {
  ANNOTATION_BASE_JPG,
  ANNOTATION_BASE_JSON,
  DEFAULT_ANNOTATION_LONG_EDGE,
} from "@/lib/annotation-base-constants";

function ldbgRoot(): string {
  return process.cwd();
}

function exportScriptPath(): string {
  return path.join(ldbgRoot(), "scripts", "export_annotation_base.py");
}

function storageRoot(): string {
  return process.env.LDBG_STORAGE_DIR ?? path.join(ldbgRoot(), "storage");
}

function projectDir(projectId: string): string {
  return path.join(storageRoot(), projectId);
}

export async function runExportAnnotationBase(
  tifAbs: string,
  jpgAbs: string,
  metaAbs: string,
  longEdge: number
): Promise<Record<string, unknown>> {
  const { stdout, stderr, code } = await runPythonScript(exportScriptPath(), [
    tifAbs,
    "--out",
    jpgAbs,
    "--meta-out",
    metaAbs,
    "--max-edge",
    String(longEdge),
  ]);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout.trim() || "{}") as Record<string, unknown>;
  } catch {
    throw new Error(
      `Annotation base export returned invalid JSON (exit ${code}). ${stderr || stdout}`.slice(
        0,
        500
      )
    );
  }

  if (code !== 0 || parsed.error) {
    throw new Error(String(parsed.error ?? stderr ?? "Annotation base export failed"));
  }

  return parsed;
}

export function parseAnnotationBaseMeta(raw: Record<string, unknown>): AnnotationBase {
  return AnnotationBaseSchema.parse({
    filename: ANNOTATION_BASE_JPG,
    metaFilename: ANNOTATION_BASE_JSON,
    width: raw.width,
    height: raw.height,
    longEdgePx: raw.longEdgePx ?? raw.longEdge,
    downscaleFactor: raw.downscaleFactor,
    affine: raw.affine,
    pixelsPerFoot: raw.pixelsPerFoot,
    crs: raw.crs,
    fullWidthPx: raw.fullWidthPx,
    fullHeightPx: raw.fullHeightPx,
    exportedAt: new Date().toISOString(),
  });
}

export async function exportAnnotationBaseForProject(
  projectId: string,
  options?: { longEdge?: number; force?: boolean }
): Promise<{ project: Project } | { error: string }> {
  const storage = getStorage();
  const project = await storage.loadProject(projectId);
  if (!project) return { error: "Project not found" };

  if (!project.webodm?.orthophotoStoredAs) {
    return { error: "WebODM orthophoto not found — ingest a WebODM export first" };
  }

  const longEdge = options?.longEdge ?? DEFAULT_ANNOTATION_LONG_EDGE;
  const exists = await storage.projectFileExists(projectId, ANNOTATION_BASE_JPG);

  if (!options?.force && exists && project.annotationBase) {
    return { project };
  }

  const tifAbs = path.join(projectDir(projectId), project.webodm.orthophotoStoredAs);
  const jpgAbs = path.join(projectDir(projectId), ANNOTATION_BASE_JPG);
  const metaAbs = path.join(projectDir(projectId), ANNOTATION_BASE_JSON);

  try {
    await fs.access(tifAbs);
  } catch {
    return { error: "Orthophoto GeoTIFF missing on disk — re-ingest WebODM export" };
  }

  let raw: Record<string, unknown>;
  try {
    raw = await runExportAnnotationBase(tifAbs, jpgAbs, metaAbs, longEdge);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Export failed" };
  }

  const annotationBase = parseAnnotationBaseMeta(raw);

  const jpgBuf = await fs.readFile(jpgAbs);
  const metaBuf = await fs.readFile(metaAbs);
  await storage.saveProjectFile(projectId, ANNOTATION_BASE_JPG, jpgBuf);
  await storage.saveProjectFile(projectId, ANNOTATION_BASE_JSON, metaBuf);

  const updated: Project = {
    ...project,
    annotationBase,
    updatedAt: new Date().toISOString(),
  };
  await storage.saveProject(updated);

  console.info(
    `[annotation-base] project=${projectId} ${annotationBase.width}x${annotationBase.height} factor=${annotationBase.downscaleFactor.toFixed(2)}`
  );

  return { project: updated };
}
