#!/usr/bin/env bash
# set-stripe-referrall-prod.sh — paste LIVE Stripe keys into referr-all.com prod env.
#
# Run on EC2 (interactive — secrets stay out of git):
#   cd /home/ubuntu/website-referrall && git pull
#   bash deploy/set-stripe-referrall-prod.sh
#
# Prereqs: create a LIVE webhook in Stripe Dashboard → Developers → Webhooks:
#   URL:   https://referr-all.com/api/referr-all/premium/webhook
#   Event: checkout.session.completed

set -euo pipefail

REFERRALL_DIR="${REFERRALL_DIR:-/home/ubuntu/website-referrall}"
ENV_FILE="${ENV_FILE:-$REFERRALL_DIR/.env.referrall}"
SERVICE="${REFERRALL_SERVICE:-webapi-referrall}"
PUBLIC_BASE="https://referr-all.com"
WEBHOOK_URL="${PUBLIC_BASE}/api/referr-all/premium/webhook"
HEALTH_URL="http://127.0.0.1:8002/which-app"
STATUS_URL="http://127.0.0.1:8002/api/referr-all/status"

if [[ -t 1 ]]; then
  GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; BLUE=$'\e[34m'; RESET=$'\e[0m'
else
  GREEN=""; YELLOW=""; RED=""; BLUE=""; RESET=""
fi
log()  { echo "${BLUE}==>${RESET} $*"; }
ok()   { echo "${GREEN}OK${RESET}  $*"; }
warn() { echo "${YELLOW}WARN${RESET} $*"; }
die()  { echo "${RED}ERR${RESET} $*" >&2; exit 1; }

set_env_var() {
  local key="$1"
  local value="$2"
  local file="$3"
  local escaped
  escaped=$(printf '%s' "$value" | sed 's/[&|]/\\&/g')
  if grep -qE "^[[:space:]]*(export[[:space:]]+)?${key}=" "$file" 2>/dev/null; then
    sed -i "s|^[[:space:]]*\(export[[:space:]]\+\)\?${key}=.*|\1${key}=${escaped}|" "$file"
  else
    printf '\n# Stripe (Referr-All featured posts on referr-all.com)\n' >>"$file"
    echo "${key}=${value}" >>"$file"
  fi
}

[[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE — is website-referrall provisioned? (see deploy/setup-referr-all-prod.sh)"

backup="${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"
cp "$ENV_FILE" "$backup"
ok "Backed up env to $backup"

echo
log "Referr-All prod (referr-all.com) — LIVE Stripe keys"
echo "  Dashboard: https://dashboard.stripe.com/apikeys  (Test mode OFF)"
echo "  Webhook:   ${WEBHOOK_URL}"
echo "             Event: checkout.session.completed"
echo

read -rsp "STRIPE_SECRET_KEY (sk_live_...): " STRIPE_SECRET_KEY
echo
read -rsp "STRIPE_PUBLISHABLE_KEY (pk_live_...): " STRIPE_PUBLISHABLE_KEY
echo
read -rsp "REFERR_ALL webhook signing secret (whsec_...): " REFERR_ALL_WEBHOOK
echo

[[ "$STRIPE_SECRET_KEY" == sk_live_* ]] || die "Secret key should start with sk_live_ (toggle Test mode OFF in Stripe)."
[[ "$STRIPE_PUBLISHABLE_KEY" == pk_live_* ]] || die "Publishable key should start with pk_live_."
[[ "$REFERR_ALL_WEBHOOK" == whsec_* ]] || die "Webhook secret should start with whsec_ (use the LIVE endpoint, not test)."

set_env_var "STRIPE_SECRET_KEY" "$STRIPE_SECRET_KEY" "$ENV_FILE"
set_env_var "STRIPE_PUBLISHABLE_KEY" "$STRIPE_PUBLISHABLE_KEY" "$ENV_FILE"
set_env_var "STRIPE_PUBLIC_BASE_URL" "$PUBLIC_BASE" "$ENV_FILE"
set_env_var "REFERR_ALL_STRIPE_WEBHOOK_SECRET" "$REFERR_ALL_WEBHOOK" "$ENV_FILE"
# Some tooling still reads STRIPE_WEBHOOK_SECRET; keep both in sync for Referr-All-only prod.
set_env_var "STRIPE_WEBHOOK_SECRET" "$REFERR_ALL_WEBHOOK" "$ENV_FILE"

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
  if curl -sf --max-time 5 "$HEALTH_URL" >/dev/null; then
    ok "Health check ${HEALTH_URL} OK."
  else
    warn "Health check did not respond — verify nginx + service."
  fi
  echo
  log "Referr-All payment status:"
  curl -sS "$STATUS_URL" | python3 -m json.tool 2>/dev/null \
    || warn "Could not reach ${STATUS_URL}"
fi

echo
ok "Done. Test Featured checkout on https://referr-all.com with a real card (or a small amount)."
warn "Stripe Dashboard → Webhooks → event deliveries should show 200 for checkout.session.completed."
