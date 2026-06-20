#!/usr/bin/env bash
# migrate-t1referrall-v12.sh — is_admin column for Referr-All admin panel.
#
# Run once on EC2 after deploying admin support:
#   bash ~/Website/deploy/migrate-t1referrall-v12.sh
#
# Bootstrap the primary admin (run once per environment after migration):
#   psql "$DATABASE_URL" -c "UPDATE t1referrall_user SET is_admin = TRUE WHERE username = 'rorhoff';"

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -z "${PYTHON:-}" ]] || [[ ! -x "${PYTHON}" ]]; then
  if [[ -x /home/ubuntu/app/venv/bin/python ]]; then
    PYTHON=/home/ubuntu/app/venv/bin/python
  elif [[ -x "$ROOT/.venv/bin/python" ]]; then
    PYTHON="$ROOT/.venv/bin/python"
  elif [[ -x /home/ubuntu/Website/.venv/bin/python ]]; then
    PYTHON=/home/ubuntu/Website/.venv/bin/python
  else
    PYTHON=python3
  fi
fi

# shellcheck disable=SC1091
source "$ROOT/deploy/referrall-migrate-env.sh"
referrall_load_migration_env

echo "==> Referr-All is_admin migration (v12)…"
"$PYTHON" "$ROOT/deploy/referrall-migrate-db.py" \
  "ALTER TABLE t1referrall_user ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false"

echo "OK  is_admin column ready"
echo "OK  Referr-All v12 migration complete."
echo "    To grant admin to @rorhoff: UPDATE t1referrall_user SET is_admin = TRUE WHERE username = 'rorhoff';"
