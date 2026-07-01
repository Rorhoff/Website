#!/usr/bin/env bash
# bootstrap-itw-admin.sh — grant In the Wild admin to @rorhoff (one-time per environment).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export ROOT="$ROOT"

# shellcheck disable=SC1091
source "$ROOT/deploy/referrall-migrate-env.sh"
referrall_resolve_python
referrall_load_migration_env

USERNAME="${ITW_ADMIN_USERNAME:-rorhoff}"
USERNAME="${USERNAME//[\'\"]/}"

echo "==> Granting In the Wild admin to @${USERNAME}…"
"$PYTHON" "$ROOT/deploy/referrall-migrate-db.py" \
  "UPDATE t1inthewild_user SET is_admin = TRUE WHERE username = '${USERNAME}'"

echo "OK  Bootstrap complete."
