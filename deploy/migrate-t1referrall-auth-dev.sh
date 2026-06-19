#!/usr/bin/env bash
# migrate-t1referrall-auth-dev.sh - fix dev login 503 (missing v10/v11 auth columns).
#
# Run on EC2:
#   bash ~/Website/deploy/migrate-t1referrall-auth-dev.sh
#
# Uses the DATABASE_URL from the roryportfolio / webapi-dev systemd unit.

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

_db_name_from_url() {
  "$PYTHON" - "$1" <<'PY'
import sys
from urllib.parse import urlparse
print(urlparse(sys.argv[1]).path.lstrip("/") or "?")
PY
}

_referrall_service_env_file() {
  local service path part
  for service in roryportfolio webapi-dev; do
    if ! systemctl list-unit-files --type=service 2>/dev/null | grep -q "^${service}\.service"; then
      continue
    fi
    path="$(systemctl show "$service" -p EnvironmentFiles --value 2>/dev/null || true)"
    for part in $path; do
      part="${part#:}"
      if [[ -f "$part" ]]; then
        echo "$part"
        return 0
      fi
    done
  done
  return 1
}

SERVICE="roryportfolio"
if ! systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
  SERVICE="webapi-dev"
fi

APP_ENV_FILE=""
if APP_ENV_FILE="$(_referrall_service_env_file)"; then
  export ENV_FILE="$APP_ENV_FILE"
elif [[ -n "${ENV_FILE:-}" && -f "${ENV_FILE}" ]]; then
  APP_ENV_FILE="$ENV_FILE"
elif [[ -f /home/ubuntu/Website/.env.dev ]]; then
  APP_ENV_FILE=/home/ubuntu/Website/.env.dev
  export ENV_FILE="$APP_ENV_FILE"
elif [[ -f /home/ubuntu/Website/.env ]]; then
  APP_ENV_FILE=/home/ubuntu/Website/.env
  export ENV_FILE="$APP_ENV_FILE"
else
  echo "ERR  Could not find a dev env file (.env.dev / .env / systemd EnvironmentFile)." >&2
  exit 1
fi

echo "==> Dev auth migrations (v10 + v11)"
echo "    ROOT=$ROOT"
echo "    PYTHON=$PYTHON"
echo "    Service env file: $APP_ENV_FILE"
if [[ -f /home/ubuntu/Website/.env.dev && "$APP_ENV_FILE" != /home/ubuntu/Website/.env.dev ]]; then
  echo "    NOTE: .env.dev exists but roryportfolio loads .env - migrations use the service file above."
fi

MIGRATE_URL="$("$PYTHON" "$ROOT/deploy/referrall-migrate-db.py" --print-url")"
echo "    Migration database: $(_db_name_from_url "$MIGRATE_URL")"

bash "$ROOT/deploy/migrate-t1referrall-v8.sh"
bash "$ROOT/deploy/migrate-t1referrall-v9.sh"
bash "$ROOT/deploy/migrate-t1referrall-v10.sh"
bash "$ROOT/deploy/migrate-t1referrall-v11.sh"

echo "==> Verifying auth columns on migration database..."
DATABASE_URL="$MIGRATE_URL" "$PYTHON" - <<'PY'
import os
from sqlalchemy import create_engine, text

engine = create_engine(os.environ["DATABASE_URL"])
checks = (
    ("t1referrall_user", "email_verify_token"),
    ("t1referrall_user", "password_reset_token"),
    ("t1referrall_user", "totp_enabled"),
    ("t1referrall_user", "banner_url"),
    ("t1referrall_user", "settings"),
    ("t1referrall_session", "user_agent"),
    ("t1referrall_session", "ip"),
    ("t1referrall_session", "last_seen_at"),
)
with engine.connect() as conn:
    for table, col in checks:
        ok = conn.execute(text(
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
            "WHERE table_name = :t AND column_name = :c)"
        ), {"t": table, "c": col}).scalar()
        print(f"{'OK  ' if ok else 'MISS'} {table}.{col}")
        if not ok:
            raise SystemExit(1)
PY

if systemctl list-unit-files --type=service 2>/dev/null | grep -q "^${SERVICE}\.service"; then
  echo "==> Restarting ${SERVICE}..."
  sudo systemctl restart "$SERVICE"
  sleep 2
fi

echo "==> Checking live API authDbReady..."
STATUS="$(curl -sS --max-time 5 "http://127.0.0.1:8000/api/referr-all/status" 2>/dev/null || true)"
if [[ -n "$STATUS" ]]; then
  REFERRALL_STATUS_JSON="$STATUS" "$PYTHON" - <<'PY'
import json
import os
import sys

d = json.loads(os.environ.get("REFERRALL_STATUS_JSON", "{}"))
ready = d.get("authDbReady")
err = d.get("authDbError")
print(f"    authDbReady={ready}")
if err:
    print(f"    authDbError={err}")
if ready is not True:
    print()
    print("ERR  API still reports auth DB not ready.")
    print("     Migrations ran on a different DATABASE_URL than the running app.")
    print("     Compare:")
    print("       grep DATABASE_URL /home/ubuntu/Website/.env.dev /home/ubuntu/Website/.env")
    print("       systemctl show roryportfolio -p EnvironmentFiles --value")
    sys.exit(1)
PY
else
  echo "WARN Could not reach http://127.0.0.1:8000/api/referr-all/status - restart ${SERVICE} and retry login."
fi

echo "OK  Dev auth migrations complete. Retry login at https://rorhoff.com/referr-all/"
