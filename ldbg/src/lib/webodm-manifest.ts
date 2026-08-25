/** WebODM export manifest — paths relative to task export root. */

export type WebodmManifestEntry = {
  key: string;
  relativePath: string;
  label: string;
  required: boolean;
  /** Shown as "expected" in checklist when not required */
  expected?: boolean;
};

export const WEBODM_MANIFEST: WebodmManifestEntry[] = [
  {
    key: "orthophoto",
    relativePath: "odm_orthophoto/odm_orthophoto.tif",
    label: "Orthophoto GeoTIFF",
    required: true,
  },
  {
    key: "dtm",
    relativePath: "odm_dem/dtm.tif",
    label: "DTM (bare earth)",
    required: false,
    expected: true,
  },
  {
    key: "dsm",
    relativePath: "odm_dem/dsm.tif",
    label: "DSM (surface)",
    required: false,
  },
  {
    key: "pointcloud",
    relativePath: "odm_georeferencing/odm_georeferenced_model.laz",
    label: "Point cloud (LAZ)",
    required: false,
  },
  {
    key: "mesh_obj",
    relativePath: "odm_texturing/odm_textured_model_geo.obj",
    label: "Textured mesh (OBJ)",
    required: false,
  },
  {
    key: "mesh_mtl",
    relativePath: "odm_texturing/odm_textured_model_geo.mtl",
    label: "Textured mesh (MTL)",
    required: false,
  },
  {
    key: "proj",
    relativePath: "odm_georeferencing/proj.txt",
    label: "Projection (proj.txt)",
    required: true,
  },
  {
    key: "gcp",
    relativePath: "gcp_list.txt",
    label: "Ground control points",
    required: false,
  },
  {
    key: "report",
    relativePath: "odm_report/report.pdf",
    label: "Processing report",
    required: false,
  },
  {
    key: "shots",
    relativePath: "shots.geojson",
    label: "Camera positions (shots.geojson)",
    required: false,
  },
];

export function normalizeRelativePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\/+/, "");
}

/** Match uploaded or disk paths to manifest entries. */
export function matchManifestPath(relativePath: string): WebodmManifestEntry | undefined {
  const norm = normalizeRelativePath(relativePath);

  for (const entry of WEBODM_MANIFEST) {
    if (norm === entry.relativePath || norm.endsWith("/" + entry.relativePath)) {
      return entry;
    }
  }

  const base = pathBasename(norm);
  for (const entry of WEBODM_MANIFEST) {
    if (pathBasename(entry.relativePath) !== base) continue;
    const folder = entry.relativePath.split("/")[0];
    if (norm.includes(`${folder}/`)) return entry;
  }

  return undefined;
}

function pathBasename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? p;
}

export function countGcpPoints(gcpText: string): number {
  let count = 0;
  for (const line of gcpText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 3) count += 1;
  }
  return count;
}
