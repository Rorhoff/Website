#!/usr/bin/env bash
# Write Gemini render settings into ldbg/.env.local (never commit that file).
#
# Usage:
#   ./scripts/set-gemini-key.sh YOUR_GEMINI_API_KEY
#   ./scripts/set-gemini-key.sh              # prompts securely
#
# From repo root:
#   bash ldbg/scripts/set-gemini-key.sh YOUR_KEY

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LDBG_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${LDBG_DIR}/.env.local"
EXAMPLE="${LDBG_DIR}/.env.local.example"

KEY="${1:-}"
if [[ -z "${KEY}" ]]; then
  read -rsp "Gemini API key: " KEY
  echo
fi

if [[ -z "${KEY}" ]]; then
  echo "error: no API key provided" >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  if [[ -f "${EXAMPLE}" ]]; then
    cp "${EXAMPLE}" "${ENV_FILE}"
    echo "Created ${ENV_FILE} from .env.local.example"
  else
    touch "${ENV_FILE}"
    echo "Created empty ${ENV_FILE}"
  fi
fi

# Upsert KEY=value (handles commented-out lines by appending if no active match).
set_var() {
  local name="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"

  if grep -q "^${name}=" "${ENV_FILE}"; then
    awk -v k="${name}" -v v="${value}" '
      BEGIN { FS=OFS="=" }
      $1 == k { print k "=" v; next }
      { print }
    ' "${ENV_FILE}" > "${tmp}"
    mv "${tmp}" "${ENV_FILE}"
  else
    echo "${name}=${value}" >> "${ENV_FILE}"
  fi
}

set_var "GEMINI_API_KEY" "${KEY}"
set_var "LDBG_RENDERS_ENABLED" "true"
set_var "LDBG_RENDER_PROVIDER" "gemini"

echo "Updated ${ENV_FILE}:"
echo "  GEMINI_API_KEY=***"
echo "  LDBG_RENDERS_ENABLED=true"
echo "  LDBG_RENDER_PROVIDER=gemini"
echo ""
echo "Restart npm run dev (or the ldbg systemd service) to pick up changes."
