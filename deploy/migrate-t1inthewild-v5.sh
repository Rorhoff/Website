#!/usr/bin/env bash
# migrate-t1inthewild-v5.sh — venue alert preference + push subscriptions.
#
#   bash ~/Website/deploy/migrate-t1inthewild-v5.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
source "$ROOT/deploy/referrall-migrate-env.sh"
referrall_resolve_python
referrall_load_migration_env

echo "==> In the Wild v5 (venue alerts + push)…"
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
            "ADD COLUMN IF NOT EXISTS venue_match_alerts BOOLEAN NOT NULL DEFAULT false"
        )
    )

for t in ("t1inthewild_push_subscription",):
    print(f"{'OK  ' if inspect(engine).has_table(t) else 'MISS'} {t}")
cols = inspect(engine).get_columns("t1inthewild_user")
has_alerts = any(c["name"] == "venue_match_alerts" for c in cols)
print(f"{'OK  ' if has_alerts else 'MISS'} t1inthewild_user.venue_match_alerts")
PY

echo "OK  In the Wild v5 migration complete."
