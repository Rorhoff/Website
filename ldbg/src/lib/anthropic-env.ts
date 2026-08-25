import fs from "fs";
import path from "path";

let cachedKey: string | undefined | null = null;

function parseEnvValue(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeEnvKey(rawKey: string): string {
  let key = rawKey.trim();
  if (key.startsWith("export ")) {
    key = key.slice("export ".length).trim();
  }
  return key;
}

function readKeyFromFile(filePath: string): string | undefined {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = normalizeEnvKey(trimmed.slice(0, eq));
      if (key !== "ANTHROPIC_API_KEY") continue;
      const value = parseEnvValue(trimmed.slice(eq + 1));
      if (value) return value;
    }
  } catch {
    // missing or unreadable
  }
  return undefined;
}

/** Env files shared with webapi-dev / AIRevolution (t1airevolution.com). */
function sharedSiteEnvCandidates(cwd: string): string[] {
  return [
    process.env.ENV_FILE,
    path.join(cwd, "..", ".env.dev"),
    path.join(cwd, "..", ".env"),
    "/home/ubuntu/Website/.env.dev",
    "/home/ubuntu/Website/.env",
  ].filter((p): p is string => Boolean(p));
}

/** Resolve Anthropic key from process env or shared site env files (same as AIRevolution). */
export function getAnthropicApiKey(): string | undefined {
  if (cachedKey !== null) {
    return cachedKey || undefined;
  }

  const fromProcess = process.env.ANTHROPIC_API_KEY?.trim();
  if (fromProcess) {
    cachedKey = fromProcess;
    return fromProcess;
  }

  const cwd = process.cwd();
  // Prefer parent site .env.dev (AIRevolution / webapi-dev) before ldbg-local overrides.
  const candidates = [
    ...sharedSiteEnvCandidates(cwd),
    path.join(cwd, ".env.local"),
    path.join(cwd, ".env"),
    "/home/ubuntu/Website/ldbg/.env.local",
  ];

  for (const filePath of candidates) {
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

  const cwd = process.cwd();
  const candidates = [
    ...sharedSiteEnvCandidates(cwd),
    path.join(cwd, ".env.local"),
    path.join(cwd, ".env"),
    "/home/ubuntu/Website/ldbg/.env.local",
  ];

  for (const filePath of candidates) {
    if (readKeyFromFile(filePath)) return filePath;
  }
  return undefined;
}
