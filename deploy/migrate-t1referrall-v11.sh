#!/usr/bin/env bash
# migrate-t1referrall-v11.sh — profile banner_url column.
#
# Run once on EC2 after deploying profile banner support:
#   bash ~/Website/deploy/migrate-t1referrall-v11.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -x /home/ubuntu/app/venv/bin/python ]]; then
  PYTHON=/home/ubuntu/app/venv/bin/python
elif [[ -x "$ROOT/.venv/bin/python" ]]; then
  PYTHON="$ROOT/.venv/bin/python"
elif [[ -x /home/ubuntu/Website/.venv/bin/python ]]; then
  PYTHON=/home/ubuntu/Website/.venv/bin/python
else
  PYTHON=python3
fi

# shellcheck disable=SC1091
source "$ROOT/deploy/referrall-migrate-env.sh"
referrall_load_migration_env

echo "==> Referr-All profile banner_url migration (v11)…"
"$PYTHON" "$ROOT/deploy/referrall-migrate-db.py" \
  "ALTER TABLE t1referrall_user ADD COLUMN IF NOT EXISTS banner_url text NOT NULL DEFAULT ''"

echo "OK  banner_url column ready"
echo "OK  Referr-All v11 migration complete."
