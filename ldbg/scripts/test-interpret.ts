/**
 * Run Claude interpret against ./samples (annotated orthophoto).
 * Usage: npm run test:interpret
 * Requires ANTHROPIC_API_KEY in .env.local or environment.
 */
import fs from "fs/promises";
import path from "path";
import { config } from "dotenv";
import { runInterpretOnBuffer } from "../src/lib/interpret-service";
import { defaultMetadata } from "../src/lib/project-schema";

config({ path: path.join(process.cwd(), ".env.local") });

const SAMPLES_DIR = path.join(process.cwd(), "samples");

const ANNOTATED_NAMES = [
  "annotated.jpg",
  "annotated.jpeg",
  "annotated.png",
  "orthophoto-annotated.jpg",
];

async function findSampleImage(): Promise<{ file: string; buf: Buffer }> {
  for (const name of ANNOTATED_NAMES) {
    const file = path.join(SAMPLES_DIR, name);
    try {
      const buf = await fs.readFile(file);
      return { file: name, buf };
    } catch {
      /* try next */
    }
  }
  const entries = await fs.readdir(SAMPLES_DIR).catch(() => [] as string[]);
  const image = entries.find((e) => /\.(jpe?g|png|webp)$/i.test(e));
  if (image) {
    return {
      file: image,
      buf: await fs.readFile(path.join(SAMPLES_DIR, image)),
    };
  }
  throw new Error(
    `No sample image in ${SAMPLES_DIR}. Drop annotated.jpg (and optional clean orthophoto) there.`
  );
}

async function main() {
  const { file, buf } = await findSampleImage();
  console.log(`Interpreting sample: samples/${file}\n`);

  const result = await runInterpretOnBuffer(buf, file, {
    ...defaultMetadata(),
    projectTitle: "Sample interpret test",
    notes: "CLI test:interpret run",
  });

  if ("error" in result) {
    console.error("Interpret failed:", result.error);
    if (result.rawResponse) {
      console.error("\n--- raw response ---\n", result.rawResponse);
    }
    process.exit(1);
  }

  console.log(`Features (${result.features.length}):`);
  for (const f of result.features) {
    console.log(
      `  - ${f.id}: ${f.featureType} "${f.label}" conf=${f.confidence.toFixed(2)} ${f.geometry.kind}${f.existing ? " [existing]" : ""}`
    );
  }

  if (result.siteObservations.length) {
    console.log("\nSite observations:");
    for (const s of result.siteObservations) console.log(`  • ${s}`);
  }

  if (result.ambiguities.length) {
    console.log("\nAmbiguities:");
    for (const a of result.ambiguities) console.log(`  ? ${a}`);
  }

  if (result.tokenUsage) {
    console.log(
      `\nTokens: ${result.tokenUsage.input} in / ${result.tokenUsage.output} out` +
        (result.estimatedCostUsd != null
          ? ` (~$${result.estimatedCostUsd.toFixed(4)})`
          : "")
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
