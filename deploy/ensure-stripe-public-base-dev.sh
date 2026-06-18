#!/usr/bin/env bash
# ensure-stripe-public-base-dev.sh — set STRIPE_PUBLIC_BASE_URL on dev if missing.
#
# Safe to run on every deploy (non-secret). Stripe keys still require:
#   bash deploy/set-stripe-dev.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEBSITE_DIR="${WEBSITE_DIR:-/home/ubuntu/Website}"
PUBLIC_BASE="${STRIPE_PUBLIC_BASE_URL:-https://rorhoff.com}"

# shellcheck disable=SC1091
source "$ROOT/deploy/referrall-migrate-env.sh"
referrall_load_migration_env 2>/dev/null || {
  for candidate in \
    "${ENV_FILE:-}" \
    "$WEBSITE_DIR/.env.dev" \
    "$WEBSITE_DIR/.env"; do
    [[ -n "$candidate" && -f "$candidate" ]] || continue
    export ENV_FILE="$candidate"
    break
  done
  [[ -n "${ENV_FILE:-}" && -f "$ENV_FILE" ]] || ENV_FILE="$WEBSITE_DIR/.env.dev"
}

if grep -qE '^[[:space:]]*(export[[:space:]]+)?STRIPE_PUBLIC_BASE_URL=.+' "$ENV_FILE" 2>/dev/null; then
  echo "OK  STRIPE_PUBLIC_BASE_URL already set in $ENV_FILE"
  exit 0
fi

echo "==> Adding STRIPE_PUBLIC_BASE_URL=$PUBLIC_BASE to $ENV_FILE"
printf '\n# Stripe redirect base (Referr-All + Classifieds on rorhoff.com dev)\nSTRIPE_PUBLIC_BASE_URL=%s\n' "$PUBLIC_BASE" >>"$ENV_FILE"
echo "OK  STRIPE_PUBLIC_BASE_URL added. Run bash deploy/set-stripe-dev.sh for test keys."
