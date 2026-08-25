import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { GeoreferenceSchema, type Georeference, type Project, type WebodmFileCheck } from "@/lib/project-schema";
import { pixelsPerFootFromGsdMeters } from "@/lib/georef";
import { parseGeotiffFile } from "@/lib/run-python";
import { getStorage } from "@/lib/storage";
import {
  countGcpPoints,
  matchManifestPath,
  normalizeRelativePath,
  WEBODM_MANIFEST,
  type WebodmManifestEntry,
} from "@/lib/webodm-manifest";
import { buildPerformanceAssetsOnIngest } from "@/lib/tile-pyramid-service";

export type IngestFile = {
  relativePath: string;
  data: Buffer;
};

export type WebodmIngestResult =
  | { project: Project }
  | { error: string; checklist?: WebodmFileCheck[] };

const WEBODM_PREFIX = "webodm";
const PREVIEW_FILENAME = "ortho-preview.jpg";

function storedPath(relativePath: string): string {
  return `${WEBODM_PREFIX}/${normalizeRelativePath(relativePath)}`;
}

function buildChecklist(foundPaths: Map<string, string>): WebodmFileCheck[] {
  return WEBODM_MANIFEST.map((entry) => {
    const storedAs = foundPaths.get(entry.key);
    return {
      key: entry.key,
      label: entry.label,
      relativePath: entry.relativePath,
      required: entry.required,
      expected: entry.expected,
      found: !!storedAs,
      storedAs,
    };
  });
}

function resolveUploadedFiles(files: IngestFile[]): Map<string, IngestFile> {
  const byKey = new Map<string, IngestFile>();

  for (const file of files) {
    const norm = normalizeRelativePath(file.relativePath);
    const entry = matchManifestPath(norm);
    if (!entry) continue;

    const existing = byKey.get(entry.key);
    if (!existing || norm.length < existing.relativePath.length) {
      byKey.set(entry.key, { relativePath: entry.relativePath, data: file.data });
    }
  }

  return byKey;
}

async function readFolderFiles(folderPath: string): Promise<IngestFile[]> {
  const abs = path.resolve(folderPath);
  const stat = await fs.stat(abs);
  if (!stat.isDirectory()) {
    throw new Error("folderPath is not a directory");
  }

  const out: IngestFile[] = [];

  async function walk(dir: string, prefix: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full, rel);
      } else if (ent.isFile()) {
        const entry = matchManifestPath(normalizeRelativePath(rel));
        if (entry) {
          out.push({
            relativePath: entry.relativePath,
            data: await fs.readFile(full),
          });
        }
      }
    }
  }

  await walk(abs, "");
  return out;
}

function parseGeorefFromPython(raw: Record<string, unknown>): Georeference {
  const pixelsPerFoot =
    typeof raw.pixelsPerFoot === "number" && raw.pixelsPerFoot > 0
      ? raw.pixelsPerFoot
      : pixelsPerFootFromGsdMeters(Number(raw.gsdMeters));

  return GeoreferenceSchema.parse({
    crs: raw.crs,
    epsg: raw.epsg ?? undefined,
    affine: raw.affine,
    widthPx: raw.widthPx,
    heightPx: raw.heightPx,
    gsdMeters: raw.gsdMeters,
    gsdInches: raw.gsdInches,
    boundsProjected: raw.boundsProjected,
    boundsWgs84: raw.boundsWgs84,
    pixelsPerFoot,
  });
}

export async function ingestWebodmDataset(options: {
  projectId?: string;
  sourceFolder?: string;
  files?: IngestFile[];
}): Promise<WebodmIngestResult> {
  const storage = getStorage();
  const projectId = options.projectId ?? randomUUID();

  let resolvedFiles: Map<string, IngestFile>;
  if (options.files?.length) {
    resolvedFiles = resolveUploadedFiles(options.files);
  } else if (options.sourceFolder) {
    const fromDisk = await readFolderFiles(options.sourceFolder);
    resolvedFiles = resolveUploadedFiles(fromDisk);
  } else {
    return { error: "Provide files or sourceFolder" };
  }

  const foundPaths = new Map<string, string>();
  for (const [key, file] of resolvedFiles) {
    foundPaths.set(key, storedPath(file.relativePath));
  }

  const checklist = buildChecklist(foundPaths);
  const missingRequired = checklist.filter((c) => c.required && !c.found);
  if (missingRequired.length) {
    return {
      error: `Missing required WebODM files: ${missingRequired.map((m) => m.relativePath).join(", ")}`,
      checklist,
    };
  }

  const ortho = resolvedFiles.get("orthophoto")!;
  const proj = resolvedFiles.get("proj");
  const gcp = resolvedFiles.get("gcp");

  // Persist manifest files
  for (const [, file] of resolvedFiles) {
    await storage.saveProjectFile(projectId, storedPath(file.relativePath), file.data);
  }

  const projectDir = path.join(
    process.env.LDBG_STORAGE_DIR ?? path.join(process.cwd(), "storage"),
    projectId
  );
  await fs.mkdir(projectDir, { recursive: true });

  const tifAbs = path.join(projectDir, storedPath(ortho.relativePath));
  const previewAbs = path.join(projectDir, PREVIEW_FILENAME);

  let rawGeo: Record<string, unknown>;
  try {
    rawGeo = await parseGeotiffFile(tifAbs, previewAbs, 4000);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "GeoTIFF parse failed",
      checklist,
    };
  }

  const georeference = parseGeorefFromPython(rawGeo);
  const previewWidth =
    typeof rawGeo.previewWidth === "number" ? rawGeo.previewWidth : georeference.widthPx;
  const previewHeight =
    typeof rawGeo.previewHeight === "number" ? rawGeo.previewHeight : georeference.heightPx;

  let gcpCount = 0;
  if (gcp) {
    gcpCount = countGcpPoints(gcp.data.toString("utf8"));
  }

  const georeferencingMode = gcpCount > 0 ? "gcp" : "gps";

  const now = new Date().toISOString();
  const project: Project = {
    id: projectId,
    version: 1,
    createdAt: now,
    updatedAt: now,
    metadata: {
      clientName: "",
      propertyAddress: "",
      projectTitle: path.basename(options.sourceFolder ?? "WebODM project"),
      designStyle: "Mountain Modern",
      climateZone: "USDA 6b/7a, Salt Lake Valley",
      notes: "",
    },
    images: {
      preview: {
        filename: PREVIEW_FILENAME,
        width: previewWidth,
        height: previewHeight,
      },
      clean: {
        filename: PREVIEW_FILENAME,
        width: previewWidth,
        height: previewHeight,
      },
    },
    georeference,
    webodm: {
      sourceFolder: options.sourceFolder,
      ingestedAt: now,
      checklist,
      georeferencingMode,
      gcpCount: gcpCount > 0 ? gcpCount : undefined,
      orthophotoStoredAs: storedPath(ortho.relativePath),
      projStoredAs: proj ? storedPath(proj.relativePath) : undefined,
    },
    northRotationDeg: 0,
  };

  await storage.saveProject(project);

  console.info(
    `[webodm-ingest] project=${projectId} crs=${georeference.crs} gsd=${georeference.gsdInches.toFixed(3)}in mode=${georeferencingMode}`
  );

  const withPerformance = await buildPerformanceAssetsOnIngest(project);
  return { project: withPerformance };
}

export function missingRequiredFromChecklist(checklist: WebodmFileCheck[]): WebodmManifestEntry[] {
  return WEBODM_MANIFEST.filter((entry) => {
    const row = checklist.find((c) => c.key === entry.key);
    return entry.required && !row?.found;
  });
}
