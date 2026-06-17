#!/usr/bin/env bash
# referrall-migrate-env.sh — load DATABASE_URL for Referr-All migration scripts.
#
# Usage (from another deploy/*.sh):
#   ROOT="$(cd "$(dirname "$0")/.." && pwd)"
#   # shellcheck disable=SC1091
#   source "$ROOT/deploy/referrall-migrate-env.sh"
#   referrall_load_migration_env

referrall_resolve_env_file() {
  local candidate
  for candidate in "$@"; do
    [[ -n "$candidate" && -f "$candidate" ]] || continue
    if grep -qE '^DATABASE_URL=.+' "$candidate" 2>/dev/null; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

referrall_load_migration_env() {
  local root="${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
  local candidates=(
    "${ENV_FILE:-}"
    /home/ubuntu/Website/.env.dev
    /home/ubuntu/Website/.env
    /home/ubuntu/website-referrall/.env.referrall
    "$root/.env.dev"
    "$root/.env"
  )
  local env_file=""

  if [[ -n "${DATABASE_URL:-}" ]]; then
    echo "==> Using DATABASE_URL already set in the shell"
    return 0
  fi

  env_file="$(referrall_resolve_env_file "${candidates[@]}")" || {
    echo "ERR  No env file with DATABASE_URL found. Checked:" >&2
    for candidate in "${candidates[@]}"; do
      [[ -n "$candidate" ]] && echo "       $candidate" >&2
    done
    echo "       Run: ENV_FILE=/home/ubuntu/Website/.env.dev bash deploy/migrate-t1referrall-v10.sh" >&2
    exit 1
  }

  echo "==> Using env file: $env_file"
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a

  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "ERR  DATABASE_URL is empty in $env_file" >&2
    exit 1
  fi

  export ENV_FILE="$env_file"
}
