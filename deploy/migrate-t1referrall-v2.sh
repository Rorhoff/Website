#!/usr/bin/env bash
# migrate-t1referrall-v2.sh — allow decimal years of experience (float columns).
#
# Run once on EC2 after deploying models/API that accept fractional years:
#   bash ~/Website/deploy/migrate-t1referrall-v2.sh
#
# Safe to re-run (no-op if columns are already double precision).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -x "$ROOT/.venv/bin/python" ]]; then
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

DEV_CANDIDATES=(
  "${ENV_FILE:-}"
  /home/ubuntu/Website/.env.dev
  /home/ubuntu/Website/.env
  "$ROOT/.env.dev"
  "$ROOT/.env"
)

ENV_DEV="$(resolve_env_file "${DEV_CANDIDATES[@]}")" || {
  echo "ERR  No dev env file found." >&2
  exit 1
}

run_migration() {
  local label="$1"
  local env_file="$2"
  echo "==> Migrating Referr-All experience columns ($label)…"
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
  "$PYTHON" - <<'PY'
from sqlalchemy import text
from database import engine

if engine is None:
    raise SystemExit("DATABASE_URL not set")

statements = [
    """
    ALTER TABLE t1referrall_user
      ALTER COLUMN years_experience TYPE double precision
      USING years_experience::double precision
    """,
    """
    ALTER TABLE t1referrall_seeker_post
      ALTER COLUMN experience_years TYPE double precision
      USING experience_years::double precision
    """,
]

with engine.begin() as conn:
    for sql in statements:
        conn.execute(text(sql))
print("OK  experience columns are double precision")
PY
}

run_migration "dev" "$ENV_DEV"
echo "OK  Referr-All v2 migration complete."
