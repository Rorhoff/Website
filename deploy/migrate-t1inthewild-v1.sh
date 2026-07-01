#!/usr/bin/env bash
# migrate-t1inthewild-v1.sh — create In the Wild tables on RDS (dev).
#
# Run once from EC2 after deploying code that includes t1inthewild models:
#   bash ~/Website/deploy/migrate-t1inthewild-v1.sh
#
# Safe to re-run (create_all).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -x "$ROOT/.venv/bin/python" ]]; then
  PYTHON="$ROOT/.venv/bin/python"
elif [[ -x /home/ubuntu/Website/.venv/bin/python ]]; then
  PYTHON=/home/ubuntu/Website/.venv/bin/python
else
  PYTHON=python3
fi

# shellcheck disable=SC1091
source "$ROOT/deploy/referrall-migrate-env.sh"
referrall_resolve_python
referrall_load_migration_env

echo "==> Creating In the Wild tables…"
"$PYTHON" - <<'PY'
import models  # noqa: F401
from database import Base, engine
from sqlalchemy import inspect

if engine is None:
    raise SystemExit("DATABASE_URL not set")

tables = [
    "t1inthewild_user",
    "t1inthewild_session",
    "t1inthewild_waitlist",
    "t1inthewild_like",
    "t1inthewild_event",
    "t1inthewild_check_in",
    "t1inthewild_match",
    "t1inthewild_message",
    "t1inthewild_verification",
]
Base.metadata.create_all(bind=engine)
insp = inspect(engine)
for t in tables:
    print(f"{'OK  ' if insp.has_table(t) else 'MISS'} {t}")
print("OK  create_all finished")
PY

echo "==> Seeding demo events (if empty)…"
"$PYTHON" "$ROOT/deploy/seed-t1inthewild-events.py"

echo "OK  In the Wild v1 migration complete."
