#!/usr/bin/env bash
# set-itw-display-name.sh — update an In the Wild user's full name by email.
#
# Example:
#   ITW_USER_EMAIL=pharoah16@gmail.com ITW_DISPLAY_NAME='Gengar Ketchum' bash deploy/set-itw-display-name.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
source "$ROOT/deploy/referrall-migrate-env.sh"
referrall_resolve_python
referrall_load_migration_env

EMAIL="${ITW_USER_EMAIL:-}"
NAME="${ITW_DISPLAY_NAME:-}"

if [ -z "$EMAIL" ] || [ -z "$NAME" ]; then
  echo "Usage: ITW_USER_EMAIL=user@example.com ITW_DISPLAY_NAME='Full Name' bash deploy/set-itw-display-name.sh" >&2
  exit 1
fi

export ITW_USER_EMAIL="$EMAIL"
export ITW_DISPLAY_NAME="$NAME"
"$PYTHON" "$ROOT/deploy/set-itw-display-name.py"
