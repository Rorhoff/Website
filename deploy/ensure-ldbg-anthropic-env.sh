#!/usr/bin/env bash
# ensure-ldbg-anthropic-env.sh — copy ANTHROPIC_API_KEY from roryportfolio's env into ldbg/.env.local
#
# roryportfolio loads /home/ubuntu/Website/.env (not .env.dev). Next.js prefers ldbg/.env.local
# at runtime; syncing guarantees interpret matches AIRevolution after deploy.
#
# Run on EC2: bash ~/Website/deploy/ensure-ldbg-anthropic-env.sh

set -euo pipefail

ROOT="${ROOT:-/home/ubuntu/Website}"
LDBG_ENV="$ROOT/ldbg/.env.local"

detect_roryportfolio_env() {
  local service part path
  for service in roryportfolio webapi-dev; do
    while read -r part; do
      [[ -z "$part" ]] && continue
      path="${part#:}"
      [[ -f "$path" ]] && { echo "$path"; return 0; }
    done < <(systemctl show "$service" -p EnvironmentFiles --value 2>/dev/null || true)
  done
  for path in "$ROOT/.env" "$ROOT/.env.dev"; do
    [[ -f "$path" ]] && { echo "$path"; return 0; }
  done
  return 1
}

SRC="$(detect_roryportfolio_env || true)"
if [[ -z "$SRC" ]]; then
  echo "WARN  No roryportfolio/webapi-dev env file found — skip LDBG Anthropic sync." >&2
  exit 0
fi

python3 - "$SRC" "$LDBG_ENV" <<'PY'
import os
import re
import sys
from pathlib import Path

src = Path(sys.argv[1])
dst = Path(sys.argv[2])
key = None

if src.is_file():
    for line in src.read_text(encoding="utf-8", errors="replace").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        m = re.match(r"^(?:export\s+)?ANTHROPIC_API_KEY\s*=\s*(.*)$", stripped, re.I)
        if not m:
            continue
        val = m.group(1).strip()
        if (val.startswith('"') and val.endswith('"')) or (
            val.startswith("'") and val.endswith("'")
        ):
            val = val[1:-1]
        if "#" in val and not val.startswith('"'):
            val = val.split("#", 1)[0].strip()
        val = val.strip()
        if val:
            key = val
            break

if not key:
    print(f"WARN  ANTHROPIC_API_KEY not found in {src}", file=sys.stderr)
    sys.exit(0)

lines: list[str] = []
if dst.exists():
    lines = dst.read_text(encoding="utf-8", errors="replace").splitlines()

out: list[str] = []
found = False
for line in lines:
    if re.match(r"^(?:export\s+)?ANTHROPIC_API_KEY\s*=", line.strip(), re.I):
        out.append(f"ANTHROPIC_API_KEY={key}")
        found = True
    else:
        out.append(line)

if not found:
    if out and out[-1].strip():
        out.append("")
    out.append("# Synced from roryportfolio env by deploy/ensure-ldbg-anthropic-env.sh")
    out.append(f"ANTHROPIC_API_KEY={key}")

dst.parent.mkdir(parents=True, exist_ok=True)
dst.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")
os.chmod(dst, 0o600)
print(f"OK  ANTHROPIC_API_KEY synced from {src} → {dst}")
PY
