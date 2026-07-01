#!/usr/bin/env bash
# migrate-t1inthewild-v2.sh — is_admin, blocks, reports for In the Wild.
#
#   bash ~/Website/deploy/migrate-t1inthewild-v2.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
source "$ROOT/deploy/referrall-migrate-env.sh"
referrall_resolve_python
referrall_load_migration_env

echo "==> In the Wild v2 (is_admin, blocks, reports)…"
"$PYTHON" "$ROOT/deploy/referrall-migrate-db.py" \
  "ALTER TABLE t1inthewild_user ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false"

"$PYTHON" - <<'PY'
import models  # noqa: F401
from database import Base, engine
from sqlalchemy import inspect

if engine is None:
    raise SystemExit("DATABASE_URL not set")
Base.metadata.create_all(bind=engine)
for t in ("t1inthewild_user_block", "t1inthewild_user_report"):
    print(f"{'OK  ' if inspect(engine).has_table(t) else 'MISS'} {t}")
PY

echo "OK  In the Wild v2 migration complete."
