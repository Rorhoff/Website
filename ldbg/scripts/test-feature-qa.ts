/**
 * Fast unit QA for recently shipped LDBG + shared feature behavior.
 * Add a case here whenever you ship a user-visible feature.
 *
 * Usage: npm run test:feature-qa
 */
import { geminiEnabled, GEMINI_DISABLED_MESSAGE } from "../src/config/ai-features";
import { GENERAL_NOTES } from "../src/config/notes";
import { DEFAULT_LEGEND } from "../src/config/legend";
import { resolvePlanBaseLayer } from "../src/lib/plan-base-layer";
import {
  formatFeatureAreaLabel,
  formatLegendRowMeasure,
  LEGEND_ESTIMATE_DISCLAIMER,
} from "../src/lib/legend-display";
import { buildTakeoff } from "../src/lib/takeoff-builder";
import { getBoardPlanImage, getTracingImage } from "../src/lib/georef";
import { createEmptyProject, PlanSettingsSchema } from "../src/lib/project-schema";
import type { InterpretFeature } from "../src/lib/interpret-schema";
import type { LegendRow } from "../src/lib/plan-layout";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    console.error(` FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

function legendRow(
  partial: Partial<LegendRow> & Pick<LegendRow, "featureType" | "label">
): LegendRow {
  return {
    number: 1,
    featureId: "qa-test",
    areaSqFt: null,
    quantity: null,
    ...partial,
  };
}

function plantPoint(id: string, featureType: string): InterpretFeature {
  return {
    id,
    featureType,
    label: featureType,
    existing: false,
    confidence: 1,
    notes: "",
    geometry: { kind: "point", points: [{ x: 0.5, y: 0.5 }] },
  };
}

function squarePolygon(id: string, featureType: string, size = 0.1): InterpretFeature {
  return {
    id,
    featureType,
    label: featureType,
    existing: false,
    confidence: 1,
    notes: "",
    geometry: {
      kind: "polygon",
      points: [
        { x: 0.5 - size, y: 0.5 - size },
        { x: 0.5 + size, y: 0.5 - size },
        { x: 0.5 + size, y: 0.5 + size },
        { x: 0.5 - size, y: 0.5 + size },
      ],
    },
  };
}

section("Gemini gate (default off)");
{
  const prevServer = process.env.LDBG_GEMINI_ENABLED;
  const prevPublic = process.env.NEXT_PUBLIC_LDBG_GEMINI_ENABLED;
  delete process.env.LDBG_GEMINI_ENABLED;
  delete process.env.NEXT_PUBLIC_LDBG_GEMINI_ENABLED;
  assert(geminiEnabled() === false, "geminiEnabled() is false without env");
  assert(GEMINI_DISABLED_MESSAGE.includes("disabled"), "disabled message mentions off state");
  process.env.LDBG_GEMINI_ENABLED = prevServer;
  process.env.NEXT_PUBLIC_LDBG_GEMINI_ENABLED = prevPublic;
}

section("Legend area ranges (±1 ft calibration band)");
{
  const area = 100;
  const dist = 10;
  const low = Math.round(area * ((dist - 1) / dist) ** 2);
  const high = Math.round(area * ((dist + 1) / dist) ** 2);
  const label = formatFeatureAreaLabel(area, "putting_green", {
    calibrationDistanceFeet: dist,
  });
  assert(label === `${low.toLocaleString()}–${high.toLocaleString()} sq ft`, "putting_green shows sq ft range");
  assert(low === 81 && high === 121, "range math matches 10 ft calibration", `got ${low}–${high}`);

  const row = legendRow({
    featureType: "paver_patio",
    label: "Paver patio",
    areaSqFt: 200,
  });
  const measure = formatLegendRowMeasure(row, DEFAULT_LEGEND, {
    calibrationDistanceFeet: 20,
  });
  assert(measure.includes("–"), "paver_patio legend row uses dash range");
  assert(measure.includes("sq ft"), "paver_patio legend row shows sq ft");
}

section("Decorative footprints (fire pit 3×3, not 9 sq ft)");
{
  const row = legendRow({ featureType: "fire_pit_square", label: "Fire pit", quantity: 1 });
  const measure = formatLegendRowMeasure(row, DEFAULT_LEGEND);
  assert(measure.includes("×") && measure.includes("ft"), "fire pit square shows footprint");
  assert(!measure.includes("9 sq ft"), "fire pit does not show 9 sq ft area");

  const roundRow = legendRow({ featureType: "fire_pit_round", label: "Fire pit", quantity: 1 });
  const roundMeasure = formatLegendRowMeasure(roundRow, DEFAULT_LEGEND);
  assert(roundMeasure.includes("Ø"), "round fire pit shows diameter");
}

section("Takeoff aggregation (one row per feature type)");
{
  const features = [
    plantPoint("p1", "boxwood"),
    plantPoint("p2", "boxwood"),
    plantPoint("p3", "boxwood"),
    squarePolygon("g1", "lawn", 0.2),
    squarePolygon("g2", "lawn", 0.15),
  ];
  const takeoff = buildTakeoff(features, DEFAULT_LEGEND, 1000, 1000, 10);
  const boxwood = takeoff.find((l) => l.featureType === "boxwood");
  const lawn = takeoff.find((l) => l.featureType === "lawn");
  assert(takeoff.filter((l) => l.featureType === "boxwood").length === 1, "single boxwood row");
  assert(boxwood?.quantity === 3, "boxwood quantity sums instances", `qty=${boxwood?.quantity}`);
  assert(takeoff.filter((l) => l.featureType === "lawn").length === 1, "single lawn row");
  assert((lawn?.quantity ?? 0) > 0, "lawn area aggregated");
}

section("Board plan base prefers annotated tracing image");
{
  const project = createEmptyProject("qa-board");
  project.images.annotated = { filename: "annotated.jpg", width: 1200, height: 900 };
  project.images.clean = { filename: "clean-ortho.jpg", width: 4800, height: 3600 };
  project.interpretation = {
    imageSize: { width: 1200, height: 900 },
    features: [],
    siteObservations: [],
    ambiguities: [],
    interpretedAt: "2026-01-01T00:00:00.000Z",
    model: "qa-test",
  };

  const tracing = getTracingImage(project);
  const boardBase = getBoardPlanImage(project);
  assert(tracing?.filename === "annotated.jpg", "tracing resolves to annotated image");
  assert(boardBase?.filename === "annotated.jpg", "board plan base uses tracing/annotated");
}

section("Plan base layer (Gemini off forces style preset off)");
{
  const prev = process.env.LDBG_GEMINI_ENABLED;
  delete process.env.LDBG_GEMINI_ENABLED;

  const styled = resolvePlanBaseLayer(
    PlanSettingsSchema.parse({ stylePreset: "watercolor-plan" }),
    { rawUrl: "/raw.jpg", cleanUrl: "/clean.jpg" }
  );
  assert(styled.stylePreset === "off", "watercolor preset downgrades when Gemini off");
  assert(styled.url === "/raw.jpg", "falls back to raw annotated base");

  process.env.LDBG_GEMINI_ENABLED = prev;
}

section("Board general notes (conceptual disclaimer in catalog)");
{
  const conceptual = GENERAL_NOTES.find((n) => n.text.includes("conceptual design"));
  assert(conceptual != null, "conceptual disclaimer note exists");
  assert(conceptual?.defaultOn === true, "conceptual disclaimer is default-on");
}

section("Legend estimate disclaimer");
{
  assert(
    LEGEND_ESTIMATE_DISCLAIMER.includes("preliminary estimates"),
    "legend disclaimer warns estimates may change"
  );
}

console.log(`\n--- Feature QA: ${passed} passed, ${failed} failed ---\n`);
process.exit(failed > 0 ? 1 : 0);
