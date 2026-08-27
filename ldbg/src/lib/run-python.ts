import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";

export type PythonRunResult = {
  stdout: string;
  stderr: string;
  code: number;
  pythonCommand: string;
  commandLine: string;
};

export type PythonRunOptions = {
  cwd?: string;
  timeoutMs?: number;
  /** Called for each complete stdout line (without trailing newline). */
  onStdoutLine?: (line: string) => void;
  /** Log the resolved command line at spawn time (default true). */
  logCommand?: boolean;
};

export type PythonResolutionSource = "LDBG_PYTHON" | "process" | "path";

export type PythonResolution = {
  command: string;
  source: PythonResolutionSource;
};

export class PythonInterpreterError extends Error {
  readonly command: string;
  readonly source: PythonResolutionSource;

  constructor(command: string, source: PythonResolutionSource) {
    super(formatMissingPythonError(command, source));
    this.name = "PythonInterpreterError";
    this.command = command;
    this.source = source;
  }
}

function ldbgRoot(): string {
  return path.join(process.cwd());
}

/** Shell-safe-ish display of the full argv (for logs and job JSON). */
export function formatPythonCommandLine(
  pythonCommand: string,
  scriptPath: string,
  args: string[]
): string {
  const quote = (s: string) => (/\s/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
  return [quote(pythonCommand), "-u", quote(scriptPath), ...args.map(quote)].join(" ");
}

function formatMissingPythonError(
  command: string,
  source: PythonResolutionSource
): string {
  switch (source) {
    case "LDBG_PYTHON":
      return `Python interpreter not found at LDBG_PYTHON path: ${command}`;
    case "process":
      return `Python interpreter not found at process executable path: ${command}`;
    case "path":
      return `Python interpreter not found on PATH: ${command}`;
  }
}

function isPythonExecutable(execPath: string): boolean {
  const base = path.basename(execPath).toLowerCase();
  return (
    base === "python" ||
    base === "python3" ||
    base.startsWith("python3.") ||
    /^python\d+(\.\d+)*$/.test(base)
  );
}

/**
 * Resolve the Python interpreter for LDBG sidecar scripts:
 * 1. LDBG_PYTHON env var (if set)
 * 2. process.execPath when the runtime itself is Python
 * 3. python3 (or python on Windows) on PATH
 */
export function resolvePythonCommand(): PythonResolution {
  const fromEnv = process.env.LDBG_PYTHON?.trim();
  if (fromEnv) {
    return { command: fromEnv, source: "LDBG_PYTHON" };
  }

  const execPath = process.execPath;
  if (isPythonExecutable(execPath)) {
    return { command: execPath, source: "process" };
  }

  return {
    command: process.platform === "win32" ? "python" : "python3",
    source: "path",
  };
}

function isPathLike(command: string): boolean {
  return (
    path.isAbsolute(command) ||
    command.includes("/") ||
    command.includes("\\")
  );
}

function interpreterExists(command: string): boolean {
  if (isPathLike(command)) {
    try {
      fs.accessSync(command, fs.constants.X_OK);
      return true;
    } catch {
      return fs.existsSync(command);
    }
  }

  try {
    const lookup = process.platform === "win32" ? "where" : "which";
    const result = spawnSync(lookup, [command], {
      encoding: "utf8",
      windowsHide: true,
    });
    return result.status === 0 && Boolean(result.stdout?.trim());
  } catch {
    return false;
  }
}

/** Fail fast with a clear message when the resolved interpreter is missing. */
export function validatePythonInterpreter(resolution: PythonResolution): void {
  if (!interpreterExists(resolution.command)) {
    throw new PythonInterpreterError(resolution.command, resolution.source);
  }
}

/** Resolved Python command (does not verify the path exists). */
export function getPythonCommand(): string {
  return resolvePythonCommand().command;
}

export function getPythonResolution(): PythonResolution {
  return resolvePythonCommand();
}

export function parseGeotiffScriptPath(): string {
  return path.join(ldbgRoot(), "scripts", "parse_geotiff.py");
}

export function runPythonScript(
  scriptPath: string,
  args: string[],
  options?: PythonRunOptions
): Promise<PythonRunResult> {
  const resolution = resolvePythonCommand();
  validatePythonInterpreter(resolution);
  const pythonCommand = resolution.command;
  const commandLine = formatPythonCommandLine(pythonCommand, scriptPath, args);
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const shouldLog = options?.logCommand !== false;

  if (shouldLog) {
    console.info(`[ldbg] Python spawn: ${commandLine}`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(pythonCommand, ["-u", scriptPath, ...args], {
      cwd: options?.cwd ?? ldbgRoot(),
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let stdoutBuf = "";

    const flushLines = (chunk: string) => {
      stdoutBuf += chunk;
      const parts = stdoutBuf.split("\n");
      stdoutBuf = parts.pop() ?? "";
      for (const line of parts) {
        if (line.length > 0) options?.onStdoutLine?.(line);
      }
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      const err = new Error(
        `Python script timed out after ${timeoutMs}ms (interpreter: ${pythonCommand})`
      );
      Object.assign(err, { pythonCommand, commandLine, stdout, stderr });
      reject(err);
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      flushLines(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      const wrapped = new Error(`${err.message} (interpreter: ${pythonCommand})`);
      Object.assign(wrapped, { pythonCommand, commandLine, stdout, stderr });
      reject(wrapped);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (stdoutBuf.length > 0) options?.onStdoutLine?.(stdoutBuf);
      resolve({
        stdout,
        stderr,
        code: code ?? 1,
        pythonCommand,
        commandLine,
      });
    });
  });
}

export async function parseGeotiffFile(
  tifPath: string,
  previewOut?: string,
  previewMaxEdge = 4000
): Promise<Record<string, unknown>> {
  const args = [tifPath];
  if (previewOut) {
    args.push("--preview-out", previewOut, "--preview-max-edge", String(previewMaxEdge));
  }

  const { stdout, stderr, code, pythonCommand, commandLine } = await runPythonScript(
    parseGeotiffScriptPath(),
    args
  );

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout.trim() || "{}") as Record<string, unknown>;
  } catch {
    throw new Error(
      `GeoTIFF parser returned invalid JSON (exit ${code}, ${commandLine}). ${stderr || stdout}`.slice(
        0,
        500
      )
    );
  }

  if (code !== 0 || parsed.error) {
    throw new Error(
      String(parsed.error ?? stderr ?? "GeoTIFF parse failed") +
        ` (interpreter: ${pythonCommand})`
    );
  }

  return parsed;
}
