#!/usr/bin/env bash
# migrate-t1referrall-v11.sh — profile banner_url column.
#
# Run once on EC2 after deploying profile banner support:
#   bash ~/Website/deploy/migrate-t1referrall-v11.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -x /home/ubuntu/app/venv/bin/python ]]; then
  PYTHON=/home/ubuntu/app/venv/bin/python
elif [[ -x "$ROOT/.venv/bin/python" ]]; then
  PYTHON="$ROOT/.venv/bin/python"
elif [[ -x /home/ubuntu/Website/.venv/bin/python ]]; then
  PYTHON=/home/ubuntu/Website/.venv/bin/python
else
  PYTHON=python3
fi

resolve_env_file() {
  local candidate
  for candidate in "$@"; do
    [[ -n "$candidate" && -f "$candidate" ]] && { echo "$candidate"; return 0; }
  done
  return 1
}

ENV_DEV="$(resolve_env_file \
  "${ENV_FILE:-}" \
  "$ROOT/.env.referrall" \
  /home/ubuntu/Website/.env.dev \
  /home/ubuntu/Website/.env \
  "$ROOT/.env.dev" \
  "$ROOT/.env")" || {
  echo "ERR  No env file found." >&2
  exit 1
}

echo "==> Referr-All profile banner_url migration (v11)…"
set -a
# shellcheck disable=SC1090
source "$ENV_DEV"
set +a
"$PYTHON" - <<'PY'
from sqlalchemy import text
from database import engine

if engine is None:
    raise SystemExit("DATABASE_URL not set")

with engine.begin() as conn:
    conn.execute(text(
        "ALTER TABLE t1referrall_user ADD COLUMN IF NOT EXISTS banner_url text NOT NULL DEFAULT ''"
    ))
print("OK  banner_url column ready")
PY

echo "OK  Referr-All v11 migration complete."
