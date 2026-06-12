#!/usr/bin/env bash
# migrate-t1referrall-v7.sh — premium purchase refund columns.
#
# Run once on EC2 after deploying featured refund support:
#   bash ~/Website/deploy/migrate-t1referrall-v7.sh

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

echo "==> Referr-All premium refund columns migration…"
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
    ALTER TABLE t1referrall_premium_purchase
      ADD COLUMN IF NOT EXISTS stripe_payment_intent_id varchar(200)
    """,
    """
    ALTER TABLE t1referrall_premium_purchase
      ADD COLUMN IF NOT EXISTS refund_cents integer
    """,
    """
    ALTER TABLE t1referrall_premium_purchase
      ADD COLUMN IF NOT EXISTS stripe_refund_id varchar(200)
    """,
    """
    ALTER TABLE t1referrall_premium_purchase
      ADD COLUMN IF NOT EXISTS refunded_at timestamp without time zone
    """,
]

with engine.begin() as conn:
    for sql in statements:
        conn.execute(text(sql))
print("OK  premium refund columns ready")
PY

echo "OK  Referr-All v7 migration complete."
