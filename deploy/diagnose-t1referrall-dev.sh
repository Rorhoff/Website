#!/usr/bin/env bash
# diagnose-t1referrall-dev.sh — check Referr-All payments + avatar storage on dev EC2.
#
# Usage: bash ~/Website/deploy/diagnose-t1referrall-dev.sh

set -euo pipefail

ENV_FILE="${ENV_FILE:-/home/ubuntu/Website/.env.dev}"
[[ -f "$ENV_FILE" ]] || ENV_FILE="/home/ubuntu/Website/.env"

echo "==> Env file: $ENV_FILE"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

check_var() {
  local name="$1"
  if [[ -n "${!name:-}" ]]; then
    echo "OK   $name is set"
  else
    echo "MISS $name"
  fi
}

echo
echo "Stripe (required for Featured / Premium checkout):"
check_var STRIPE_SECRET_KEY
check_var STRIPE_WEBHOOK_SECRET
check_var STRIPE_PUBLIC_BASE_URL

echo
echo "S3/R2 (optional — avatars fall back to inline data URLs under 512 KB without this):"
check_var S3_BUCKET
check_var S3_ACCESS_KEY_ID
check_var S3_SECRET_ACCESS_KEY
check_var S3_PUBLIC_BASE_URL

echo
echo "API status:"
curl -sS "http://127.0.0.1:8000/api/referr-all/status" | python3 -m json.tool 2>/dev/null || echo "(start webapi-dev first)"

echo
echo "If payments show missing, add TEST Stripe keys to $ENV_FILE and restart roryportfolio:"
echo "  STRIPE_PUBLIC_BASE_URL=https://rorhoff.com"
echo "  STRIPE_WEBHOOK_SECRET=whsec_test_...  (Stripe CLI or Dashboard → /api/referr-all/premium/webhook)"
