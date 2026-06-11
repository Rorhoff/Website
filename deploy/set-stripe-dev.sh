#!/usr/bin/env bash
# set-stripe-dev.sh — paste TEST Stripe keys into dev .env and restart the rorhoff.com API.
#
# Run on EC2 (interactive — secrets stay out of git):
#   cd ~/Website && git pull && bash deploy/set-stripe-dev.sh
#
# Prereqs: create a TEST webhook in Stripe Dashboard → Developers → Webhooks:
#   URL:   https://rorhoff.com/api/referr-all/premium/webhook
#   Event: checkout.session.completed
#   (Optional second endpoint for Classifieds gold:
#    https://rorhoff.com/api/classifieds/gold/webhook)

set -euo pipefail

ENV_FILE="${ENV_FILE:-/home/ubuntu/Website/.env.dev}"
PUBLIC_BASE="https://rorhoff.com"
WEBHOOK_URL="${PUBLIC_BASE}/api/referr-all/premium/webhook"

if [[ -t 1 ]]; then
  GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; BLUE=$'\e[34m'; RESET=$'\e[0m'
else
  GREEN=""; YELLOW=""; RED=""; BLUE=""; RESET=""
fi
log()  { echo "${BLUE}==>${RESET} $*"; }
ok()   { echo "${GREEN}OK${RESET}  $*"; }
warn() { echo "${YELLOW}WARN${RESET} $*"; }
die()  { echo "${RED}ERR${RESET} $*" >&2; exit 1; }

[[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE — create it or set ENV_FILE=..."

detect_service() {
  if systemctl list-unit-files --type=service 2>/dev/null | grep -q '^roryportfolio\.service'; then
    echo "roryportfolio"
  elif systemctl list-unit-files --type=service 2>/dev/null | grep -q '^webapi-dev\.service'; then
    echo "webapi-dev"
  else
    echo "roryportfolio"
  fi
}

set_env_var() {
  local key="$1"
  local value="$2"
  local file="$3"
  local escaped
  escaped=$(printf '%s' "$value" | sed 's/[&|]/\\&/g')
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$file"
  else
    printf '\n# Stripe (Referr-All + Classifieds on rorhoff.com dev)\n' >>"$file"
    echo "${key}=${value}" >>"$file"
  fi
}

SERVICE="$(detect_service)"

backup="${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"
cp "$ENV_FILE" "$backup"
ok "Backed up env to $backup"

echo
log "Referr-All / Classifieds — TEST Stripe keys for rorhoff.com dev"
echo "  Dashboard: https://dashboard.stripe.com/test/apikeys"
echo "  Webhook:   ${WEBHOOK_URL}"
echo "             Event: checkout.session.completed"
echo

read -rsp "STRIPE_SECRET_KEY (sk_test_...): " STRIPE_SECRET_KEY
echo
read -rsp "STRIPE_PUBLISHABLE_KEY (pk_test_...): " STRIPE_PUBLISHABLE_KEY
echo
read -rsp "STRIPE_WEBHOOK_SECRET for Referr-All (whsec_...): " REFERR_ALL_WEBHOOK
echo

[[ "$STRIPE_SECRET_KEY" == sk_test_* ]] || die "Secret key should start with sk_test_ (toggle Test mode in Stripe)."
[[ "$STRIPE_PUBLISHABLE_KEY" == pk_test_* ]] || die "Publishable key should start with pk_test_."
[[ "$REFERR_ALL_WEBHOOK" == whsec_* ]] || die "Webhook secret should start with whsec_."

echo
read -rp "Also use Classifieds gold webhook on dev? [y/N]: " also_classifieds
CLASSIFIEDS_WEBHOOK=""
if [[ "${also_classifieds,,}" == "y" ]]; then
  echo "  Classifieds webhook: ${PUBLIC_BASE}/api/classifieds/gold/webhook"
  read -rsp "STRIPE_WEBHOOK_SECRET for Classifieds (whsec_..., or Enter to reuse Referr-All): " CLASSIFIEDS_WEBHOOK
  echo
  if [[ -z "$CLASSIFIEDS_WEBHOOK" ]]; then
    CLASSIFIEDS_WEBHOOK="$REFERR_ALL_WEBHOOK"
  fi
  [[ "$CLASSIFIEDS_WEBHOOK" == whsec_* ]] || die "Classifieds webhook secret should start with whsec_."
else
  CLASSIFIEDS_WEBHOOK="$REFERR_ALL_WEBHOOK"
fi

set_env_var "STRIPE_SECRET_KEY" "$STRIPE_SECRET_KEY" "$ENV_FILE"
set_env_var "STRIPE_PUBLISHABLE_KEY" "$STRIPE_PUBLISHABLE_KEY" "$ENV_FILE"
set_env_var "STRIPE_PUBLIC_BASE_URL" "$PUBLIC_BASE" "$ENV_FILE"
set_env_var "STRIPE_WEBHOOK_SECRET" "$CLASSIFIEDS_WEBHOOK" "$ENV_FILE"
set_env_var "REFERR_ALL_STRIPE_WEBHOOK_SECRET" "$REFERR_ALL_WEBHOOK" "$ENV_FILE"

ok "Updated STRIPE_* in $ENV_FILE"

log "Restarting ${SERVICE}…"
sudo systemctl restart "$SERVICE"
sleep 2
if systemctl is-active --quiet "$SERVICE"; then
  ok "${SERVICE} is running."
else
  die "${SERVICE} failed — check: sudo journalctl -u ${SERVICE} -n 40 --no-pager"
fi

if command -v curl >/dev/null 2>&1; then
  echo
  log "Referr-All payment status:"
  curl -sS "http://127.0.0.1:8000/api/referr-all/status" | python3 -m json.tool 2>/dev/null \
    || warn "Could not reach /api/referr-all/status"
fi

echo
ok "Done. Test Featured checkout with card 4242 4242 4242 4242."
if [[ "$REFERR_ALL_WEBHOOK" != "$CLASSIFIEDS_WEBHOOK" ]]; then
  warn "Referr-All and Classifieds use different webhook secrets — create both endpoints in Stripe test mode."
fi
