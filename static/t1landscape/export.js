import { fmtNum, metersToFeet } from "./geo.js";

export function calibrationText(processed) {
  const { calibration, units } = processed;
  const unitLabel = units === "feet" ? "ft" : "m";
  const lines = [
    "VizTerra scale calibration reference",
    "Use two known distances from this parcel underlay:",
    "",
  ];
  calibration.forEach((seg, i) => {
    lines.push(`Reference ${i + 1}:`);
    lines.push(
      `  Vertex ${seg.fromIndex + 1} (${fmtNum(seg.from.x, 2)}, ${fmtNum(seg.from.y, 2)}) ` +
        `→ Vertex ${seg.toIndex + 1} (${fmtNum(seg.to.x, 2)}, ${fmtNum(seg.to.y, 2)})`
    );
    lines.push(`  Length: ${fmtNum(seg.length, 4)} ${unitLabel}`);
    lines.push(`  Bearing from north: ${fmtNum(seg.bearing, 2)}°`);
    lines.push("");
  });
  return lines.join("\n");
}

export function generateKml(feature, rings4326) {
  const props = feature.properties || {};
  const name = props.PARCEL_ID || props.PARCEL_ADD || "Parcel boundary";
  const desc = Object.entries(props)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  const ring = rings4326[0];
  const coords = ring
    .map(({ lon, lat }) => `${lon},${lat},0`)
    .join(" ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>${escapeXml(name)}</name>
      <description>${escapeXml(desc)}</description>
      <Style>
        <LineStyle><color>ff0088ff</color><width>2</width></LineStyle>
        <PolyStyle><color>660088ff</color></PolyStyle>
      </Style>
      <Polygon>
        <tessellate>1</tessellate>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${coords}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function generateCsv(processed) {
  const { cleanedRings, units, originX, originY, zone } = processed;
  const unitLabel = units === "feet" ? "ft" : "m";
  const lines = [
    [
      "ring",
      "index",
      "local_x",
      "local_y",
      "utm_easting",
      "utm_northing",
      "longitude",
      "latitude",
      "segment_length_to_next",
      "segment_bearing_to_next",
    ].join(","),
  ];

  cleanedRings.forEach((ringWrap, ringIdx) => {
    const open = ringWrap.open;
    for (let i = 0; i < open.length; i++) {
      const p = open[i];
      const j = (i + 1) % open.length;
      const n = open[j];
      const dx = n.x - p.x;
      const dy = n.y - p.y;
      const lenM = Math.hypot(dx, dy);
      const lenDisplay = units === "feet" ? metersToFeet(lenM) : lenM;
      const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
      const localX = units === "feet" ? metersToFeet(p.x) : p.x;
      const localY = units === "feet" ? metersToFeet(p.y) : p.y;
      lines.push(
        [
          ringIdx,
          i + 1,
          fmtNum(localX, 4),
          fmtNum(localY, 4),
          fmtNum(p.x + originX, 4),
          fmtNum(p.y + originY, 4),
          fmtNum(p.lon, 8),
          fmtNum(p.lat, 8),
          fmtNum(lenDisplay, 4),
          fmtNum(bearing, 2),
        ].join(",")
      );
    }
  });

  return lines.join("\n");
}

export function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  triggerDownload(filename, blob);
}

export function triggerDownload(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
