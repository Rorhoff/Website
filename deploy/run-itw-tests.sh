#!/usr/bin/env bash
# run-itw-tests.sh — run In the Wild pytest suite on EC2 (uses project venv + DATABASE_URL).
#
# Usage:
#   bash ~/Website/deploy/run-itw-tests.sh
#   bash ~/Website/deploy/run-itw-tests.sh itw-test/test_preferences.py -v

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
source "$ROOT/deploy/ensure-venv.sh"
ensure_project_venv "$ROOT"

PYTEST="$(dirname "$PYTHON")/pytest"
if [[ ! -x "$PYTEST" ]]; then
  echo "ERR  pytest missing — check $ROOT/requirements.txt" >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$ROOT/deploy/referrall-migrate-env.sh"
referrall_load_migration_env

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "WARN DATABASE_URL not set — integration tests will skip." >&2
fi

export SERVICE_MODE="${SERVICE_MODE:-full}"
export EMAIL_DEV_LOG_ONLY="${EMAIL_DEV_LOG_ONLY:-1}"

exec "$PYTEST" itw-test/ "$@"
