#!/usr/bin/env bash
# ensure-ldbg-python-env.sh — set LDBG_PYTHON in Website/.env for LDBG Python sidecars.
#
# Resolution order in run-python.ts matches: LDBG_PYTHON → process Python → python3 on PATH.
# On EC2 the main app venv is typically /home/ubuntu/app/venv (same as webapi uvicorn).
#
# Run on EC2: bash ~/Website/deploy/ensure-ldbg-python-env.sh

set -euo pipefail

ROOT="${ROOT:-/home/ubuntu/Website}"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"

detect_python() {
  local candidate
  for candidate in \
    "${LDBG_PYTHON:-}" \
    "/home/ubuntu/app/venv/bin/python" \
    "$ROOT/.venv/bin/python"; do
    [[ -n "$candidate" && -x "$candidate" ]] && { echo "$candidate"; return 0; }
  done
  return 1
}

PY="$(detect_python || true)"
if [[ -z "$PY" ]]; then
  echo "WARN  No LDBG Python venv found — set LDBG_PYTHON in $ENV_FILE manually." >&2
  exit 0
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "# LDBG Python sidecars (watercolor, registration, geo ingest)" >> "$ENV_FILE"
  echo "LDBG_PYTHON=$PY" >> "$ENV_FILE"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  echo "OK  Created $ENV_FILE with LDBG_PYTHON=$PY"
  exit 0
fi

python3 - "$ENV_FILE" "$PY" <<'PY'
import re
import sys
from pathlib import Path

env_path = Path(sys.argv[1])
py = sys.argv[2]
lines = env_path.read_text(encoding="utf-8", errors="replace").splitlines()

out: list[str] = []
found = False
for line in lines:
    stripped = line.strip()
    if re.match(r"^(?:export\s+)?LDBG_PYTHON\s*=", stripped, re.I):
        out.append(f"LDBG_PYTHON={py}")
        found = True
    else:
        out.append(line)

if not found:
    if out and out[-1].strip():
        out.append("")
    out.append("# LDBG Python sidecars (watercolor, registration, geo ingest)")
    out.append(f"LDBG_PYTHON={py}")

env_path.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")
print(f"OK  LDBG_PYTHON={py} in {env_path}")
PY
