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
    if grep -qE '^[[:space:]]*(export[[:space:]]+)?DATABASE_URL=.+' "$candidate" 2>/dev/null; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

referrall_load_migration_env() {
  local root="${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
  local py="${PYTHON:-python3}"
  local migrate_py="$root/deploy/referrall-migrate-db.py"
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

  # Prefer Python bootstrap: reads env files + systemd EnvironmentFiles for roryportfolio.
  if [[ -f "$migrate_py" ]]; then
    if parsed="$("$py" "$migrate_py" --print-url 2>/dev/null)" && [[ -n "$parsed" ]]; then
      export DATABASE_URL="$parsed"
      echo "==> Loaded DATABASE_URL via referrall-migrate-db.py"
      return 0
    fi
  fi

  env_file="$(referrall_resolve_env_file "${candidates[@]}")" || {
    echo "ERR  No env file with DATABASE_URL found. Checked:" >&2
    for candidate in "${candidates[@]}"; do
      [[ -n "$candidate" ]] && echo "       $candidate" >&2
    done
    echo "       Also tried systemd EnvironmentFiles for roryportfolio/webapi-dev." >&2
    echo "       Run: grep DATABASE_URL /home/ubuntu/Website/.env*" >&2
    exit 1
  }

  echo "==> Using env file: $env_file"
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a

  if [[ -z "${DATABASE_URL:-}" ]]; then
    parsed="$("$py" - "$env_file" <<'PY'
import sys
from pathlib import Path

def parse(path: Path):
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""

print(parse(Path(sys.argv[1])))
PY
)"
    if [[ -n "$parsed" ]]; then
      export DATABASE_URL="$parsed"
    fi
  fi

  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "ERR  DATABASE_URL is empty in $env_file" >&2
    echo "     Check that file contains DATABASE_URL=postgresql+psycopg://..." >&2
    exit 1
  fi

  export ENV_FILE="$env_file"
}
