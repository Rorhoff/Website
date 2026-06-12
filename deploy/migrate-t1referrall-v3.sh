#!/usr/bin/env bash
# migrate-t1referrall-v3.sh — premium purchase table + featured columns for Referr-All.
#
# Run once on EC2 if Stripe webhooks return 500 on checkout.session.completed:
#   bash ~/Website/deploy/migrate-t1referrall-v3.sh
#
# Safe to re-run (uses IF NOT EXISTS).

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
  echo "==> Referr-All premium migration ($label)…"
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
    ALTER TABLE t1referrall_seeker_post
      ADD COLUMN IF NOT EXISTS is_premium boolean NOT NULL DEFAULT false
    """,
    """
    ALTER TABLE t1referrall_seeker_post
      ADD COLUMN IF NOT EXISTS premium_expires_at timestamp without time zone
    """,
    """
    ALTER TABLE t1referrall_seeker_post
      ADD COLUMN IF NOT EXISTS premium_order integer NOT NULL DEFAULT 0
    """,
    """
    CREATE TABLE IF NOT EXISTS t1referrall_premium_purchase (
      id varchar(36) PRIMARY KEY,
      user_id varchar(36) NOT NULL
        REFERENCES t1referrall_user(id) ON DELETE CASCADE,
      seeker_post_id varchar(36)
        REFERENCES t1referrall_seeker_post(id) ON DELETE SET NULL,
      amount_cents integer NOT NULL,
      purchase_number integer NOT NULL,
      stripe_session_id varchar(200) UNIQUE,
      created_at timestamp without time zone NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS ix_t1ref_premium_purchase_user_id
      ON t1referrall_premium_purchase (user_id)
    """,
]

with engine.begin() as conn:
    for sql in statements:
        conn.execute(text(sql))
print("OK  premium tables/columns ready")
PY
}

run_migration "dev" "$ENV_DEV"

echo "==> create_all fallback…"
set -a
# shellcheck disable=SC1090
source "$ENV_DEV"
set +a
"$PYTHON" - <<'PY'
import models  # noqa: F401
from database import Base, engine
if engine is None:
    raise SystemExit("DATABASE_URL not set")
Base.metadata.create_all(bind=engine)
print("OK  create_all finished")
PY

echo "OK  Referr-All v3 migration complete."
echo "     Restart API, then in Stripe resend a failed checkout.session.completed event."
