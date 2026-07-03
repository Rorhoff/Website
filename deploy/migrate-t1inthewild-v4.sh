#!/usr/bin/env bash
# migrate-t1inthewild-v4.sh — event plans + overlap alert tracking.
#
#   bash ~/Website/deploy/migrate-t1inthewild-v4.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
source "$ROOT/deploy/referrall-migrate-env.sh"
referrall_resolve_python
referrall_load_migration_env

echo "==> In the Wild v4 (event plans)…"
"$PYTHON" - <<'PY'
import models  # noqa: F401
from database import Base, engine
from sqlalchemy import inspect

if engine is None:
    raise SystemExit("DATABASE_URL not set")
Base.metadata.create_all(bind=engine)
for t in ("t1inthewild_event_plan", "t1inthewild_event_plan_alert"):
    print(f"{'OK  ' if inspect(engine).has_table(t) else 'MISS'} {t}")
PY

echo "OK  In the Wild v4 migration complete."
