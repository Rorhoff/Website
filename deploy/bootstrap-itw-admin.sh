#!/usr/bin/env bash
# bootstrap-itw-admin.sh — grant In the Wild admin by username or email (one-time per environment).
#
# Examples:
#   ITW_ADMIN_EMAIL=pharoah16@gmail.com bash deploy/bootstrap-itw-admin.sh
#   ITW_ADMIN_USERNAME=rorhoff bash deploy/bootstrap-itw-admin.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export ROOT="$ROOT"

# shellcheck disable=SC1091
source "$ROOT/deploy/referrall-migrate-env.sh"
referrall_resolve_python
referrall_load_migration_env

EMAIL="${ITW_ADMIN_EMAIL:-}"
USERNAME="${ITW_ADMIN_USERNAME:-rorhoff}"
EMAIL="${EMAIL//[\'\"]/}"
USERNAME="${USERNAME//[\'\"]/}"

if [ -n "$EMAIL" ]; then
  echo "==> Granting In the Wild admin to ${EMAIL}…"
  "$PYTHON" "$ROOT/deploy/referrall-migrate-db.py" \
    "UPDATE t1inthewild_user SET is_admin = TRUE WHERE lower(email) = lower('${EMAIL}')"
else
  echo "==> Granting In the Wild admin to @${USERNAME}…"
  "$PYTHON" "$ROOT/deploy/referrall-migrate-db.py" \
    "UPDATE t1inthewild_user SET is_admin = TRUE WHERE username = '${USERNAME}'"
fi

echo "OK  Bootstrap complete."
