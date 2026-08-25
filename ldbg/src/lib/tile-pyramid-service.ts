import fs from "fs/promises";
import path from "path";
import {
  DEFAULT_PRINT_LONG_EDGE,
  PRINT_ORTHO_FILENAME,
  PrintOrthoSchema,
  TilePyramidSchema,
  type PrintOrtho,
  type TilePyramid,
} from "@/lib/tile-pyramid-schema";
import { buildDtmCacheForProject } from "@/lib/elevation-service";
import { projectHasDtm } from "@/lib/elevation-utils";
import type { Project } from "@/lib/project-schema";
import { runPythonScript } from "@/lib/run-python";
import { getStorage } from "@/lib/storage";

const TILES_DIR = "tiles/orthophoto";

function ldbgRoot(): string {
  return process.cwd();
}

function storageRoot(): string {
  return process.env.LDBG_STORAGE_DIR ?? path.join(ldbgRoot(), "storage");
}

function projectDir(projectId: string): string {
  return path.join(storageRoot(), projectId);
}

function tilePyramidScriptPath(): string {
  return path.join(ldbgRoot(), "scripts", "generate_tile_pyramid.py");
}

function printOrthoScriptPath(): string {
  return path.join(ldbgRoot(), "scripts", "export_print_ortho.py");
}

async function runPythonJson(
  scriptPath: string,
  args: string[],
  timeoutMs: number
): Promise<Record<string, unknown>> {
  const { stdout, stderr, code } = await runPythonScript(scriptPath, args, {
    timeoutMs,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout.trim() || "{}") as Record<string, unknown>;
  } catch {
    throw new Error(
      `Python script returned invalid JSON (exit ${code}). ${stderr || stdout}`.slice(
        0,
        500
      )
    );
  }

  if (code !== 0 || parsed.error) {
    throw new Error(String(parsed.error ?? stderr ?? "Python script failed"));
  }

  return parsed;
}

export async function buildTilePyramidForProject(
  projectId: string,
  orthoRelPath: string
): Promise<TilePyramid> {
  const tifAbs = path.join(projectDir(projectId), orthoRelPath);
  const outAbs = path.join(projectDir(projectId), TILES_DIR);

  const raw = await runPythonJson(
    tilePyramidScriptPath(),
    [tifAbs, "--out", outAbs],
    900_000
  );

  return TilePyramidSchema.parse(raw);
}

export async function ensurePrintOrthoForProject(
  projectId: string,
  longEdge = DEFAULT_PRINT_LONG_EDGE
): Promise<PrintOrtho> {
  const storage = getStorage();
  const project = await storage.loadProject(projectId);
  if (!project) throw new Error("Project not found");

  if (project.printOrtho?.filename) {
    const exists = await storage.projectFileExists(
      projectId,
      project.printOrtho.filename
    );
    if (exists) return project.printOrtho;
  }

  const orthoRel = project.webodm?.orthophotoStoredAs;
  if (!orthoRel) throw new Error("Project has no full orthophoto for print export");

  const tifAbs = path.join(projectDir(projectId), orthoRel);
  const outAbs = path.join(projectDir(projectId), PRINT_ORTHO_FILENAME);

  const raw = await runPythonJson(
    printOrthoScriptPath(),
    [tifAbs, "--out", outAbs, "--long-edge", String(longEdge)],
    600_000
  );

  const printOrtho = PrintOrthoSchema.parse({
    filename: PRINT_ORTHO_FILENAME,
    width: raw.width,
    height: raw.height,
    longEdgePx: raw.longEdgePx,
    sourceWidthPx: raw.sourceWidthPx,
    sourceHeightPx: raw.sourceHeightPx,
    downscaleFactor: raw.downscaleFactor,
    exportedAt: raw.exportedAt,
  });

  const updated: Project = {
    ...project,
    printOrtho,
    updatedAt: new Date().toISOString(),
  };
  await storage.saveProject(updated);
  return printOrtho;
}

/** Build tile pyramid and DTM cache after WebODM ingest (A8). */
export async function buildPerformanceAssetsOnIngest(
  project: Project
): Promise<Project> {
  const storage = getStorage();
  let current = project;

  const orthoRel = project.webodm?.orthophotoStoredAs;
  if (orthoRel) {
    try {
      const tilePyramid = await buildTilePyramidForProject(project.id, orthoRel);
      current = {
        ...current,
        tilePyramid,
        updatedAt: new Date().toISOString(),
      };
      await storage.saveProject(current);
      console.info(
        `[a8-ingest] project=${project.id} tile pyramid z0-${tilePyramid.maxZoom}`
      );
    } catch (e) {
      console.warn(
        `[a8-ingest] tile pyramid failed project=${project.id}:`,
        e instanceof Error ? e.message : e
      );
    }
  }

  if (projectHasDtm(current)) {
    try {
      current = await buildDtmCacheForProject(project.id);
      console.info(`[a8-ingest] project=${project.id} DTM cache built`);
    } catch (e) {
      console.warn(
        `[a8-ingest] DTM cache failed project=${project.id}:`,
        e instanceof Error ? e.message : e
      );
    }
  }

  return current;
}

export function tileFilePath(
  projectId: string,
  z: number,
  x: number,
  y: number
): string {
  return path.join(
    projectDir(projectId),
    TILES_DIR,
    String(z),
    String(x),
    `${y}.jpg`
  );
}

export async function readTileFile(
  projectId: string,
  z: number,
  x: number,
  y: number
): Promise<Buffer | null> {
  try {
    return await fs.readFile(tileFilePath(projectId, z, x, y));
  } catch {
    return null;
  }
}
