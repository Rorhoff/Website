import type { LegendEntry } from "@/config/legend";
import { UTAH_PLANT_PALETTE, isPlantPointFeatureType } from "@/config/utah-plants";
import type { PlantEntry } from "@/lib/design-content-schema";
import type { InterpretFeature } from "@/lib/interpret-schema";

/** Plants actually placed in the design (from feature markers). */
export function derivePlantsFromFeatures(
  features: InterpretFeature[]
): PlantEntry[] {
  const seen = new Set<string>();
  const out: PlantEntry[] = [];

  for (const f of features) {
    if (f.existing || f.featureType === "property_boundary") continue;
    if (!isPlantPointFeatureType(f.featureType) && f.geometry.kind !== "point") {
      continue;
    }
    const palette = UTAH_PLANT_PALETTE.find(
      (p) =>
        p.featureType === f.featureType ||
        p.commonName.toLowerCase() === f.label.trim().toLowerCase()
    );
    const key = palette?.id ?? `${f.featureType}:${f.label}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (palette) {
      out.push({
        commonName: palette.commonName,
        botanicalName: palette.botanicalName,
        matureSize: `${palette.canopyDiameterFt} ft spread (typical install)`,
        waterNeeds: palette.water,
        sunExposure: palette.sun,
        whyChosen: "Used in this design",
        placement: f.id,
      });
    } else if (f.label) {
      out.push({
        commonName: f.label,
        botanicalName: f.featureType.replace(/_/g, " "),
        matureSize: "—",
        waterNeeds: "—",
        sunExposure: "—",
        whyChosen: "Used in this design",
        placement: f.id,
      });
    }
  }

  return out;
}

/** Keep only design-content plant rows that match plants used in features. */
export function filterPlantsToFeatures(
  plants: PlantEntry[],
  features: InterpretFeature[],
  legend: LegendEntry[]
): PlantEntry[] {
  const derived = derivePlantsFromFeatures(features);
  if (derived.length === 0) return [];

  const usedLabels = new Set(
    derived.map((p) => p.commonName.trim().toLowerCase())
  );
  const usedTypes = new Set(
    features
      .filter((f) => !f.existing && isPlantPointFeatureType(f.featureType))
      .map((f) => f.featureType)
  );

  const fromContent = plants.filter((p) => {
    const cn = p.commonName.trim().toLowerCase();
    if (usedLabels.has(cn)) return true;
    const entry = legend.find(
      (e) =>
        e.label.trim().toLowerCase() === cn ||
        e.featureType === p.placement
    );
    if (entry && usedTypes.has(entry.featureType)) return true;
    return derived.some(
      (d) => d.commonName.trim().toLowerCase() === cn
    );
  });

  if (fromContent.length > 0) {
    const seen = new Set<string>();
    return fromContent.filter((p) => {
      const k = p.commonName.trim().toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  return derived;
}

export function legendEntryForPlant(
  plant: PlantEntry,
  legend: LegendEntry[]
): LegendEntry | undefined {
  const cn = plant.commonName.trim().toLowerCase();
  const byLabel = legend.find((e) => e.label.trim().toLowerCase() === cn);
  if (byLabel) return byLabel;
  const palette = UTAH_PLANT_PALETTE.find(
    (p) => p.commonName.trim().toLowerCase() === cn
  );
  if (palette) {
    return legend.find((e) => e.featureType === palette.featureType);
  }
  return undefined;
}
