#!/usr/bin/env bash
# set-stripe-live-prod.sh — paste live Stripe keys into prod .env and restart webapi-prod.
#
# Run on EC2 (interactive — secrets are not stored in this file):
#   bash set-stripe-live-prod.sh
#
# Or one-liner after git pull:
#   cd ~/Website && git pull && bash deploy/set-stripe-live-prod.sh
#
# Prereqs: webhook destination already created in Stripe LIVE mode with:
#   URL: https://t1classifieds.com/api/classifieds/gold/webhook
#   Event: checkout.session.completed

set -euo pipefail

ENV_FILE="/home/ubuntu/website-prod/.env.prod"
SERVICE="webapi-prod"
PUBLIC_BASE="https://t1classifieds.com"

if [[ -t 1 ]]; then
  GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; BLUE=$'\e[34m'; RESET=$'\e[0m'
else
  GREEN=""; YELLOW=""; RED=""; BLUE=""; RESET=""
fi
log()  { echo "${BLUE}==>${RESET} $*"; }
ok()   { echo "${GREEN}OK${RESET}  $*"; }
warn() { echo "${YELLOW}WARN${RESET} $*"; }
die()  { echo "${RED}ERR${RESET} $*" >&2; exit 1; }

[[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE — is website-prod checked out?"

set_env_var() {
  local key="$1"
  local value="$2"
  local file="$3"
  # Escape & and | for sed replacement delimiter |
  local escaped
  escaped=$(printf '%s' "$value" | sed 's/[&|]/\\&/g')
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$file"
  else
    echo "${key}=${value}" >>"$file"
  fi
}

backup="${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"
cp "$ENV_FILE" "$backup"
ok "Backed up env to $backup"

echo
log "Enter LIVE Stripe keys (from dashboard.stripe.com — Test mode OFF)."
echo "  Secret:     Developers → API keys → Secret key (sk_live_...)"
echo "  Publishable: Developers → API keys → Publishable key (pk_live_...)"
echo "  Webhook:    Developers → Webhooks → your destination → Signing secret (whsec_...)"
echo

read -rsp "STRIPE_SECRET_KEY (sk_live_...): " STRIPE_SECRET_KEY
echo
read -rsp "STRIPE_PUBLISHABLE_KEY (pk_live_...): " STRIPE_PUBLISHABLE_KEY
echo
read -rsp "STRIPE_WEBHOOK_SECRET (whsec_...): " STRIPE_WEBHOOK_SECRET
echo

[[ "$STRIPE_SECRET_KEY" == sk_live_* ]] || die "Secret key should start with sk_live_ (you may be in test mode)."
[[ "$STRIPE_PUBLISHABLE_KEY" == pk_live_* ]] || die "Publishable key should start with pk_live_."
[[ "$STRIPE_WEBHOOK_SECRET" == whsec_* ]] || die "Webhook secret should start with whsec_ (use LIVE destination, not test)."

set_env_var "STRIPE_SECRET_KEY" "$STRIPE_SECRET_KEY" "$ENV_FILE"
set_env_var "STRIPE_PUBLISHABLE_KEY" "$STRIPE_PUBLISHABLE_KEY" "$ENV_FILE"
set_env_var "STRIPE_WEBHOOK_SECRET" "$STRIPE_WEBHOOK_SECRET" "$ENV_FILE"
set_env_var "STRIPE_PUBLIC_BASE_URL" "$PUBLIC_BASE" "$ENV_FILE"

ok "Updated STRIPE_* in $ENV_FILE"

log "Restarting ${SERVICE}…"
sudo systemctl restart "$SERVICE"
sleep 2
if systemctl is-active --quiet "$SERVICE"; then
  ok "${SERVICE} is running."
else
  die "${SERVICE} failed to start — check: sudo journalctl -u ${SERVICE} -n 40 --no-pager"
fi

if command -v curl >/dev/null 2>&1; then
  if curl -sf --max-time 5 "http://127.0.0.1:8001/which-app" >/dev/null; then
    ok "Health check http://127.0.0.1:8001/which-app OK."
  else
    warn "Health check did not respond — verify nginx + service."
  fi
fi

echo
ok "Stripe live keys are in prod. Do one real (small) Gold purchase on https://t1classifieds.com to confirm."
warn "Stripe Dashboard → Webhooks → your destination → event deliveries should show 200 for checkout.session.completed."
