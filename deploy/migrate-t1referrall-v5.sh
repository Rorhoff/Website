#!/usr/bin/env bash
# migrate-t1referrall-v5.sh — profile interests + portfolio_url columns.
#
# Run once on EC2 after deploying profile field updates:
#   bash ~/Website/deploy/migrate-t1referrall-v5.sh

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

echo "==> Referr-All profile interests/portfolio migration…"
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
      ADD COLUMN IF NOT EXISTS portfolio_url varchar(500) NOT NULL DEFAULT ''
    """,
    """
    ALTER TABLE t1referrall_user
      ADD COLUMN IF NOT EXISTS interests jsonb NOT NULL DEFAULT '[]'::jsonb
    """,
]

with engine.begin() as conn:
    for sql in statements:
        conn.execute(text(sql))
print("OK  profile interests + portfolio_url columns ready")
PY

echo "OK  Referr-All v5 migration complete."
