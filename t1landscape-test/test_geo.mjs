import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { processFeature, parseGeoJSON, sqMetersToSqFeet, sqFeetToAcres } from "../static/t1landscape/geo.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, "fixtures", "32103760200000.geojson"), "utf8");
const data = parseGeoJSON(fixture);
const feature = data.features[0];

const result = processFeature(feature, { units: "feet", dropShortFt: 0, simplifyFt: 0 });

assert.ok(Math.abs(result.areaSqM - 2586.4) < 5, `sq m expected ~2586.4, got ${result.areaSqM}`);
assert.ok(Math.abs(result.area.primary - 27839) < 150, `sq ft expected ~27839, got ${result.area.primary}`);
assert.ok(Math.abs(result.area.secondary - 0.6391) < 0.02, `acres expected ~0.6391, got ${result.area.secondary}`);

const sqFt = sqMetersToSqFeet(result.areaSqM);
const acres = sqFeetToAcres(sqFt);
assert.ok(Math.abs(acres - 0.6391) < 0.02, `derived acres ${acres}`);

console.log("t1landscape geo tests passed");
console.log(`  area: ${result.areaSqM.toFixed(1)} sq m / ${result.area.primary.toFixed(0)} sq ft / ${result.area.secondary.toFixed(4)} acres`);
