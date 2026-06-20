#!/usr/bin/env bash
# migrate-t1referrall-auth-prod.sh — fix referr-all.com login 503 (missing auth/admin columns).
#
# Run on EC2:
#   bash ~/website-referrall/deploy/migrate-t1referrall-auth-prod.sh
#
# Uses DATABASE_URL from webapi-referrall / .env.referrall (ReferrAll_Prod).

set -euo pipefail

ROOT="${ROOT:-/home/ubuntu/website-referrall}"
cd "$ROOT"

if [[ -z "${PYTHON:-}" ]] || [[ ! -x "${PYTHON}" ]]; then
  if [[ -x "$ROOT/.venv/bin/python" ]]; then
    PYTHON="$ROOT/.venv/bin/python"
  elif [[ -x /home/ubuntu/app/venv/bin/python ]]; then
    PYTHON=/home/ubuntu/app/venv/bin/python
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

SERVICE="webapi-referrall"
APP_ENV_FILE=""

path="$(systemctl show "$SERVICE" -p EnvironmentFiles --value 2>/dev/null || true)"
for part in $path; do
  part="${part#:}"
  if [[ -f "$part" ]]; then
    APP_ENV_FILE="$part"
    export ENV_FILE="$part"
    break
  fi
done

if [[ -z "$APP_ENV_FILE" ]]; then
  if [[ -f "$ROOT/.env.referrall" ]]; then
    APP_ENV_FILE="$ROOT/.env.referrall"
    export ENV_FILE="$APP_ENV_FILE"
  else
    echo "ERR  Could not find .env.referrall or webapi-referrall EnvironmentFile." >&2
    exit 1
  fi
fi

echo "==> Prod auth migrations (v8–v12)"
echo "    ROOT=$ROOT"
echo "    PYTHON=$PYTHON"
echo "    Service env file: $APP_ENV_FILE"

MIGRATE_URL="$("$PYTHON" "$ROOT/deploy/referrall-migrate-db.py" --print-url")"
echo "    Migration database: $(_db_name_from_url "$MIGRATE_URL")"

bash "$ROOT/deploy/migrate-t1referrall-v8.sh"
bash "$ROOT/deploy/migrate-t1referrall-v9.sh"
bash "$ROOT/deploy/migrate-t1referrall-v10.sh"
bash "$ROOT/deploy/migrate-t1referrall-v11.sh"
bash "$ROOT/deploy/migrate-t1referrall-v12.sh"

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
    ("t1referrall_user", "is_admin"),
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

echo "==> Granting admin to @rorhoff (if account exists)..."
bash "$ROOT/deploy/bootstrap-referrall-admin.sh" || echo "WARN Admin bootstrap skipped"

echo "==> Restarting ${SERVICE}..."
sudo systemctl restart "$SERVICE"
sleep 2

echo "==> Checking live API authDbReady..."
STATUS="$(curl -sS --max-time 5 "http://127.0.0.1:8002/api/referr-all/status" 2>/dev/null || true)"
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
    print("     Migrations ran on a different DATABASE_URL than webapi-referrall.")
    print("     Compare:")
    print("       grep DATABASE_URL /home/ubuntu/website-referrall/.env.referrall")
    print("       systemctl show webapi-referrall -p EnvironmentFiles --value")
    sys.exit(1)
PY
else
  echo "WARN Could not reach http://127.0.0.1:8002/api/referr-all/status"
fi

echo "OK  Prod auth migrations complete. Retry login at https://referr-all.com/"
