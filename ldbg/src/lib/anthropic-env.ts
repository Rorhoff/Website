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

function readKeyFromFile(filePath: string): string | undefined {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (key !== "ANTHROPIC_API_KEY") continue;
      const value = parseEnvValue(trimmed.slice(eq + 1));
      if (value) return value;
    }
  } catch {
    // missing or unreadable
  }
  return undefined;
}

/** Resolve Anthropic key from process env or shared site env files (same as other apps). */
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
  const candidates = [
    process.env.ENV_FILE,
    path.join(cwd, ".env.local"),
    path.join(cwd, ".env"),
    path.join(cwd, "..", ".env.dev"),
    path.join(cwd, "..", ".env"),
    "/home/ubuntu/Website/.env.dev",
    "/home/ubuntu/Website/.env",
    "/home/ubuntu/Website/ldbg/.env.local",
  ].filter((p): p is string => Boolean(p));

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
