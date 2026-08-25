import type { ExportFeature } from "@/lib/geometry-export/extract";

export type Wgs84Point = { lon: number; lat: number; z?: number };

export type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  name: string;
  crs?: { type: "name"; properties: { name: string } };
  features: GeoJsonFeature[];
};

export type GeoJsonFeature = {
  type: "Feature";
  properties: Record<string, string | number | boolean>;
  geometry: GeoJsonGeometry;
};

export type GeoJsonGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "LineString"; coordinates: number[][] }
  | { type: "Point"; coordinates: number[] };

export function buildGeoJson(
  features: ExportFeature[],
  wgs84ByFeatureId: Map<string, Wgs84Point[]>,
  projectTitle: string
): GeoJsonFeatureCollection {
  const out: GeoJsonFeature[] = [];

  for (const feature of features) {
    const wgs = wgs84ByFeatureId.get(feature.id);
    if (!wgs?.length) continue;

    const props = {
      id: feature.id,
      featureType: feature.featureType,
      label: feature.label,
      existing: feature.existing,
    };

    if (feature.kind === "polygon" && wgs.length >= 3) {
      const ring = wgs.map((p) =>
        p.z != null ? [p.lon, p.lat, p.z] : [p.lon, p.lat]
      );
      if (
        ring[0]![0] !== ring[ring.length - 1]![0] ||
        ring[0]![1] !== ring[ring.length - 1]![1]
      ) {
        ring.push([...ring[0]!]);
      }
      out.push({
        type: "Feature",
        properties: props,
        geometry: { type: "Polygon", coordinates: [ring] },
      });
    } else if (feature.kind === "polyline" && wgs.length >= 2) {
      out.push({
        type: "Feature",
        properties: props,
        geometry: {
          type: "LineString",
          coordinates: wgs.map((p) =>
            p.z != null ? [p.lon, p.lat, p.z] : [p.lon, p.lat]
          ),
        },
      });
    } else if (feature.kind === "point" && wgs[0]) {
      const p = wgs[0];
      out.push({
        type: "Feature",
        properties: props,
        geometry: {
          type: "Point",
          coordinates: p.z != null ? [p.lon, p.lat, p.z] : [p.lon, p.lat],
        },
      });
    }
  }

  return {
    type: "FeatureCollection",
    name: projectTitle,
    crs: {
      type: "name",
      properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" },
    },
    features: out,
  };
}
