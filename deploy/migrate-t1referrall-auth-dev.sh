#!/usr/bin/env bash
# migrate-t1referrall-auth-dev.sh — fix dev login 503 (missing v10/v11 auth columns).
#
# Run on EC2:
#   bash ~/Website/deploy/migrate-t1referrall-auth-dev.sh
#
# Uses the same DATABASE_URL as the roryportfolio / webapi-dev systemd unit when possible.

set -euo pipefail

ROOT="${ROOT:-/home/ubuntu/Website}"
cd "$ROOT"

if [[ -z "${PYTHON:-}" ]] || [[ ! -x "${PYTHON}" ]]; then
  if [[ -x /home/ubuntu/app/venv/bin/python ]]; then
    PYTHON=/home/ubuntu/app/venv/bin/python
  elif [[ -x "$ROOT/.venv/bin/python" ]]; then
    PYTHON="$ROOT/.venv/bin/python"
  else
    PYTHON=python3
  fi
fi
export PYTHON ROOT

if [[ -z "${ENV_FILE:-}" ]]; then
  if [[ -f /home/ubuntu/Website/.env.dev ]]; then
    export ENV_FILE=/home/ubuntu/Website/.env.dev
  elif [[ -f /home/ubuntu/Website/.env ]]; then
    export ENV_FILE=/home/ubuntu/Website/.env
  fi
fi

echo "==> Dev auth migrations (v10 + v11)"
echo "    ROOT=$ROOT"
echo "    PYTHON=$PYTHON"
echo "    ENV_FILE=${ENV_FILE:-<from systemd via referrall-migrate-db.py>}"

"$PYTHON" "$ROOT/deploy/referrall-migrate-db.py" --print-url | sed 's/:\/\/[^@]*@/:\/\/***@/'

bash "$ROOT/deploy/migrate-t1referrall-v10.sh"
bash "$ROOT/deploy/migrate-t1referrall-v11.sh"

echo "==> Verifying auth columns…"
"$PYTHON" "$ROOT/deploy/referrall-migrate-db.py" --print-url >/dev/null
# shellcheck disable=SC1091
source "$ROOT/deploy/referrall-migrate-env.sh"
referrall_load_migration_env
DATABASE_URL="$DATABASE_URL" "$PYTHON" - <<'PY'
import os
from sqlalchemy import create_engine, text

engine = create_engine(os.environ["DATABASE_URL"])
with engine.connect() as conn:
    for table, col in (
        ("t1referrall_user", "totp_enabled"),
        ("t1referrall_user", "banner_url"),
        ("t1referrall_session", "user_agent"),
    ):
        ok = conn.execute(text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
            "WHERE table_name = :t AND column_name = :c)"
        ), {"t": table, "c": col}).scalar()
        print(f"{'OK  ' if ok else 'MISS'} {table}.{col}")
        if not ok:
            raise SystemExit(1)
PY

SERVICE="roryportfolio"
if ! systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
  SERVICE="webapi-dev"
fi
if systemctl list-unit-files --type=service 2>/dev/null | grep -q "^${SERVICE}\.service"; then
  echo "==> Restarting ${SERVICE}…"
  sudo systemctl restart "$SERVICE"
fi

echo "OK  Dev auth migrations complete. Retry login at https://rorhoff.com/referr-all/"
