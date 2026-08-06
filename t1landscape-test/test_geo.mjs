import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  processFeature,
  parseGeoJSON,
  maxAbsLocalCoordinate,
} from "../static/t1landscape/geo.js";
import { generateDxf, originCommentText } from "../static/t1landscape/dxf.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, "fixtures", "32103760200000.geojson"), "utf8");
const data = parseGeoJSON(fixture);
const feature = data.features[0];

function assertSegmentConsistency(processed, label) {
  for (const seg of processed.segments) {
    const dx = seg.to.x - seg.from.x;
    const dy = seg.to.y - seg.from.y;
    const dist = Math.hypot(dx, dy);
    assert.ok(
      Math.abs(dist - seg.length) < 0.001,
      `${label}: segment ${seg.fromIndex + 1}->${seg.toIndex + 1} coord dist ${dist} != reported ${seg.length}`
    );
  }
}

function longestSegment(processed) {
  return Math.max(...processed.segments.map((s) => s.length));
}

function parseDxfGroupValues(dxf, code) {
  const lines = dxf.split(/\r?\n/).map((line) => line.trim());
  const values = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i] === String(code)) {
      values.push(parseFloat(lines[i + 1]));
    }
  }
  return values;
}

function parseDxfInsUnits(dxf) {
  const lines = dxf.split(/\r?\n/).map((line) => line.trim());
  for (let i = 0; i < lines.length - 3; i++) {
    if (lines[i] === "9" && lines[i + 1] === "$INSUNITS" && lines[i + 2] === "70") {
      return parseInt(lines[i + 3], 10);
    }
  }
  return null;
}

function assertDxfMatchesModel(processed, label) {
  const dxf = generateDxf(processed, originCommentText(processed));
  const xs = parseDxfGroupValues(dxf, 10);
  const ys = parseDxfGroupValues(dxf, 20);
  assert.ok(xs.length > 0 && ys.length > 0, `${label}: DXF has no vertices`);

  const modelMax = maxAbsLocalCoordinate(processed);
  const dxfMax = Math.max(...xs.map(Math.abs), ...ys.map(Math.abs));
  assert.ok(
    Math.abs(dxfMax - modelMax) < 0.01,
    `${label}: DXF max coord ${dxfMax} != model max ${modelMax}`
  );

  const expectedIns = processed.units === "feet" ? 2 : 6;
  assert.equal(parseDxfInsUnits(dxf), expectedIns, `${label}: $INSUNITS mismatch`);
}

// --- Feet mode ---
const feet = processFeature(feature, { units: "feet", dropShortFt: 0, simplifyFt: 0 });
assertSegmentConsistency(feet, "feet");
assert.ok(Math.abs(longestSegment(feet) - 253.547) < 0.01, `feet longest seg ${longestSegment(feet)}`);
assert.ok(Math.abs(feet.area.primary - 27839) < 5, `feet area sq ft ${feet.area.primary}`);
assert.ok(Math.abs(feet.area.secondary - 0.6391) < 0.0005, `feet acres ${feet.area.secondary}`);
assert.ok(maxAbsLocalCoordinate(feet) > 200, `feet max coord ${maxAbsLocalCoordinate(feet)} should be >200`);
assertDxfMatchesModel(feet, "feet");

// Calibration coords must match segment lengths (the reported bug).
for (const seg of feet.calibration) {
  const dist = Math.hypot(seg.to.x - seg.from.x, seg.to.y - seg.from.y);
  assert.ok(Math.abs(dist - seg.length) < 0.001, `calibration coord mismatch ${dist} vs ${seg.length}`);
}

// --- Meters mode ---
const meters = processFeature(feature, { units: "meters", dropShortFt: 0, simplifyFt: 0 });
assertSegmentConsistency(meters, "meters");
assert.ok(Math.abs(longestSegment(meters) - 77.28) < 0.01, `meters longest seg ${longestSegment(meters)}`);
assert.ok(Math.abs(meters.area.primary - 2586.4) < 1, `meters area sq m ${meters.area.primary}`);
assert.ok(maxAbsLocalCoordinate(meters) < 100, `meters max coord ${maxAbsLocalCoordinate(meters)} should be <100`);
assertDxfMatchesModel(meters, "meters");

// --- Cleanup at maximum ---
const cleaned = processFeature(feature, { units: "feet", dropShortFt: 2, simplifyFt: 1 });
const closed = cleaned.cleanedRings[0].closed;
assert.ok(closed.length >= 4, "closed ring should include repeated first vertex");
assert.equal(closed[0].x, closed[closed.length - 1].x);
assert.equal(closed[0].y, closed[closed.length - 1].y);
const unique = new Set(closed.slice(0, -1).map((p) => `${p.x},${p.y}`));
assert.ok(unique.size >= 3, "polygon must keep at least 3 unique vertices");
assertSegmentConsistency(cleaned, "cleanup");

console.log("t1landscape geo tests passed");
console.log(
  `  feet: longest=${longestSegment(feet).toFixed(3)} ft, area=${feet.area.primary.toFixed(0)} sq ft, maxCoord=${maxAbsLocalCoordinate(feet).toFixed(2)}`
);
console.log(
  `  meters: longest=${longestSegment(meters).toFixed(2)} m, area=${meters.area.primary.toFixed(1)} sq m, maxCoord=${maxAbsLocalCoordinate(meters).toFixed(2)}`
);
