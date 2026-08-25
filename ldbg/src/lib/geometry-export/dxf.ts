import { vectorworksLayer } from "@/lib/geometry-export/layers";
import type { ExportFeature } from "@/lib/geometry-export/extract";

function esc(value: string): string {
  return value.replace(/\\/g, "\\\\");
}

function dxfPair(code: number, value: string | number): string {
  return `${code}\n${value}\n`;
}

function section(name: string, body: string): string {
  return (
    dxfPair(0, "SECTION") +
    dxfPair(2, name) +
    body +
    dxfPair(0, "ENDSEC") +
    "\n"
  );
}

function uniqueLayers(features: ExportFeature[]): string[] {
  const set = new Set<string>();
  for (const f of features) {
    set.add(vectorworksLayer(f.featureType, f.existing));
  }
  set.add("Contours-Minor");
  set.add("Contours-Major");
  return [...set].sort();
}

function layerTable(layers: string[]): string {
  let out = dxfPair(0, "TABLE") + dxfPair(2, "LAYER") + dxfPair(70, layers.length);
  for (const layer of layers) {
    out +=
      dxfPair(0, "LAYER") +
      dxfPair(2, layer) +
      dxfPair(70, 0) +
      dxfPair(62, 7) +
      dxfPair(6, "Continuous");
  }
  out += dxfPair(0, "ENDTAB") + "\n";
  return out;
}

function lwpolyline(
  layer: string,
  points: { x: number; y: number }[],
  closed: boolean
): string {
  let out =
    dxfPair(0, "LWPOLYLINE") +
    dxfPair(8, layer) +
    dxfPair(90, points.length) +
    dxfPair(70, closed ? 1 : 0);
  for (const p of points) {
    out += dxfPair(10, p.x.toFixed(4)) + dxfPair(20, p.y.toFixed(4));
  }
  return out;
}

function circle(
  layer: string,
  center: { x: number; y: number },
  radiusFeet: number
): string {
  return (
    dxfPair(0, "CIRCLE") +
    dxfPair(8, layer) +
    dxfPair(10, center.x.toFixed(4)) +
    dxfPair(20, center.y.toFixed(4)) +
    dxfPair(40, radiusFeet.toFixed(4))
  );
}

function pointEntity(layer: string, p: { x: number; y: number }): string {
  return (
    dxfPair(0, "POINT") +
    dxfPair(8, layer) +
    dxfPair(10, p.x.toFixed(4)) +
    dxfPair(20, p.y.toFixed(4))
  );
}

export function buildFeaturesDxf(
  features: ExportFeature[],
  projectTitle: string
): string {
  const layers = uniqueLayers(features);

  let entities = "";
  for (const feature of features) {
    const layer = vectorworksLayer(feature.featureType, feature.existing);
    if (feature.kind === "polygon" && feature.coordinatesFeet.length >= 3) {
      entities += lwpolyline(layer, feature.coordinatesFeet, true);
    } else if (feature.kind === "polyline" && feature.coordinatesFeet.length >= 2) {
      entities += lwpolyline(layer, feature.coordinatesFeet, false);
    } else if (feature.kind === "point") {
      const center = feature.coordinatesFeet[0];
      if (feature.radiusFeet && center) {
        entities += circle(layer, center, feature.radiusFeet);
      } else if (center) {
        entities += pointEntity(layer, center);
      }
    }
  }

  const header =
    dxfPair(9, "$ACADVER") +
    dxfPair(1, "AC1015") +
    dxfPair(9, "$INSUNITS") +
    dxfPair(70, 2) +
    dxfPair(9, "$MEASUREMENT") +
    dxfPair(70, 1) +
    dxfPair(9, "$LUPREC") +
    dxfPair(40, 4);

  const tables = section("TABLES", layerTable(layers));

  const entitiesSection = section(
    "ENTITIES",
    entities ||
      dxfPair(0, "COMMENT") +
        dxfPair(999, `Empty export for ${esc(projectTitle)}`) +
        "\n"
  );

  return (
    dxfPair(999, `LDBG geometry export — ${esc(projectTitle)}`) +
    section("HEADER", header) +
    tables +
    entitiesSection +
    dxfPair(0, "EOF") +
    "\n"
  );
}

export type ContourLine = {
  elevationFeet: number;
  major: boolean;
  coordinates: { x: number; y: number }[];
};

/** Contour coordinates from DTM analysis are in projected meters. */
export function buildContoursDxf(
  contours: ContourLine[],
  projectTitle: string
): string {
  const layers = ["Contours-Minor", "Contours-Major"];
  let entities = "";

  for (const contour of contours) {
    if (contour.coordinates.length < 2) continue;
    const layer = contour.major ? "Contours-Major" : "Contours-Minor";
    const points = contour.coordinates.map((c) => ({
      x: c.x * 3.280839895,
      y: c.y * 3.280839895,
    }));
    entities += lwpolyline(layer, points, false);
  }

  const header =
    dxfPair(9, "$ACADVER") +
    dxfPair(1, "AC1015") +
    dxfPair(9, "$INSUNITS") +
    dxfPair(70, 2);

  return (
    dxfPair(999, `LDBG contours — ${esc(projectTitle)}`) +
    section("HEADER", header) +
    section("TABLES", layerTable(layers)) +
    section("ENTITIES", entities) +
    dxfPair(0, "EOF") +
    "\n"
  );
}
