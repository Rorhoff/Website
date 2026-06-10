#!/usr/bin/env bash
# build-t1-referral-local.sh — build ./T1Referral and deploy to static/t1-referral
#
# Use this when you cloned T1Referral next to the Website repo for local edits:
#   git clone https://github.com/Rorhoff/T1Referral.git T1Referral
#
# From Website repo root:
#   bash deploy/build-t1-referral-local.sh
#
# Requires: node (>=18), npm, and .env.t1-referral at Website repo root.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/T1Referral"
TARGET="$ROOT/static/t1-referral"
VITE_BASE="/t1-referral/"
ENV_FILE="${T1REFERRAL_ENV_FILE:-$ROOT/.env.t1-referral}"

if [[ -t 1 ]]; then
  GREEN=$'\e[32m'; RED=$'\e[31m'; BLUE=$'\e[34m'; RESET=$'\e[0m'
else
  GREEN=""; RED=""; BLUE=""; RESET=""
fi
log() { echo "${BLUE}==>${RESET} $*"; }
ok()  { echo "${GREEN}OK${RESET}  $*"; }
die() { echo "${RED}ERR${RESET} $*" >&2; exit 1; }

[[ -d "$SRC/.git" ]] || die "Missing $SRC — clone: git clone https://github.com/Rorhoff/T1Referral.git T1Referral"
[[ -f "$SRC/package.json" ]] || die "T1Referral has no package.json"
command -v npm >/dev/null 2>&1 || die "npm not found — install Node 18+"
[[ -f "$ENV_FILE" ]] || die "Missing $ENV_FILE — copy deploy/.env.t1-referral.example"
grep -qE '^VITE_SUPABASE_URL=.+' "$ENV_FILE" || die "$ENV_FILE needs VITE_SUPABASE_URL"
grep -qE '^VITE_SUPABASE_ANON_KEY=.+' "$ENV_FILE" || die "$ENV_FILE needs VITE_SUPABASE_ANON_KEY"

log "Installing T1Referral dependencies…"
(cd "$SRC" && npm ci)

log "Building for ${VITE_BASE}…"
cp "$ENV_FILE" "$SRC/.env"
(cd "$SRC" && npm run build -- --base="${VITE_BASE}")

[[ -d "$SRC/dist" ]] || die "Build did not produce dist/"

mkdir -p "$TARGET"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete "$SRC/dist/" "$TARGET/"
else
  find "$TARGET" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  cp -a "$SRC/dist"/. "$TARGET/"
fi

ok "Built local T1Referral → ${TARGET}"
