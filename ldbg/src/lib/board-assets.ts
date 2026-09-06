import { withBasePath } from "@/lib/paths";
import { projectFilePathSegments } from "@/lib/image-utils";
import { UTAH_PLANT_PALETTE } from "@/config/utah-plants";

/** Browser preview: same-origin relative path. Puppeteer export: absolute internal URL. */
export function boardProjectFileUrl(
  projectId: string,
  filename: string,
  options: { forExport: boolean }
): string {
  const basePath = (process.env.LDBG_BASE_PATH ?? "").replace(/\/$/, "");
  const rel = `${basePath}/api/projects/${encodeURIComponent(projectId)}/files/${projectFilePathSegments(filename)}`;
  if (options.forExport) {
    const exportBase = (
      process.env.LDBG_EXPORT_BASE_URL ??
      process.env.LDBG_INTERNAL_URL ??
      "http://127.0.0.1:3002"
    ).replace(/\/$/, "");
    return `${exportBase}${rel}`;
  }
  return rel;
}

/** Bundled reference photos in /public/plants (PDF- and preview-safe). */
const PLANT_PHOTO_FILES: Record<string, string> = {
  "lavender-munstead": "lavender-munstead.png",
  "boxwood-bush": "boxwood-bush.png",
  "ornamental-grass-karl-foerster": "karl-foerster.png",
  daylily: "daylily.png",
  "blue-grama-grass": "blue-grama-grass.png",
  "sagebrush-wyoming": "sagebrush-wyoming.png",
  "quaking-aspen": "quaking-aspen.png",
  rabbitbrush: "rabbitbrush.png",
  manzanita: "manzanita.png",
  lantana: "lantana.png",
};

export function resolvePlantPaletteId(commonName: string): string | undefined {
  const cn = commonName.trim().toLowerCase();
  const exact = UTAH_PLANT_PALETTE.find(
    (p) => p.commonName.trim().toLowerCase() === cn
  );
  if (exact) return exact.id;
  const base = cn.split("(")[0]?.trim() ?? cn;
  const byPartial = UTAH_PLANT_PALETTE.find((p) => {
    const name = p.commonName.trim().toLowerCase();
    const nameBase = name.split("(")[0]?.trim() ?? name;
    return (
      name.startsWith(base) ||
      base.startsWith(nameBase) ||
      name.includes(base) ||
      base.includes(nameBase)
    );
  });
  if (byPartial) return byPartial.id;
  if (base.includes("karl") && base.includes("foerster")) {
    return "ornamental-grass-karl-foerster";
  }
  if (base.includes("lavender")) return "lavender-munstead";
  if (base.includes("boxwood")) return "boxwood-bush";
  if (base.includes("daylily")) return "daylily";
  if (base.includes("sagebrush")) return "sagebrush-wyoming";
  if (base.includes("grama")) return "blue-grama-grass";
  return undefined;
}

export function plantPhotoUrl(commonName: string, featureType?: string): string | undefined {
  const byName = resolvePlantPaletteId(commonName);
  if (byName && PLANT_PHOTO_FILES[byName]) {
    return withBasePath(`/plants/${PLANT_PHOTO_FILES[byName]}`);
  }
  if (featureType) {
    const byType = UTAH_PLANT_PALETTE.find((p) => p.featureType === featureType);
    if (byType && PLANT_PHOTO_FILES[byType.id]) {
      return withBasePath(`/plants/${PLANT_PHOTO_FILES[byType.id]}`);
    }
  }
  return undefined;
}
