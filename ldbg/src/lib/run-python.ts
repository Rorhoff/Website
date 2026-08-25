import { spawn } from "child_process";
import path from "path";

export type PythonRunResult = {
  stdout: string;
  stderr: string;
  code: number;
};

function ldbgRoot(): string {
  return path.join(process.cwd());
}

export function parseGeotiffScriptPath(): string {
  return path.join(ldbgRoot(), "scripts", "parse_geotiff.py");
}

export function runPythonScript(
  scriptPath: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number }
): Promise<PythonRunResult> {
  const pythonCmd = process.env.LDBG_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  const timeoutMs = options?.timeoutMs ?? 120_000;

  return new Promise((resolve, reject) => {
    const child = spawn(pythonCmd, [scriptPath, ...args], {
      cwd: options?.cwd ?? ldbgRoot(),
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Python script timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
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

  const { stdout, stderr, code } = await runPythonScript(parseGeotiffScriptPath(), args);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout.trim() || "{}") as Record<string, unknown>;
  } catch {
    throw new Error(
      `GeoTIFF parser returned invalid JSON (exit ${code}). ${stderr || stdout}`.slice(0, 500)
    );
  }

  if (code !== 0 || parsed.error) {
    throw new Error(String(parsed.error ?? stderr ?? "GeoTIFF parse failed"));
  }

  return parsed;
}
