#!/usr/bin/env bash
# diagnose-t1referrall-prod.sh — check Referr-All payments on referr-all.com prod (no secrets printed).
#
# Usage: bash /home/ubuntu/website-referrall/deploy/diagnose-t1referrall-prod.sh

set -euo pipefail

REFERRALL_DIR="${REFERRALL_DIR:-/home/ubuntu/website-referrall}"
ENV_FILE="${ENV_FILE:-$REFERRALL_DIR/.env.referrall}"
SERVICE="${REFERRALL_SERVICE:-webapi-referrall}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

echo "=== Stripe env (prefixes only) ==="
for k in STRIPE_SECRET_KEY STRIPE_PUBLISHABLE_KEY STRIPE_WEBHOOK_SECRET \
  REFERR_ALL_STRIPE_WEBHOOK_SECRET STRIPE_PUBLIC_BASE_URL; do
  v="${!k:-}"
  if [[ -z "$v" ]]; then
    echo "  $k: (not set)"
  else
    echo "  $k: ${v:0:12}... (${#v} chars)"
  fi
done

echo
echo "=== stripe_enabled() checks ==="
missing=()
[[ -n "${STRIPE_SECRET_KEY:-}" ]] || missing+=("STRIPE_SECRET_KEY")
if [[ -n "${STRIPE_WEBHOOK_SECRET:-}" || -n "${REFERR_ALL_STRIPE_WEBHOOK_SECRET:-}" ]]; then
  :
else
  missing+=("REFERR_ALL_STRIPE_WEBHOOK_SECRET (or STRIPE_WEBHOOK_SECRET)")
fi
[[ -n "${STRIPE_PUBLIC_BASE_URL:-}" ]] || missing+=("STRIPE_PUBLIC_BASE_URL")
if ((${#missing[@]})); then
  echo "  FAIL — missing: ${missing[*]}"
else
  echo "  OK — all required vars present"
fi

if [[ "${STRIPE_SECRET_KEY:-}" == sk_live_* ]]; then
  echo "  Secret key mode: LIVE"
elif [[ "${STRIPE_SECRET_KEY:-}" == sk_test_* ]]; then
  echo "  Secret key mode: TEST (use live keys on referr-all.com prod)"
else
  echo "  WARN — secret key does not look like sk_live_ or sk_test_"
fi

echo
echo "=== /api/referr-all/status ==="
curl -sS "http://127.0.0.1:8002/api/referr-all/status" | python3 -m json.tool 2>/dev/null \
  || echo "(start ${SERVICE} first)"

echo
echo "=== Recent checkout errors (journal) ==="
sudo journalctl -u "$SERVICE" -n 120 --no-pager 2>/dev/null | grep -iE 'stripe|checkout|premium' | tail -15 || echo "  (no matches)"

echo
echo "If payments are missing, run:"
echo "  bash ${REFERRALL_DIR}/deploy/set-stripe-referrall-prod.sh"
echo "Webhook URL: https://referr-all.com/api/referr-all/premium/webhook"
