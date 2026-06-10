#!/usr/bin/env bash
# migrate-t1referrall-v1.sh — create T1Referrall tables on RDS (dev + prod DBs).
#
# Run once from EC2 after deploying code that includes t1referrall models:
#   bash deploy/migrate-t1referrall-v1.sh
#
# Uses create_all via Python (same pattern as other features). Safe to re-run.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f /home/ubuntu/Website/.env.dev ]]; then
  ENV_DEV=/home/ubuntu/Website/.env.dev
elif [[ -f "$ROOT/.env.dev" ]]; then
  ENV_DEV="$ROOT/.env.dev"
else
  echo "ERR  No .env.dev found" >&2
  exit 1
fi

run_create() {
  local label="$1"
  local env_file="$2"
  echo "==> Creating T1Referrall tables ($label)…"
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
  python3 - <<'PY'
import credential_service
from database import Base, engine
import models  # noqa: F401 — register all tables

if engine is None:
    raise SystemExit("DATABASE_URL not set")
Base.metadata.create_all(bind=engine)
print("OK  create_all finished")
PY
}

run_create "dev" "$ENV_DEV"

if [[ -f /home/ubuntu/website-prod/.env.prod ]]; then
  run_create "prod" /home/ubuntu/website-prod/.env.prod
fi

echo "OK  T1Referrall migration complete."
