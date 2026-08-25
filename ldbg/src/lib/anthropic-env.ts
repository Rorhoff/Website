import dotenv from "dotenv";
import fs from "fs";
import path from "path";

let cachedKey: string | undefined | null = null;

/** Same env files as roryportfolio (AIRevolution) on EC2 — .env first, not .env.dev. */
function siteEnvCandidates(cwd: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (p: string | undefined) => {
    if (!p || seen.has(p)) return;
    seen.add(p);
    out.push(p);
  };

  // Production: key lives in roryportfolio's .env (confirmed via /api/airevolution/status).
  add("/home/ubuntu/Website/.env");
  add("/home/ubuntu/Website/.env.dev");
  add(process.env.ENV_FILE);
  add(path.resolve(cwd, "..", ".env"));
  add(path.resolve(cwd, "..", ".env.dev"));
  add(path.resolve(cwd, ".env.local"));
  add(path.resolve(cwd, ".env"));
  add("/home/ubuntu/Website/ldbg/.env.local");

  return out;
}

function readKeyFromFile(filePath: string): string | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const parsed = dotenv.parse(fs.readFileSync(filePath));
    for (const [rawKey, rawValue] of Object.entries(parsed)) {
      const key = rawKey.trim().replace(/^export\s+/i, "");
      if (key !== "ANTHROPIC_API_KEY") continue;
      const value = rawValue.trim();
      if (value) return value;
    }
  } catch {
    // unreadable
  }
  return undefined;
}

/** Resolve Anthropic key — same ANTHROPIC_API_KEY as AIRevolution / roryportfolio. */
export function getAnthropicApiKey(): string | undefined {
  if (cachedKey !== null) {
    return cachedKey || undefined;
  }

  const fromProcess = process.env.ANTHROPIC_API_KEY?.trim();
  if (fromProcess) {
    cachedKey = fromProcess;
    return fromProcess;
  }

  for (const filePath of siteEnvCandidates(process.cwd())) {
    const key = readKeyFromFile(filePath);
    if (key) {
      cachedKey = key;
      return key;
    }
  }

  cachedKey = "";
  return undefined;
}

/** For diagnostics — never log the return value. */
export function anthropicKeySource(): string | undefined {
  const fromProcess = process.env.ANTHROPIC_API_KEY?.trim();
  if (fromProcess) return "process.env.ANTHROPIC_API_KEY";

  for (const filePath of siteEnvCandidates(process.cwd())) {
    if (readKeyFromFile(filePath)) return filePath;
  }
  return undefined;
}

export function isAnthropicConfigured(): boolean {
  return Boolean(getAnthropicApiKey());
}
