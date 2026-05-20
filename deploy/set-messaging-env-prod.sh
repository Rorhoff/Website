#!/usr/bin/env bash
# set-messaging-env-prod.sh — add messaging / SES env vars to prod .env and restart.
#
# Run on EC2:
#   cd ~/website-prod && git pull
#   bash deploy/set-messaging-env-prod.sh
#
# Test without sending email (logs only):
#   bash deploy/set-messaging-env-prod.sh --dev-log-only
#
# Prereqs:
#   - migrate-prod-v1.33.sh already run on Classifieds_Prod
#   - SES: verify t1classifieds.com + noreply@t1classifieds.com (us-west-1)
#   - EC2 instance role with ses:SendEmail OR AWS_ACCESS_KEY_ID in .env.prod

set -euo pipefail

ENV_FILE="/home/ubuntu/website-prod/.env.prod"
SERVICE="webapi-prod"
PUBLIC_BASE="https://t1classifieds.com"
SES_REGION="${AWS_SES_REGION:-us-west-1}"
EMAIL_FROM="${CLASSIFIEDS_EMAIL_FROM:-noreply@t1classifieds.com}"
MAGIC_TTL="${MAGIC_LINK_TTL_HOURS:-24}"
DEV_LOG_ONLY="0"

usage() {
  cat <<'EOF'
Usage: bash deploy/set-messaging-env-prod.sh [OPTIONS]

  --dev-log-only   Set EMAIL_DEV_LOG_ONLY=1 (no SES sends; emails logged only)
  --no-restart     Update .env.prod but do not restart webapi-prod
  -h, --help       Show this help

AWS credentials: boto3 uses the EC2 instance IAM role by default. If you use
static keys instead, add them to .env.prod manually:
  AWS_ACCESS_KEY_ID=...
  AWS_SECRET_ACCESS_KEY=...
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev-log-only) DEV_LOG_ONLY="1" ;;
    --no-restart)   NO_RESTART=1 ;;
    -h|--help)      usage; exit 0 ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
  shift
done

if [[ -t 1 ]]; then
  GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; BLUE=$'\e[34m'; RESET=$'\e[0m'
else
  GREEN=""; YELLOW=""; RED=""; BLUE=""; RESET=""
fi
log()  { echo "${BLUE}==>${RESET} $*"; }
ok()   { echo "${GREEN}OK${RESET}  $*"; }
warn() { echo "${YELLOW}WARN${RESET} $*"; }
die()  { echo "${RED}ERR${RESET} $*" >&2; exit 1; }

[[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE — deploy website-prod first."

set_env_var() {
  local key="$1"
  local value="$2"
  local file="$3"
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

log "Setting messaging env in $ENV_FILE"
set_env_var "CLASSIFIEDS_PUBLIC_URL" "$PUBLIC_BASE" "$ENV_FILE"
set_env_var "AWS_SES_REGION" "$SES_REGION" "$ENV_FILE"
set_env_var "CLASSIFIEDS_EMAIL_FROM" "$EMAIL_FROM" "$ENV_FILE"
set_env_var "EMAIL_DEV_LOG_ONLY" "$DEV_LOG_ONLY" "$ENV_FILE"
set_env_var "MAGIC_LINK_TTL_HOURS" "$MAGIC_TTL" "$ENV_FILE"

ok "CLASSIFIEDS_PUBLIC_URL=$PUBLIC_BASE"
ok "AWS_SES_REGION=$SES_REGION"
ok "CLASSIFIEDS_EMAIL_FROM=$EMAIL_FROM"
ok "EMAIL_DEV_LOG_ONLY=$DEV_LOG_ONLY"
ok "MAGIC_LINK_TTL_HOURS=$MAGIC_TTL"

if [[ "$DEV_LOG_ONLY" == "1" ]]; then
  warn "EMAIL_DEV_LOG_ONLY=1 — magic-link / message emails will NOT be sent (logged only)."
else
  warn "EMAIL_DEV_LOG_ONLY=0 — SES must be live. Sandbox only sends to verified addresses."
fi

if [[ "${NO_RESTART:-0}" == "1" ]]; then
  ok "Skipping restart (--no-restart)."
  exit 0
fi

log "Restarting ${SERVICE}…"
sudo systemctl restart "$SERVICE"
sleep 2
if systemctl is-active --quiet "$SERVICE"; then
  ok "${SERVICE} is running."
else
  die "${SERVICE} failed — check: sudo journalctl -u ${SERVICE} -n 40 --no-pager"
fi

if command -v curl >/dev/null 2>&1; then
  if curl -sf --max-time 5 "http://127.0.0.1:8001/which-app" >/dev/null; then
    ok "Health check http://127.0.0.1:8001/which-app OK."
  else
    warn "Health check failed — verify nginx + service."
  fi
fi

echo
ok "Messaging env applied. Test Contact Seller on https://t1classifieds.com"
if [[ "$DEV_LOG_ONLY" == "1" ]]; then
  echo "  Watch logs: sudo journalctl -u ${SERVICE} -f | grep -i classifieds-email"
else
  echo "  When SES is ready: bash deploy/set-messaging-env-prod.sh   (without --dev-log-only)"
fi
