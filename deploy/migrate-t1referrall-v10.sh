#!/usr/bin/env bash
# migrate-t1referrall-v10.sh — account settings columns (2FA, phone, hibernate,
# preferences) plus session metadata for the "where you're signed in" feature.
#
# Run once on EC2 after deploying the Settings feature:
#   bash ~/Website/deploy/migrate-t1referrall-v10.sh
# On the referr-all.com prod checkout:
#   bash ~/website-referrall/deploy/migrate-t1referrall-v10.sh

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

echo "==> Referr-All account/settings columns migration (v10)…"
set -a
# shellcheck disable=SC1090
source "$ENV_DEV"
set +a
"$PYTHON" - <<'PY'
from sqlalchemy import text
from database import engine

if engine is None:
    raise SystemExit("DATABASE_URL not set")

statements = [
    "ALTER TABLE t1referrall_user ADD COLUMN IF NOT EXISTS phone varchar(32) NOT NULL DEFAULT ''",
    "ALTER TABLE t1referrall_user ADD COLUMN IF NOT EXISTS totp_secret varchar(64)",
    "ALTER TABLE t1referrall_user ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false",
    "ALTER TABLE t1referrall_user ADD COLUMN IF NOT EXISTS is_deactivated boolean NOT NULL DEFAULT false",
    "ALTER TABLE t1referrall_user ADD COLUMN IF NOT EXISTS deactivated_at timestamp without time zone",
    "ALTER TABLE t1referrall_user ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE t1referrall_session ADD COLUMN IF NOT EXISTS user_agent varchar(400) NOT NULL DEFAULT ''",
    "ALTER TABLE t1referrall_session ADD COLUMN IF NOT EXISTS ip varchar(64) NOT NULL DEFAULT ''",
    "ALTER TABLE t1referrall_session ADD COLUMN IF NOT EXISTS last_seen_at timestamp without time zone",
]

with engine.begin() as conn:
    for sql in statements:
        conn.execute(text(sql))
print("OK  account/settings columns ready")
PY

echo "OK  Referr-All v10 migration complete."
