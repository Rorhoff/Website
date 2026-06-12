#!/usr/bin/env bash
# migrate-t1referrall-v6.sh — post report table for feed moderation.
#
# Run once on EC2 after deploying report feature:
#   bash ~/Website/deploy/migrate-t1referrall-v6.sh

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

echo "==> Referr-All post report migration…"
set -a
# shellcheck disable=SC1090
source "$ENV_DEV"
set +a
"$PYTHON" - <<'PY'
from sqlalchemy import text
from database import engine

if engine is None:
    raise SystemExit("DATABASE_URL not set")

sql = """
CREATE TABLE IF NOT EXISTS t1referrall_post_report (
  id varchar(36) PRIMARY KEY,
  reporter_id varchar(36) NOT NULL REFERENCES t1referrall_user(id) ON DELETE CASCADE,
  post_kind varchar(16) NOT NULL,
  post_id varchar(36) NOT NULL,
  created_at timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT uq_t1ref_post_report UNIQUE (reporter_id, post_kind, post_id)
)
"""
idx_reporter = """
CREATE INDEX IF NOT EXISTS ix_t1referrall_post_report_reporter_id
  ON t1referrall_post_report (reporter_id)
"""
idx_target = """
CREATE INDEX IF NOT EXISTS ix_t1ref_post_report_target
  ON t1referrall_post_report (post_kind, post_id)
"""

with engine.begin() as conn:
    conn.execute(text(sql))
    conn.execute(text(idx_reporter))
    conn.execute(text(idx_target))
print("OK  t1referrall_post_report table ready")
PY

echo "OK  Referr-All v6 migration complete."
