import { NextResponse } from "next/server";
import {
  anthropicKeySource,
  isAnthropicConfigured,
} from "@/lib/anthropic-env";
import {
  getCachedSidecarImportCheck,
  verifyPythonSidecarImports,
} from "@/lib/python-sidecar-check";
import { getPythonCommand, getPythonResolution } from "@/lib/run-python";

export async function GET() {
  const configured = isAnthropicConfigured();
  const sidecar =
    getCachedSidecarImportCheck() ?? (await verifyPythonSidecarImports());

  return NextResponse.json({
    anthropicConfigured: configured,
    anthropicKeySource: configured ? anthropicKeySource() : undefined,
    pythonSidecar: {
      ok: sidecar.ok,
      pythonCommand: sidecar.pythonCommand,
      configuredPython: getPythonCommand(),
      pythonResolution: getPythonResolution(),
      error: sidecar.error,
      checkedAt: sidecar.checkedAt,
    },
  });
}
