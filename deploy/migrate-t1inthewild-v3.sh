#!/usr/bin/env bash
# migrate-t1inthewild-v3.sh — report status columns for In the Wild admin workflow.
#
#   bash ~/Website/deploy/migrate-t1inthewild-v3.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
source "$ROOT/deploy/referrall-migrate-env.sh"
referrall_resolve_python
referrall_load_migration_env

echo "==> In the Wild v3 (report status)…"
"$PYTHON" "$ROOT/deploy/referrall-migrate-db.py" \
  "ALTER TABLE t1inthewild_user_report ADD COLUMN IF NOT EXISTS status varchar(16) NOT NULL DEFAULT 'pending'" \
  "ALTER TABLE t1inthewild_user_report ADD COLUMN IF NOT EXISTS reviewed_at timestamp NULL"

echo "OK  In the Wild v3 migration complete."
