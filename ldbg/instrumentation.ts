import { verifyPythonSidecarImports } from "@/lib/python-sidecar-check";

export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  await verifyPythonSidecarImports();
}
