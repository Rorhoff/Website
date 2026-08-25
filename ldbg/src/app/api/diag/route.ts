import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { readFileSync } from "fs";
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

/** Deploy health — confirms Anthropic key + interpret model on the running build. */
export async function GET() {
  const configured = isAnthropicConfigured();
  return NextResponse.json({
    anthropicConfigured: configured,
    anthropicKeySource: configured ? anthropicKeySource() : undefined,
    interpretModel: INTERPRET_MODEL,
    puppeteerDepsOk: puppeteerDepsOk(),
    buildRev: buildRev(),
  });
}
