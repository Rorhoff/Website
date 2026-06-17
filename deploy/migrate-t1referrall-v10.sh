#!/usr/bin/env bash
# migrate-t1referrall-v10.sh — account settings columns (2FA, phone, hibernate,
# preferences) plus session metadata for the "where you're signed in" feature.
#
# Run once on EC2 after deploying the Settings feature:
#   bash ~/Website/deploy/migrate-t1referrall-v10.sh
# On the referr-all.com prod checkout:
#   bash ~/website-referrall/deploy/migrate-t1referrall-v10.sh

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

echo "==> Referr-All account/settings columns migration (v10)…"
"$PYTHON" "$ROOT/deploy/referrall-migrate-db.py" \
  "ALTER TABLE t1referrall_user ADD COLUMN IF NOT EXISTS phone varchar(32) NOT NULL DEFAULT ''" \
  "ALTER TABLE t1referrall_user ADD COLUMN IF NOT EXISTS totp_secret varchar(64)" \
  "ALTER TABLE t1referrall_user ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false" \
  "ALTER TABLE t1referrall_user ADD COLUMN IF NOT EXISTS is_deactivated boolean NOT NULL DEFAULT false" \
  "ALTER TABLE t1referrall_user ADD COLUMN IF NOT EXISTS deactivated_at timestamp without time zone" \
  "ALTER TABLE t1referrall_user ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb" \
  "ALTER TABLE t1referrall_session ADD COLUMN IF NOT EXISTS user_agent varchar(400) NOT NULL DEFAULT ''" \
  "ALTER TABLE t1referrall_session ADD COLUMN IF NOT EXISTS ip varchar(64) NOT NULL DEFAULT ''" \
  "ALTER TABLE t1referrall_session ADD COLUMN IF NOT EXISTS last_seen_at timestamp without time zone"

echo "OK  account/settings columns ready"
echo "OK  Referr-All v10 migration complete."
