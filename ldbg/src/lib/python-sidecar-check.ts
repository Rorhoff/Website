import { resolvePythonCommand, runPythonScript, validatePythonInterpreter } from "@/lib/run-python";

export type SidecarImportCheck = {
  ok: boolean;
  pythonCommand: string;
  error?: string;
  checkedAt: string;
};

let cached: SidecarImportCheck | null = null;

function checkScriptPath(): string {
  return `${process.cwd()}/scripts/check_sidecar_imports.py`.replace(/\\/g, "/");
}

/** Run once per process; verifies cv2/numpy/Pillow for watercolor + registration sidecars. */
export async function verifyPythonSidecarImports(
  force = false
): Promise<SidecarImportCheck> {
  if (cached && !force) return cached;

  const resolution = resolvePythonCommand();
  const pythonCommand = resolution.command;
  const checkedAt = new Date().toISOString();

  try {
    validatePythonInterpreter(resolution);
    const { stdout, stderr, code, pythonCommand: used } = await runPythonScript(
      checkScriptPath(),
      [],
      { timeoutMs: 30_000 }
    );

    let parsed: { ok?: boolean; error?: string };
    try {
      parsed = JSON.parse(stdout.trim() || "{}") as { ok?: boolean; error?: string };
    } catch {
      parsed = {
        ok: false,
        error: `Invalid check script output (exit ${code}): ${stderr || stdout}`.slice(
          0,
          400
        ),
      };
    }

    if (code !== 0 || !parsed.ok) {
      cached = {
        ok: false,
        pythonCommand: used,
        error: parsed.error ?? stderr ?? `Sidecar import check failed (exit ${code})`,
        checkedAt,
      };
      console.error(
        `[ldbg] Python sidecar import check FAILED (${used}): ${cached.error}`
      );
      return cached;
    }

    cached = { ok: true, pythonCommand: used, checkedAt };
    console.info(`[ldbg] Python sidecar imports OK (${used})`);
    return cached;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sidecar import check failed";
    cached = { ok: false, pythonCommand, error: msg, checkedAt };
    console.error(`[ldbg] Python sidecar import check FAILED (${pythonCommand}): ${msg}`);
    return cached;
  }
}

export function getCachedSidecarImportCheck(): SidecarImportCheck | null {
  return cached;
}
