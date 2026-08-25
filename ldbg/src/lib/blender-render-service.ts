import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import {
  blenderFilenameForSlot,
  SLOT_BLENDER_PRESET,
  type BlenderCameraPreset,
  type BlenderRenderSettings,
} from "@/lib/blender-schema";
import type { FeatureElevationAnalysis } from "@/lib/elevation-schema";
import { getWebodmStoredPath } from "@/lib/elevation-utils";
import { isProjectedGeometry } from "@/lib/feature-georef";
import type { InterpretFeature } from "@/lib/interpret-schema";
import type { Project } from "@/lib/project-schema";
import type { RenderSlotKey } from "@/lib/render-slots";
import { getStorage } from "@/lib/storage";

function ldbgRoot(): string {
  return process.cwd();
}

function storageRoot(): string {
  return process.env.LDBG_STORAGE_DIR ?? path.join(ldbgRoot(), "storage");
}

function projectDir(projectId: string): string {
  return path.join(storageRoot(), projectId);
}

function blenderScriptPath(): string {
  return path.join(ldbgRoot(), "scripts", "blender_render.py");
}

function runBlender(
  sceneJsonPath: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  const blenderCmd =
    process.env.LDBG_BLENDER ??
    (process.platform === "win32" ? "blender" : "blender");

  return new Promise((resolve, reject) => {
    const child = spawn(
      blenderCmd,
      ["--background", "--python", blenderScriptPath(), "--", sceneJsonPath],
      { cwd: ldbgRoot(), windowsHide: true }
    );

    let stdout = "";
    let stderr = "";
    const timeoutMs = 600_000;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Blender timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

function featurePayload(
  f: InterpretFeature,
  analysis?: FeatureElevationAnalysis
): Record<string, unknown> | null {
  if (!isProjectedGeometry(f.geometry)) return null;
  return {
    id: f.id,
    featureType: f.featureType,
    kind: f.geometry.kind,
    existing: f.existing,
    coordinates: f.geometry.coordinates,
    radiusM: f.geometry.radius,
    targetElevationFeet: f.targetElevationFeet,
    elevationFeet: analysis?.elevationFeet,
  };
}

function defaultSun(project: Project) {
  const b = project.georeference?.boundsWgs84;
  const lat = b ? (b.minY + b.maxY) / 2 : 40.76;
  const lon = b ? (b.minX + b.maxX) / 2 : -111.89;
  return project.blenderSettings?.sun ?? { lat, lon, hour: 18, dayOfYear: 172 };
}

export type BlenderRenderSuccess = {
  slot: RenderSlotKey;
  filename: string;
  preset: BlenderCameraPreset;
  cached: boolean;
  blenderRenders?: Project["blenderRenders"];
};

export type BlenderRenderFailure = { error: string };

export async function blenderRenderForSlot(
  projectId: string,
  slot: RenderSlotKey,
  options?: { force?: boolean; preset?: BlenderCameraPreset }
): Promise<BlenderRenderSuccess | BlenderRenderFailure> {
  const storage = getStorage();
  const project = await storage.loadProject(projectId);
  if (!project) return { error: "Project not found" };

  const meshRel = getWebodmStoredPath(project, "mesh_obj");
  if (!meshRel) {
    return {
      error:
        "No textured mesh — re-ingest WebODM export with odm_textured_model_geo.obj",
    };
  }

  const preset = options?.preset ?? SLOT_BLENDER_PRESET[slot] ?? "rear_hero";
  const outName = blenderFilenameForSlot(slot);
  const cached = project.blenderRenders?.[slot];

  if (!options?.force && cached?.filename) {
    const exists = await storage.projectFileExists(projectId, cached.filename);
    if (exists) {
      return {
        slot,
        filename: cached.filename,
        preset: cached.preset,
        cached: true,
        blenderRenders: project.blenderRenders,
      };
    }
  }

  const features =
    project.features?.length
      ? project.features
      : project.interpretation?.features ?? [];
  const analysisMap = new Map(
    (project.elevationAnalysis?.features ?? []).map((a) => [a.featureId, a])
  );

  const featureList = features
    .map((f) => featurePayload(f, analysisMap.get(f.id)))
    .filter(Boolean) as Record<string, unknown>[];

  if (featureList.length === 0) {
    return { error: "No georeferenced features — run interpret first" };
  }

  const dir = projectDir(projectId);
  const meshAbs = path.join(dir, meshRel);
  const outAbs = path.join(dir, outName);
  const scenePath = path.join(dir, `.blender-scene-${slot}.json`);

  const bounds =
    project.georeference?.boundsProjected ?? project.dtmCache?.boundsProjected;
  if (!bounds) {
    return { error: "Project missing georeference bounds" };
  }

  const settings: BlenderRenderSettings = project.blenderSettings ?? {
    resolution: [1920, 1080],
    samples: 48,
    engine: "BLENDER_EEVEE_NEXT",
  };
  const scene = {
    meshObj: meshAbs,
    meshBaseDir: path.dirname(meshAbs),
    outputPng: outAbs,
    bounds,
    camera: { preset },
    sun: defaultSun(project),
    features: featureList,
    resolution: settings.resolution,
    samples: settings.samples,
    engine: settings.engine,
  };

  try {
    await fs.writeFile(scenePath, JSON.stringify(scene), "utf8");
    const { stdout, stderr, code } = await runBlender(scenePath);

    let parsed: { ok?: boolean; error?: string } = {};
    const lines = stdout.trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        parsed = JSON.parse(lines[i]) as { ok?: boolean; error?: string };
        if (parsed.ok || parsed.error) break;
      } catch {
        /* skip non-json lines */
      }
    }

    if (code !== 0 || !parsed.ok) {
      throw new Error(
        parsed.error ??
          stderr.slice(-800) ??
          stdout.slice(-800) ??
          `Blender exited ${code}`
      );
    }

    const blenderRenders = {
      ...(project.blenderRenders ?? {}),
      [slot]: {
        filename: outName,
        preset,
        renderedAt: new Date().toISOString(),
        slot,
      },
    };

    const updated: Project = {
      ...project,
      blenderRenders,
      updatedAt: new Date().toISOString(),
    };
    await storage.saveProject(updated);

    console.info(`[blender] project=${projectId} slot=${slot} preset=${preset}`);

    return {
      slot,
      filename: outName,
      preset,
      cached: false,
      blenderRenders,
    };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Blender render failed",
    };
  } finally {
    await fs.unlink(scenePath).catch(() => {});
  }
}

export async function readBlenderRenderBuffer(
  projectId: string,
  slot: RenderSlotKey
): Promise<Buffer | undefined> {
  const storage = getStorage();
  const project = await storage.loadProject(projectId);
  if (!project) return undefined;
  const name =
    project.blenderRenders?.[slot]?.filename ?? blenderFilenameForSlot(slot);
  return (await storage.readProjectFile(projectId, name)) ?? undefined;
}
