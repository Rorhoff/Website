import fs from "fs/promises";
import os from "os";
import path from "path";
import sharp from "sharp";
import { getPixelsPerFoot } from "@/lib/georef";
import { getGeorefDisplayContext } from "@/lib/georef-display";
import { convertFeaturesToProjected } from "@/lib/feature-georef";
import {
  ClaudeInterpretationResultSchema,
  normalizeInterpretationToOriginal,
  type InterpretFeature,
  type StoredInterpretation,
} from "@/lib/interpret-schema";
import type { InterpretFeature as Feature } from "@/lib/interpret-schema";
import type { Project } from "@/lib/project-schema";
import { runPythonScript } from "@/lib/run-python";
import { getAnnotationPalette, getStorage } from "@/lib/storage";
import { nameImportedFeatures } from "@/lib/interpret-naming";

export const CV_IMPORT_MASK_FILENAME = "annotation-mask.png";

function extractAnnotationsScriptPath(): string {
  return path.join(process.cwd(), "scripts", "extract_annotations.py");
}

function isNormalizedPolygon(
  f: Feature
): f is Feature & { geometry: { kind: "polygon"; points: { x: number; y: number }[] } } {
  return (
    f.geometry.kind === "polygon" &&
    "points" in f.geometry &&
    Array.isArray(f.geometry.points)
  );
}

function isHouseFeature(f: Feature): boolean {
  const t = f.featureType.toLowerCase();
  return (
    f.existing &&
    (t.includes("house") || t.includes("roof") || t === "existing_house")
  );
}

function boundaryFeature(project: Project): Feature | undefined {
  return (project.features ?? []).find((f) => f.featureType === "property_boundary");
}

function houseFeature(project: Project): Feature | undefined {
  return (project.features ?? []).find(isHouseFeature);
}

function polygonToJson(f: Feature | undefined): { points: { x: number; y: number }[] } | null {
  if (!f || !isNormalizedPolygon(f)) return null;
  return { points: f.geometry.points };
}

export type CvImportFailure = { error: string };
export type CvImportSuccess = {
  interpretation: StoredInterpretation;
  cached: false;
};

export async function runCvImportForProject(
  projectId: string,
  options?: { force?: boolean; nameWithLlm?: boolean }
): Promise<CvImportSuccess | CvImportFailure> {
  const storage = getStorage();
  const project = await storage.loadProject(projectId);
  if (!project) return { error: "Project not found" };

  const annotated = project.images.annotated;
  if (!annotated) {
    return {
      error:
        "Upload annotated and clean orthophotos first — both are required for CV import.",
    };
  }

  const boundary = boundaryFeature(project);
  if (!boundary) {
    return {
      error:
        "Draw a property boundary polygon (feature type property_boundary) before running import.",
    };
  }

  if (!options?.force && project.interpretation) {
    return { interpretation: project.interpretation, cached: false };
  }

  const annPath = path.join(
    process.env.LDBG_STORAGE_DIR ?? path.join(process.cwd(), "storage"),
    projectId,
    annotated.filename
  );
  const clean = project.images.clean;
  const cleanPath = clean
    ? path.join(
        process.env.LDBG_STORAGE_DIR ?? path.join(process.cwd(), "storage"),
        projectId,
        clean.filename
      )
    : null;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ldbg-cv-"));
  const palettePath = path.join(tmpDir, "palette.json");
  const outJson = path.join(tmpDir, "result.json");
  const maskOut = path.join(tmpDir, "mask.png");
  const boundaryPath = path.join(tmpDir, "boundary.json");
  const housePath = path.join(tmpDir, "house.json");

  try {
    const palette = await getAnnotationPalette();
    await fs.writeFile(palettePath, JSON.stringify(palette), "utf8");
    await fs.writeFile(boundaryPath, JSON.stringify(polygonToJson(boundary)), "utf8");
    const house = houseFeature(project);
    if (house) {
      await fs.writeFile(housePath, JSON.stringify(polygonToJson(house)), "utf8");
    }

    const ppf = getPixelsPerFoot(project);
    const args = [
      "--annotated",
      annPath,
      "--palette",
      palettePath,
      "--out-json",
      outJson,
      "--mask-out",
      maskOut,
      "--boundary",
      boundaryPath,
      "--min-area-sqft",
      "4",
    ];
    if (cleanPath) args.push("--clean", cleanPath);
    if (house && (await fs.stat(housePath).catch(() => null))) {
      args.push("--house", housePath);
    }
    if (ppf) args.push("--pixels-per-foot", String(ppf));

    const { stdout, stderr, code } = await runPythonScript(
      extractAnnotationsScriptPath(),
      args,
      { timeoutMs: 300_000 }
    );

    let meta: { ok?: boolean; error?: string } = {};
    try {
      meta = JSON.parse(stdout.trim() || "{}") as typeof meta;
    } catch {
      return { error: `CV extractor returned invalid JSON: ${stderr || stdout}`.slice(0, 400) };
    }
    if (code !== 0 || meta.error) {
      return { error: meta.error ?? stderr ?? "CV extraction failed" };
    }

    const raw = JSON.parse(await fs.readFile(outJson, "utf8")) as Record<string, unknown>;
    const parsed = ClaudeInterpretationResultSchema.parse({
      imageSize: raw.imageSize,
      features: raw.features,
      siteObservations: raw.siteObservations ?? [],
      ambiguities: [...(raw.ambiguities as string[] ?? []), ...(raw.warnings as string[] ?? [])],
    });

    const annBuf = await storage.readProjectFile(projectId, annotated.filename);
    if (!annBuf) return { error: "Annotated image missing on disk" };
    const dims = await sharp(annBuf).metadata();
    const coordWidth = dims.width ?? annotated.width;
    const coordHeight = dims.height ?? annotated.height;

    let normalized = normalizeInterpretationToOriginal(parsed, coordWidth, coordHeight);

    if (options?.nameWithLlm !== false) {
      normalized = {
        ...normalized,
        features: await nameImportedFeatures(projectId, normalized.features, annBuf),
      };
    }

    const georefCtx = getGeorefDisplayContext(project, coordWidth, coordHeight);
    let features: InterpretFeature[] = normalized.features;
    if (georefCtx) {
      features = convertFeaturesToProjected(
        normalized.features,
        coordWidth,
        coordHeight,
        georefCtx
      );
    }

    const maskBuf = await fs.readFile(maskOut);
    await storage.saveProjectFile(projectId, CV_IMPORT_MASK_FILENAME, maskBuf);

    const now = new Date().toISOString();
    const interpretation: StoredInterpretation = {
      ...normalized,
      features,
      interpretedAt: now,
      model: "cv-pipeline",
      method: "cv",
      importMaskFilename: CV_IMPORT_MASK_FILENAME,
      interpretImageSpace: {
        coordWidth,
        coordHeight,
        sentWidth: coordWidth,
        sentHeight: coordHeight,
        downscaleFactor: 1,
        storedAnnotatedWidth: annotated.width,
        storedAnnotatedHeight: annotated.height,
      },
    };

    project.interpretation = interpretation;
    project.features = features;
    project.updatedAt = now;
    await storage.saveProject(project);

    return { interpretation, cached: false };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
