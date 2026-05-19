#!/usr/bin/env bash
# diagnose-stripe-prod.sh — verify Stripe keys on prod EC2 (no secrets printed).
#   bash diagnose-stripe-prod.sh

set -euo pipefail

ENV_FILE="/home/ubuntu/website-prod/.env.prod"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

echo "=== Stripe env (prefixes only) ==="
for k in STRIPE_SECRET_KEY STRIPE_PUBLISHABLE_KEY STRIPE_WEBHOOK_SECRET STRIPE_PUBLIC_BASE_URL; do
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
[[ -n "${STRIPE_WEBHOOK_SECRET:-}" ]] || missing+=("STRIPE_WEBHOOK_SECRET")
[[ -n "${STRIPE_PUBLIC_BASE_URL:-}" ]] || missing+=("STRIPE_PUBLIC_BASE_URL")
if ((${#missing[@]})); then
  echo "  FAIL — missing: ${missing[*]}"
else
  echo "  OK — all required vars present"
fi

if [[ "${STRIPE_SECRET_KEY:-}" == sk_live_* ]]; then
  echo "  Secret key mode: LIVE"
elif [[ "${STRIPE_SECRET_KEY:-}" == sk_test_* ]]; then
  echo "  Secret key mode: TEST"
else
  echo "  WARN — secret key does not look like sk_live_ or sk_test_"
fi

echo
echo "=== Stripe API: Account.retrieve ==="
cd /home/ubuntu/website-prod
/home/ubuntu/website-prod/.venv/bin/python - <<'PY'
import os
import sys

sk = os.environ.get("STRIPE_SECRET_KEY", "")
if not sk:
    print("  SKIP — no STRIPE_SECRET_KEY")
    sys.exit(1)

try:
    import stripe
except ImportError:
    print("  FAIL — stripe package not installed in prod venv")
    sys.exit(1)

stripe.api_key = sk
try:
    acct = stripe.Account.retrieve()
    print(f"  OK — account id={acct.id}")
    charges = getattr(acct, "charges_enabled", None)
    payouts = getattr(acct, "payouts_enabled", None)
    print(f"  charges_enabled={charges}  payouts_enabled={payouts}")
    if charges is False:
        print("  >> Live charges are disabled — finish Stripe account activation / review.")
except stripe.error.StripeError as e:
    print(f"  FAIL — {getattr(e, 'user_message', None) or e}")
    sys.exit(1)
PY

echo
echo "=== Recent checkout errors (journal) ==="
sudo journalctl -u webapi-prod -n 120 --no-pager 2>/dev/null | grep -iE 'stripe|checkout' | tail -15 || echo "  (no matches)"

echo
echo "Done. If Account.retrieve fails, fix keys in .env.prod and: sudo systemctl restart webapi-prod"
