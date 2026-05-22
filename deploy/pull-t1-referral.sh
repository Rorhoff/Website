#!/usr/bin/env bash
# pull-t1-referral.sh — build T1Referral (Vite/React) and deploy to static/t1-referral
#
# The T1Referral repo is source code — it must be npm-built with base /t1-referral/
# before FastAPI can serve it under https://rorhoff.com/t1-referral/
#
# Run from the Website repo root:
#   bash deploy/pull-t1-referral.sh
#
# Optional SSH URL for a private repo:
#   T1REFERRAL_REPO_URL=git@github.com:Rorhoff/T1Referral.git bash deploy/pull-t1-referral.sh
#
# Requires: git, node (>=18), npm, and .env.t1-referral at Website repo root
# (see deploy/.env.t1-referral.example — Vite bakes these in at build time).

set -euo pipefail

REPO_URL="${T1REFERRAL_REPO_URL:-https://github.com/Rorhoff/T1Referral.git}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$ROOT/static/t1-referral"
VITE_BASE="/t1-referral/"
ENV_FILE="${T1REFERRAL_ENV_FILE:-$ROOT/.env.t1-referral}"

if [[ -t 1 ]]; then
  GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; BLUE=$'\e[34m'; RESET=$'\e[0m'
else
  GREEN=""; YELLOW=""; RED=""; BLUE=""; RESET=""
fi
log()  { echo "${BLUE}==>${RESET} $*"; }
ok()   { echo "${GREEN}OK${RESET}  $*"; }
warn() { echo "${YELLOW}WARN${RESET} $*"; }
die()  { echo "${RED}ERR${RESET} $*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || die "git not found on PATH."
command -v npm >/dev/null 2>&1 || die "npm not found — install Node 18+ on this host."

export GIT_TERMINAL_PROMPT=0

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

log "Cloning ${REPO_URL}…"
if ! git clone --depth 1 "$REPO_URL" "$TMP/repo" 2>/dev/null; then
  warn "Could not clone T1Referral."
  warn "Keeping existing ${TARGET} (run git restore static/t1-referral if needed)."
  exit 0
fi

if [[ ! -f "$TMP/repo/package.json" ]]; then
  warn "T1Referral has no package.json — nothing to build."
  exit 0
fi

if [[ ! -f "$ENV_FILE" ]]; then
  die "Missing $ENV_FILE — copy deploy/.env.t1-referral.example and add your Supabase URL + anon key."
fi
if ! grep -qE '^VITE_SUPABASE_URL=.+' "$ENV_FILE" || ! grep -qE '^VITE_SUPABASE_ANON_KEY=.+' "$ENV_FILE"; then
  die "$ENV_FILE must set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (non-empty)."
fi

log "Installing dependencies…"
(cd "$TMP/repo" && npm ci)

log "Building for ${VITE_BASE} (with Supabase env)…"
cp "$ENV_FILE" "$TMP/repo/.env"
(cd "$TMP/repo" && npm run build -- --base="${VITE_BASE}")

[[ -d "$TMP/repo/dist" ]] || die "Build did not produce dist/ — check T1Referral vite build."

mkdir -p "$TARGET"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete "$TMP/repo/dist/" "$TARGET/"
else
  find "$TARGET" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  cp -a "$TMP/repo/dist"/. "$TARGET/"
fi

ok "Deployed built T1Referral to ${TARGET}"
