import fs from "fs/promises";
import path from "path";
import type { LegendEntry } from "@/config/legend";
import {
  buildGeometryExportContext,
  type ExportFeature,
  type GeometryExportContext,
} from "@/lib/geometry-export/extract";
import {
  buildContoursDxf,
  buildFeaturesDxf,
  type ContourLine,
} from "@/lib/geometry-export/dxf";
import { buildGeoJson, type Wgs84Point } from "@/lib/geometry-export/geojson";
import { buildKml, buildKmzBuffer } from "@/lib/geometry-export/kml";
import {
  buildStakeoutCsv,
  stakeoutRowsFromFeatures,
} from "@/lib/geometry-export/stakeout-csv";
import { DTM_CACHE_FILENAME } from "@/lib/elevation-service";
import type { Project } from "@/lib/project-schema";
import { runPythonScript } from "@/lib/run-python";

export type GeometryExportFormat =
  | "dxf"
  | "geojson"
  | "kml"
  | "kmz"
  | "stakeout-csv"
  | "contours-dxf";

export type GeometryExportResult = {
  buffer: Buffer;
  contentType: string;
  filename: string;
};

function ldbgRoot(): string {
  return process.cwd();
}

function helpersScript(): string {
  return path.join(ldbgRoot(), "scripts", "geometry_helpers.py");
}

function storageRoot(): string {
  return process.env.LDBG_STORAGE_DIR ?? path.join(ldbgRoot(), "storage");
}

function projectDir(projectId: string): string {
  return path.join(storageRoot(), projectId);
}

async function runHelperJson(args: string[]): Promise<Record<string, unknown>> {
  const { stdout, stderr, code } = await runPythonScript(helpersScript(), args, {
    timeoutMs: 120_000,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout.trim() || "{}") as Record<string, unknown>;
  } catch {
    throw new Error(
      `Geometry helper returned invalid JSON (exit ${code}). ${stderr || stdout}`.slice(
        0,
        500
      )
    );
  }

  if (code !== 0 || parsed.error) {
    throw new Error(String(parsed.error ?? stderr ?? "Geometry helper failed"));
  }

  return parsed;
}

function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "project";
}

async function transformToWgs84(
  ctx: GeometryExportContext
): Promise<Map<string, Wgs84Point[]>> {
  const epsg = ctx.epsg;
  if (!epsg) {
    throw new Error("Project CRS has no EPSG code — cannot build GeoJSON/KML.");
  }

  const out = new Map<string, Wgs84Point[]>();

  for (const feature of ctx.features) {
    const raw = await runHelperJson([
      "wgs84",
      "--epsg",
      String(epsg),
      "--points",
      JSON.stringify(feature.coordinatesMeters),
    ]);
    const points = raw.points as Wgs84Point[];
    out.set(feature.id, points);
  }

  return out;
}

async function sampleElevationsFeet(
  projectId: string,
  features: ExportFeature[]
): Promise<Map<string, (number | null)[]>> {
  const cachePath = path.join(projectDir(projectId), DTM_CACHE_FILENAME);
  try {
    await fs.access(cachePath);
  } catch {
    return new Map();
  }

  const out = new Map<string, (number | null)[]>();
  for (const feature of features) {
    const raw = await runHelperJson([
      "sample-elev",
      "--cache",
      cachePath,
      "--points",
      JSON.stringify(feature.coordinatesMeters),
    ]);
    out.set(feature.id, (raw.elevationsFt as (number | null)[]) ?? []);
  }
  return out;
}

function contoursFromProject(project: Project): ContourLine[] {
  const contours = project.elevationAnalysis?.contours;
  if (!contours?.length) return [];
  return contours.map((c) => ({
    elevationFeet: c.elevationFeet,
    major: c.major,
    coordinates: c.coordinates.map((p) => ({ x: p.x, y: p.y })),
  }));
}

export async function exportProjectGeometry(
  project: Project,
  legend: LegendEntry[],
  format: GeometryExportFormat
): Promise<GeometryExportResult> {
  const built = buildGeometryExportContext(project, legend);
  if ("error" in built) {
    throw new Error(built.error);
  }
  const ctx = built.context;
  const base = slug(ctx.projectTitle);
  const stamp = new Date().toISOString().slice(0, 10);

  switch (format) {
    case "dxf": {
      const text = buildFeaturesDxf(ctx.features, ctx.projectTitle);
      return {
        buffer: Buffer.from(text, "utf8"),
        contentType: "application/dxf",
        filename: `${base}-features-${stamp}.dxf`,
      };
    }
    case "geojson": {
      const wgs = await transformToWgs84(ctx);
      const geojson = buildGeoJson(ctx.features, wgs, ctx.projectTitle);
      return {
        buffer: Buffer.from(JSON.stringify(geojson, null, 2), "utf8"),
        contentType: "application/geo+json",
        filename: `${base}-features-${stamp}.geojson`,
      };
    }
    case "kml": {
      const wgs = await transformToWgs84(ctx);
      const kml = buildKml(ctx.features, wgs, ctx.projectTitle);
      return {
        buffer: Buffer.from(kml, "utf8"),
        contentType: "application/vnd.google-earth.kml+xml",
        filename: `${base}-features-${stamp}.kml`,
      };
    }
    case "kmz": {
      const wgs = await transformToWgs84(ctx);
      const kml = buildKml(ctx.features, wgs, ctx.projectTitle);
      return {
        buffer: buildKmzBuffer(kml),
        contentType: "application/vnd.google-earth.kmz",
        filename: `${base}-features-${stamp}.kmz`,
      };
    }
    case "stakeout-csv": {
      const elevs = await sampleElevationsFeet(project.id, ctx.features);
      const rows = stakeoutRowsFromFeatures(ctx.features, elevs);
      const csv = buildStakeoutCsv(rows);
      return {
        buffer: Buffer.from(csv, "utf8"),
        contentType: "text/csv",
        filename: `${base}-stakeout-${stamp}.csv`,
      };
    }
    case "contours-dxf": {
      const contours = contoursFromProject(project);
      if (!contours.length) {
        throw new Error(
          "No contour data — run elevation analysis first (requires DTM)."
        );
      }
      const text = buildContoursDxf(contours, ctx.projectTitle);
      return {
        buffer: Buffer.from(text, "utf8"),
        contentType: "application/dxf",
        filename: `${base}-contours-${stamp}.dxf`,
      };
    }
    default:
      throw new Error(`Unknown export format: ${format satisfies never}`);
  }
}
