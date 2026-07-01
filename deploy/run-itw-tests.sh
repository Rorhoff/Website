#!/usr/bin/env bash
# run-itw-tests.sh — run In the Wild pytest suite on EC2 (uses project venv + DATABASE_URL).
#
# Usage:
#   bash ~/Website/deploy/run-itw-tests.sh
#   bash ~/Website/deploy/run-itw-tests.sh itw-test/test_preferences.py -v

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -x "$ROOT/.venv/bin/python" ]]; then
  PYTHON="$ROOT/.venv/bin/python"
  PIP="$ROOT/.venv/bin/pip"
elif [[ -x /home/ubuntu/Website/.venv/bin/python ]]; then
  PYTHON=/home/ubuntu/Website/.venv/bin/python
  PIP=/home/ubuntu/Website/.venv/bin/pip
else
  echo "ERR  .venv not found — run: python3 -m venv $ROOT/.venv && $ROOT/.venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

if ! "$PYTHON" -c "import pytest" 2>/dev/null; then
  echo "==> Installing test dependencies (pytest)…"
  "$PIP" install -r "$ROOT/requirements.txt"
fi

PYTEST="$ROOT/.venv/bin/pytest"
if [[ ! -x "$PYTEST" ]]; then
  PYTEST="$(dirname "$PYTHON")/pytest"
fi
if [[ ! -x "$PYTEST" ]]; then
  echo "ERR  pytest still missing after pip install — check $ROOT/requirements.txt" >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$ROOT/deploy/referrall-migrate-env.sh"
referrall_resolve_python
referrall_load_migration_env

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "WARN DATABASE_URL not set — integration tests will skip." >&2
fi

export SERVICE_MODE="${SERVICE_MODE:-full}"
export EMAIL_DEV_LOG_ONLY="${EMAIL_DEV_LOG_ONLY:-1}"

exec "$PYTEST" itw-test/ "$@"
