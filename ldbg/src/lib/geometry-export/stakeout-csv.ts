import type { ExportFeature } from "@/lib/geometry-export/extract";

export type StakeoutRow = {
  pointId: string;
  northingFt: number;
  eastingFt: number;
  elevationFt: number | null;
  featureLabel: string;
  featureType: string;
  vertexIndex: number;
};

export function buildStakeoutCsv(rows: StakeoutRow[]): string {
  const header =
    "point_id,northing_ft,easting_ft,elevation_ft,feature_label,feature_type,vertex_index";
  const lines = rows.map((r) => {
    const elev =
      r.elevationFt != null && Number.isFinite(r.elevationFt)
        ? r.elevationFt.toFixed(3)
        : "";
    return [
      csvEsc(r.pointId),
      r.northingFt.toFixed(3),
      r.eastingFt.toFixed(3),
      elev,
      csvEsc(r.featureLabel),
      csvEsc(r.featureType),
      String(r.vertexIndex),
    ].join(",");
  });
  return [header, ...lines].join("\r\n") + "\r\n";
}

function csvEsc(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function stakeoutRowsFromFeatures(
  features: ExportFeature[],
  elevationsFt: Map<string, (number | null)[]>
): StakeoutRow[] {
  const rows: StakeoutRow[] = [];

  for (const feature of features) {
    const elevs = elevationsFt.get(feature.id) ?? [];
    feature.coordinatesFeet.forEach((pt, vertexIndex) => {
      rows.push({
        pointId: `${feature.id}-v${vertexIndex + 1}`,
        northingFt: pt.y,
        eastingFt: pt.x,
        elevationFt: elevs[vertexIndex] ?? pt.z ?? null,
        featureLabel: feature.label,
        featureType: feature.featureType,
        vertexIndex: vertexIndex + 1,
      });
    });
  }

  return rows;
}
