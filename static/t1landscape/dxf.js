import { fmtNum } from "./geo.js";

function insUnitsCode(units) {
  if (units === "feet") return 2;
  if (units === "meters") return 6;
  return 2;
}

function dxfPair(code, value) {
  return `${code}\n${value}\n`;
}

function polylineEntity(layer, points, units) {
  let out = dxfPair(0, "POLYLINE");
  out += dxfPair(8, layer);
  out += dxfPair(66, 1);
  out += dxfPair(70, 1);
  for (const p of points) {
    out += dxfPair(0, "VERTEX");
    out += dxfPair(8, layer);
    out += dxfPair(10, fmtNum(p.x, 4));
    out += dxfPair(20, fmtNum(p.y, 4));
    out += dxfPair(30, "0.0000");
  }
  out += dxfPair(0, "SEQEND");
  out += dxfPair(8, layer);
  return out;
}

export function generateDxf(processed, originComment) {
  const { cleanedRings, ringMeta, units } = processed;
  let dxf = "";
  dxf += dxfPair(0, "SECTION");
  dxf += dxfPair(2, "HEADER");
  dxf += dxfPair(9, "$ACADVER");
  dxf += dxfPair(1, "AC1009");
  dxf += dxfPair(9, "$INSUNITS");
  dxf += dxfPair(70, insUnitsCode(units));
  dxf += dxfPair(999, originComment);
  dxf += dxfPair(0, "ENDSEC");
  dxf += dxfPair(0, "SECTION");
  dxf += dxfPair(2, "ENTITIES");

  cleanedRings.forEach((ringWrap, idx) => {
    const layer = ringMeta[idx].isHole ? "PARCEL_HOLE" : "PARCEL";
    dxf += polylineEntity(layer, ringWrap.open, units);
  });

  dxf += dxfPair(0, "ENDSEC");
  dxf += dxfPair(0, "EOF");
  return dxf;
}

export function originCommentText(processed) {
  const { originX, originY, zone, units } = processed;
  const unitLabel = units === "feet" ? "meters (UTM)" : "meters";
  return (
    `T1Landscape origin offset — UTM zone ${zone}: ` +
    `min easting=${fmtNum(originX, 4)}, min northing=${fmtNum(originY, 4)} ${unitLabel}. ` +
    `Local geometry translated so min X/Y = 0,0.`
  );
}
