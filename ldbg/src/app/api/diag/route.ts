import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import path from "path";
import {
  anthropicKeySource,
  isAnthropicConfigured,
} from "@/lib/anthropic-env";
import { INTERPRET_MODEL } from "@/lib/interpret-service";

function puppeteerDepsOk(): boolean {
  try {
    const out = execSync("ldconfig -p 2>/dev/null || true", { encoding: "utf8" });
    return out.includes("libatk-1.0.so");
  } catch {
    return false;
  }
}

function buildRev(): string | undefined {
  try {
    return readFileSync(path.join(process.cwd(), ".ldbg-build-rev"), "utf8").trim();
  } catch {
    return undefined;
  }
}

function staticAssetsOk(): { ok: boolean; buildId?: string; missing?: string[] } {
  try {
    const root = process.cwd();
    const nextDir = path.join(root, ".next");
    const buildId = readFileSync(path.join(nextDir, "BUILD_ID"), "utf8").trim();
    const manifest = JSON.parse(
      readFileSync(path.join(nextDir, "app-build-manifest.json"), "utf8")
    ) as { pages?: Record<string, string[]> };

    const refs = new Set<string>();
    for (const files of Object.values(manifest.pages ?? {})) {
      if (Array.isArray(files)) {
        for (const rel of files) refs.add(rel);
      }
    }
    refs.add(`static/${buildId}/_buildManifest.js`);
    refs.add(`static/${buildId}/_ssgManifest.js`);

    const missing: string[] = [];
    for (const rel of refs) {
      const filePath = path.join(nextDir, rel);
      if (!existsSync(filePath) || statSync(filePath).size === 0) {
        missing.push(rel);
      }
    }

    return {
      ok: missing.length === 0,
      buildId,
      missing: missing.length ? missing.slice(0, 8) : undefined,
    };
  } catch {
    return { ok: false, missing: ["app-build-manifest.json"] };
  }
}

/** Deploy health — confirms Anthropic key + interpret model on the running build. */
export async function GET() {
  const configured = isAnthropicConfigured();
  const staticAssets = staticAssetsOk();
  return NextResponse.json({
    anthropicConfigured: configured,
    anthropicKeySource: configured ? anthropicKeySource() : undefined,
    interpretModel: INTERPRET_MODEL,
    puppeteerDepsOk: puppeteerDepsOk(),
    buildRev: buildRev(),
    staticAssetsOk: staticAssets.ok,
    buildId: staticAssets.buildId,
    missingStaticAssets: staticAssets.missing,
  });
}
