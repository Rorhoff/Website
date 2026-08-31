import { UTAH_PLANT_PALETTE } from "@/config/utah-plants";

/** Stable reference photos (Wikimedia Commons) keyed by palette id. */
const PLANT_REFERENCE_URLS: Record<string, string> = {
  "quaking-aspen":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7a/Populus_tremuloides_001.jpg/320px-Populus_tremuloides_001.jpg",
  "colorado-blue-spruce":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Picea_pungens_tree.jpg/320px-Picea_pungens_tree.jpg",
  "rocky-mountain-juniper":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Juniperus_scopulorum.jpg/320px-Juniperus_scopulorum.jpg",
  "ornamental-grass-karl-foerster":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Calamagrostis_acutiflora_Karl_Foerster.jpg/320px-Calamagrostis_acutiflora_Karl_Foerster.jpg",
  "boxwood-bush":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Buxus_sempervirens_1.jpg/320px-Buxus_sempervirens_1.jpg",
  daylily:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Hemerocallis_fulva_-_Fleurs-2.jpg/320px-Hemerocallis_fulva_-_Fleurs-2.jpg",
  lavender:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Lavandula_angustifolia_flowers.jpg/320px-Lavandula_angustifolia_flowers.jpg",
};

export function plantReferenceImageUrl(
  commonName: string,
  featureType?: string
): string | undefined {
  const cn = commonName.trim().toLowerCase();
  const byName = UTAH_PLANT_PALETTE.find(
    (p) => p.commonName.trim().toLowerCase() === cn
  );
  if (byName && PLANT_REFERENCE_URLS[byName.id]) {
    return PLANT_REFERENCE_URLS[byName.id];
  }
  if (featureType) {
    const byType = UTAH_PLANT_PALETTE.find((p) => p.featureType === featureType);
    if (byType && PLANT_REFERENCE_URLS[byType.id]) {
      return PLANT_REFERENCE_URLS[byType.id];
    }
  }
  return undefined;
}
