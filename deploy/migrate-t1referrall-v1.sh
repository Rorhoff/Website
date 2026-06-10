#!/usr/bin/env bash
# migrate-t1referrall-v1.sh — create T1Referrall tables on RDS (dev + prod DBs).
#
# Run once from EC2 after deploying code that includes t1referrall models:
#   bash ~/Website/deploy/migrate-t1referrall-v1.sh
#
# Env file (first match wins):
#   ENV_FILE=...   or  /home/ubuntu/Website/.env.dev  or  /home/ubuntu/Website/.env
#
# Uses create_all via Python (same pattern as other features). Safe to re-run.

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

if [[ -n "${DATABASE_URL:-}" ]]; then
  ENV_DEV=""
else
  ENV_DEV="$(resolve_env_file "${DEV_CANDIDATES[@]}")" || {
    echo "ERR  No dev env file found. Checked:" >&2
    for candidate in "${DEV_CANDIDATES[@]}"; do
      [[ -n "$candidate" ]] && echo "       $candidate" >&2
    done
    echo "       Set ENV_FILE=/path/to/env or export DATABASE_URL, then re-run." >&2
    exit 1
  }
fi

run_create() {
  local label="$1"
  local env_file="${2:-}"
  echo "==> Creating T1Referrall tables ($label)…"
  if [[ -n "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
  "$PYTHON" - <<'PY'
import credential_service
from database import Base, engine
import models  # noqa: F401 — register all tables

if engine is None:
    raise SystemExit("DATABASE_URL not set")
Base.metadata.create_all(bind=engine)
print("OK  create_all finished")
PY
}

if [[ -n "$ENV_DEV" ]]; then
  run_create "dev" "$ENV_DEV"
else
  run_create "dev"
fi

PROD_CANDIDATES=(
  "${ENV_FILE_PROD:-}"
  /home/ubuntu/website-prod/.env.prod
  /home/ubuntu/Website/.env.prod
)
ENV_PROD="$(resolve_env_file "${PROD_CANDIDATES[@]}")" || true
if [[ -n "$ENV_PROD" ]]; then
  run_create "prod" "$ENV_PROD"
fi

echo "OK  T1Referrall migration complete."
