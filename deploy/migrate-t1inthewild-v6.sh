#!/usr/bin/env bash
# migrate-t1inthewild-v6.sh — user city coords + user-submitted events.
#
#   bash ~/Website/deploy/migrate-t1inthewild-v6.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
source "$ROOT/deploy/referrall-migrate-env.sh"
referrall_resolve_python
referrall_load_migration_env

echo "==> In the Wild v6 (city geocode + user events)…"
"$PYTHON" - <<'PY'
from database import engine
from itw_schema_upgrade import ensure_itw_schema
from sqlalchemy import inspect

if engine is None:
    raise SystemExit("DATABASE_URL not set")
ensure_itw_schema(engine)

user_cols = {c["name"] for c in inspect(engine).get_columns("t1inthewild_user")}
event_cols = {c["name"] for c in inspect(engine).get_columns("t1inthewild_event")}
for col in ("city_latitude", "city_longitude"):
    print(f"{'OK  ' if col in user_cols else 'MISS'} t1inthewild_user.{col}")
print(f"{'OK  ' if 'created_by_user_id' in event_cols else 'MISS'} t1inthewild_event.created_by_user_id")
PY

echo "OK  In the Wild v6 migration complete."
