#!/usr/bin/env bash
# bootstrap-referrall-admin.sh — grant Referr-All admin to @rorhoff (one-time per environment).
#
# Usage:
#   ENV_FILE=/home/ubuntu/Website/.env bash deploy/bootstrap-referrall-admin.sh
#   ENV_FILE=/home/ubuntu/website-referrall/.env.referrall bash deploy/bootstrap-referrall-admin.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -z "${PYTHON:-}" ]] || [[ ! -x "${PYTHON}" ]]; then
  if [[ -x "$ROOT/.venv/bin/python" ]]; then
    PYTHON="$ROOT/.venv/bin/python"
  else
    PYTHON=python3
  fi
fi

# shellcheck disable=SC1091
source "$ROOT/deploy/referrall-migrate-env.sh"
referrall_load_migration_env

USERNAME="${REFERRALL_ADMIN_USERNAME:-rorhoff}"

echo "==> Granting Referr-All admin to @${USERNAME}…"
"$PYTHON" "$ROOT/deploy/referrall-migrate-db.py" \
  "UPDATE t1referrall_user SET is_admin = TRUE WHERE username = '${USERNAME}'"

echo "OK  Bootstrap complete. Sign out and back in to see Administration in Settings."
