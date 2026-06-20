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

referrall_resolve_python() {
  if [[ -n "${PYTHON:-}" && -x "${PYTHON}" ]]; then
    return 0
  fi
  local root="${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
  if [[ -x /home/ubuntu/app/venv/bin/python ]]; then
    PYTHON=/home/ubuntu/app/venv/bin/python
  elif [[ -x "$root/.venv/bin/python" ]]; then
    PYTHON="$root/.venv/bin/python"
  elif [[ -x /home/ubuntu/Website/.venv/bin/python ]]; then
    PYTHON=/home/ubuntu/Website/.venv/bin/python
  else
    PYTHON=python3
  fi
  export PYTHON
}

referrall_load_migration_env() {
  local root="${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
  referrall_resolve_python
  local py="${PYTHON}"
  local migrate_py="$root/deploy/referrall-migrate-db.py"
  local env_file=""

  if [[ -n "${DATABASE_URL:-}" ]]; then
    echo "==> Using DATABASE_URL already set in the shell"
    return 0
  fi

  if [[ -f "$migrate_py" ]]; then
    if parsed="$("$py" "$migrate_py" --print-url 2>/dev/null)" && [[ -n "$parsed" ]]; then
      export DATABASE_URL="$parsed"
      echo "==> Loaded DATABASE_URL via referrall-migrate-db.py"
      return 0
    fi
  fi

  local candidates=()
  if [[ -n "${ENV_FILE:-}" ]]; then
    candidates+=("$ENV_FILE")
  fi
  if [[ "$root" == *website-referrall* ]]; then
    candidates+=(
      /home/ubuntu/website-referrall/.env.referrall
      "$root/.env.referrall"
    )
  else
    candidates+=(
      /home/ubuntu/Website/.env.dev
      "$root/.env.dev"
      /home/ubuntu/Website/.env
      "$root/.env"
    )
  fi

  env_file="$(referrall_resolve_env_file "${candidates[@]}")" || {
    echo "ERR  No env file with DATABASE_URL found. Checked:" >&2
    for candidate in "${candidates[@]}"; do
      [[ -n "$candidate" ]] && echo "       $candidate" >&2
    done
    echo "       Also tried systemd EnvironmentFiles (see referrall-migrate-db.py)." >&2
    echo "       Run: ENV_FILE=/path/to/.env.dev bash deploy/migrate-t1referrall-v10.sh" >&2
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
