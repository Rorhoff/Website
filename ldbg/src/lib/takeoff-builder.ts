import type { LegendEntry } from "@/config/legend";
import type { GeorefDisplayContext } from "@/lib/georef-display";
import {
  featureAreaSqFt,
  featurePerimeterLf,
} from "@/lib/feature-geometry";
import type { TakeoffLine } from "@/lib/design-content-schema";
import type { InterpretFeature } from "@/lib/interpret-schema";

const TURF_TYPES = new Set(["lawn", "putting_green", "ornamental_grass"]);

function wasteFactorPct(featureType: string, unit: LegendEntry["unit"]): number {
  if (unit === "each") return 0;
  if (TURF_TYPES.has(featureType)) return 5;
  if (unit === "sqft") return 10;
  if (unit === "lf") return 10;
  return 0;
}

export function buildTakeoff(
  features: InterpretFeature[],
  legend: LegendEntry[],
  imageW: number,
  imageH: number,
  pixelsPerFoot?: number,
  georefCtx?: GeorefDisplayContext
): TakeoffLine[] {
  const lines: TakeoffLine[] = [];
  const canMeasure = georefCtx != null || pixelsPerFoot != null;

  for (const f of features) {
    if (f.existing) continue;
    const entry = legend.find((e) => e.featureType === f.featureType);
    const unit = entry?.unit ?? "sqft";
    const label = f.label || entry?.label || f.featureType;
    let quantity = 0;

    if (unit === "each") {
      quantity = 1;
    } else if (unit === "sqft" && canMeasure) {
      quantity =
        featureAreaSqFt(f, imageW, imageH, pixelsPerFoot, georefCtx) ?? 0;
    } else if (unit === "lf" && canMeasure) {
      quantity =
        featurePerimeterLf(f, imageW, imageH, pixelsPerFoot, georefCtx) ?? 0;
    }

    quantity = Math.round(quantity * 10) / 10;
    const waste = wasteFactorPct(f.featureType, unit);
    const quantityWithWaste =
      waste > 0
        ? Math.round(quantity * (1 + waste / 100) * 10) / 10
        : quantity;

    lines.push({
      featureId: f.id,
      featureType: f.featureType,
      label,
      unit,
      quantity,
      wasteFactorPct: waste,
      quantityWithWaste,
    });
  }

  return lines.sort((a, b) => a.featureType.localeCompare(b.featureType));
}

/** Area quantities only — for design-content prompt (no elevation / slope fields). */
export function takeoffAreasForPrompt(takeoff: TakeoffLine[]): TakeoffLine[] {
  return takeoff.filter((line) => line.unit === "sqft");
}

export function featuresSummaryForPrompt(
  features: InterpretFeature[],
  legend: LegendEntry[]
): string {
  const design = features.filter((f) => !f.existing);
  return JSON.stringify(
    design.map((f) => {
      const entry = legend.find((e) => e.featureType === f.featureType);
      return {
        id: f.id,
        featureType: f.featureType,
        label: f.label || entry?.label,
        kind: f.geometry.kind,
        notes: f.notes,
        defaultMaterial: entry?.defaultMaterial,
      };
    }),
    null,
    2
  );
}
