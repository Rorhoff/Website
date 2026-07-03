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
import models  # noqa: F401
from database import Base, engine
from sqlalchemy import inspect, text

if engine is None:
    raise SystemExit("DATABASE_URL not set")
Base.metadata.create_all(bind=engine)

with engine.begin() as conn:
    conn.execute(
        text(
            "ALTER TABLE t1inthewild_user "
            "ADD COLUMN IF NOT EXISTS city_latitude DOUBLE PRECISION"
        )
    )
    conn.execute(
        text(
            "ALTER TABLE t1inthewild_user "
            "ADD COLUMN IF NOT EXISTS city_longitude DOUBLE PRECISION"
        )
    )
    conn.execute(
        text(
            "ALTER TABLE t1inthewild_event "
            "ADD COLUMN IF NOT EXISTS created_by_user_id VARCHAR(36) "
            "REFERENCES t1inthewild_user(id) ON DELETE SET NULL"
        )
    )

user_cols = {c["name"] for c in inspect(engine).get_columns("t1inthewild_user")}
event_cols = {c["name"] for c in inspect(engine).get_columns("t1inthewild_event")}
for col in ("city_latitude", "city_longitude"):
    print(f"{'OK  ' if col in user_cols else 'MISS'} t1inthewild_user.{col}")
print(f"{'OK  ' if 'created_by_user_id' in event_cols else 'MISS'} t1inthewild_event.created_by_user_id")
PY

echo "OK  In the Wild v6 migration complete."
