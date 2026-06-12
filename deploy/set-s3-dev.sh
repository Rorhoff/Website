#!/usr/bin/env bash
# set-s3-dev.sh — configure R2/S3 image storage for rorhoff.com dev (Referr-All avatars, etc.)
#
# Run on EC2 (interactive):
#   cd ~/Website && git pull && bash deploy/set-s3-dev.sh
#
# You can reuse the same Cloudflare R2 bucket as t1classifieds with a dev/ prefix.

set -euo pipefail

WEBSITE_DIR="${WEBSITE_DIR:-/home/ubuntu/Website}"

if [[ -t 1 ]]; then
  GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; BLUE=$'\e[34m'; RESET=$'\e[0m'
else
  GREEN=""; YELLOW=""; RED=""; BLUE=""; RESET=""
fi
log()  { echo "${BLUE}==>${RESET} $*"; }
ok()   { echo "${GREEN}OK${RESET}  $*"; }
warn() { echo "${YELLOW}WARN${RESET} $*"; }
die()  { echo "${RED}ERR${RESET} $*" >&2; exit 1; }

resolve_env_file() {
  local candidate=""
  for candidate in \
    "${ENV_FILE:-}" \
    "$WEBSITE_DIR/.env.dev" \
    "$WEBSITE_DIR/.env" \
    "$WEBSITE_DIR/.env.local"; do
    if [[ -n "$candidate" && -f "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

ENV_FILE="$(resolve_env_file || true)"
if [[ -z "$ENV_FILE" ]]; then
  ENV_FILE="$WEBSITE_DIR/.env.dev"
  touch "$ENV_FILE"
  chmod 600 "$ENV_FILE" 2>/dev/null || true
fi

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
    printf '\n# S3 / R2 image storage (Referr-All avatars on rorhoff.com dev)\n' >>"$file"
    echo "${key}=${value}" >>"$file"
  fi
}

SERVICE="$(detect_service)"
log "Using env file: $ENV_FILE"

echo
log "Cloudflare R2 (or S3) credentials for dev image uploads"
echo "  Same bucket as t1classifieds is fine — use S3_KEY_PREFIX=dev/"
echo

read -rp "S3_BUCKET [t1classifieds-prod]: " S3_BUCKET
S3_BUCKET="${S3_BUCKET:-t1classifieds-prod}"
read -rsp "S3_ACCESS_KEY_ID: " S3_ACCESS_KEY_ID
echo
read -rsp "S3_SECRET_ACCESS_KEY: " S3_SECRET_ACCESS_KEY
echo
echo
echo "  Find Account ID in Cloudflare R2 sidebar, then enter:"
echo "  https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
read -rp "S3_ENDPOINT_URL (required for R2): " S3_ENDPOINT_URL
[[ -n "$S3_ENDPOINT_URL" ]] || die "S3_ENDPOINT_URL is required for Cloudflare R2."
read -rp "S3_PUBLIC_BASE_URL [https://images.t1classifieds.com]: " S3_PUBLIC_BASE_URL
S3_PUBLIC_BASE_URL="${S3_PUBLIC_BASE_URL:-https://images.t1classifieds.com}"
read -rp "S3_KEY_PREFIX [dev/]: " S3_KEY_PREFIX
S3_KEY_PREFIX="${S3_KEY_PREFIX:-dev/}"

[[ -n "$S3_ACCESS_KEY_ID" && -n "$S3_SECRET_ACCESS_KEY" ]] || die "Access key and secret are required."

set_env_var "S3_BUCKET" "$S3_BUCKET" "$ENV_FILE"
set_env_var "S3_ACCESS_KEY_ID" "$S3_ACCESS_KEY_ID" "$ENV_FILE"
set_env_var "S3_SECRET_ACCESS_KEY" "$S3_SECRET_ACCESS_KEY" "$ENV_FILE"
set_env_var "S3_PUBLIC_BASE_URL" "$S3_PUBLIC_BASE_URL" "$ENV_FILE"
set_env_var "S3_KEY_PREFIX" "$S3_KEY_PREFIX" "$ENV_FILE"
if [[ -n "$S3_ENDPOINT_URL" ]]; then
  set_env_var "S3_ENDPOINT_URL" "$S3_ENDPOINT_URL" "$ENV_FILE"
fi
set_env_var "S3_REGION" "auto" "$ENV_FILE"

ok "Updated S3_* in $ENV_FILE"
log "Restarting ${SERVICE}…"
sudo systemctl restart "$SERVICE"
sleep 2
systemctl is-active --quiet "$SERVICE" || die "${SERVICE} failed — check journalctl"

if command -v curl >/dev/null 2>&1; then
  echo
  log "Referr-All status:"
  curl -sS "http://127.0.0.1:8000/api/referr-all/status" | python3 -m json.tool 2>/dev/null \
    || warn "Could not reach /api/referr-all/status"
fi

ok "Done. Avatar uploads will use R2 instead of inline base64."
