import type { ExportFeature } from "@/lib/geometry-export/extract";
import type { Wgs84Point } from "@/lib/geometry-export/geojson";

function escXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function coordsKml(points: Wgs84Point[]): string {
  return points
    .map((p) => `${p.lon},${p.lat}${p.z != null ? `,${p.z}` : ""}`)
    .join(" ");
}

export function buildKml(
  features: ExportFeature[],
  wgs84ByFeatureId: Map<string, Wgs84Point[]>,
  projectTitle: string
): string {
  let placemarks = "";

  for (const feature of features) {
    const wgs = wgs84ByFeatureId.get(feature.id);
    if (!wgs?.length) continue;

    const name = escXml(feature.label || feature.featureType);
    const description = escXml(
      `${feature.existing ? "Existing" : "Proposed"} · ${feature.featureType}`
    );

    if (feature.kind === "polygon" && wgs.length >= 3) {
      placemarks += `
    <Placemark>
      <name>${name}</name>
      <description>${description}</description>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>${coordsKml(wgs)} ${wgs[0]!.lon},${wgs[0]!.lat}</coordinates></LinearRing></outerBoundaryIs></Polygon>
    </Placemark>`;
    } else if (feature.kind === "polyline" && wgs.length >= 2) {
      placemarks += `
    <Placemark>
      <name>${name}</name>
      <description>${description}</description>
      <LineString><coordinates>${coordsKml(wgs)}</coordinates></LineString>
    </Placemark>`;
    } else if (feature.kind === "point" && wgs[0]) {
      placemarks += `
    <Placemark>
      <name>${name}</name>
      <description>${description}</description>
      <Point><coordinates>${coordsKml([wgs[0]])}</coordinates></Point>
    </Placemark>`;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escXml(projectTitle)}</name>${placemarks}
  </Document>
</kml>`;
}

export function buildKmzBuffer(kml: string): Buffer {
  const entryName = "doc.kml";
  const fileData = Buffer.from(kml, "utf8");

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  const crc = crc32(fileData);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(fileData.length, 18);
  localHeader.writeUInt32LE(fileData.length, 22);
  localHeader.writeUInt16LE(entryName.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(0, 14);
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(fileData.length, 20);
  centralHeader.writeUInt32LE(fileData.length, 24);
  centralHeader.writeUInt16LE(entryName.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0, 42);

  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(1, 8);
  endRecord.writeUInt16LE(1, 10);
  endRecord.writeUInt32LE(centralHeader.length + entryName.length, 12);
  endRecord.writeUInt32LE(localHeader.length + entryName.length + fileData.length, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([
    localHeader,
    Buffer.from(entryName, "utf8"),
    fileData,
    centralHeader,
    Buffer.from(entryName, "utf8"),
    endRecord,
  ]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
