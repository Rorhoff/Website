#!/usr/bin/env bash
# migrate-t1referrall-v9.sh — password reset columns.
#
# Run once on EC2 after deploying password reset support:
#   bash ~/Website/deploy/migrate-t1referrall-v9.sh

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
  /home/ubuntu/Website/.env.dev \
  /home/ubuntu/Website/.env \
  "$ROOT/.env.dev" \
  "$ROOT/.env")" || {
  echo "ERR  No env file found." >&2
  exit 1
}

echo "==> Referr-All password reset columns migration…"
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
    """
    ALTER TABLE t1referrall_user
      ADD COLUMN IF NOT EXISTS password_reset_token varchar(64)
    """,
    """
    ALTER TABLE t1referrall_user
      ADD COLUMN IF NOT EXISTS password_reset_sent_at timestamp without time zone
    """,
]

with engine.begin() as conn:
    for sql in statements:
        conn.execute(text(sql))
print("OK  password reset columns ready")
PY

echo "OK  Referr-All v9 migration complete."
