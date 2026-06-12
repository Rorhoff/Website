#!/usr/bin/env bash
# migrate-t1referrall-v4.sh — widen avatar_url for inline base64 profile photos.
#
# Run once on EC2 if avatar upload returns 500:
#   bash ~/Website/deploy/migrate-t1referrall-v4.sh

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

echo "==> Referr-All avatar_url column migration…"
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
        "ALTER TABLE t1referrall_user "
        "ALTER COLUMN avatar_url TYPE text "
        "USING avatar_url::text"
    ))
print("OK  t1referrall_user.avatar_url is now text")
PY

echo "OK  Referr-All v4 migration complete. Restart roryportfolio and retry avatar upload."
