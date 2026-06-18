#!/usr/bin/env bash
# ensure-stripe-public-base-referrall-prod.sh — set STRIPE_PUBLIC_BASE_URL on referr-all.com prod.
#
# Safe to run on every deploy (non-secret). Live Stripe keys still require:
#   bash deploy/set-stripe-referrall-prod.sh

set -euo pipefail

REFERRALL_DIR="${REFERRALL_DIR:-/home/ubuntu/website-referrall}"
ENV_FILE="${ENV_FILE:-$REFERRALL_DIR/.env.referrall}"
PUBLIC_BASE="${STRIPE_PUBLIC_BASE_URL:-https://referr-all.com}"

[[ -f "$ENV_FILE" ]] || {
  echo "WARN  No env file at $ENV_FILE — skipping STRIPE_PUBLIC_BASE_URL ensure." >&2
  exit 0
}

if grep -qE '^[[:space:]]*(export[[:space:]]+)?STRIPE_PUBLIC_BASE_URL=.+' "$ENV_FILE" 2>/dev/null; then
  echo "OK  STRIPE_PUBLIC_BASE_URL already set in $ENV_FILE"
  exit 0
fi

echo "==> Adding STRIPE_PUBLIC_BASE_URL=$PUBLIC_BASE to $ENV_FILE"
printf '\n# Stripe redirect base (Referr-All on referr-all.com)\nSTRIPE_PUBLIC_BASE_URL=%s\n' "$PUBLIC_BASE" >>"$ENV_FILE"
echo "OK  STRIPE_PUBLIC_BASE_URL added. Run bash deploy/set-stripe-referrall-prod.sh for live keys."
