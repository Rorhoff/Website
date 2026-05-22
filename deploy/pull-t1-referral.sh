#!/usr/bin/env bash
# pull-t1-referral.sh — sync static/t1-referral from https://github.com/Rorhoff/T1Referral
#
# Run from the Website repo root (dev machine or EC2):
#   bash deploy/pull-t1-referral.sh
#
# Optional: use SSH for a private repo
#   T1REFERRAL_REPO_URL=git@github.com:Rorhoff/T1Referral.git bash deploy/pull-t1-referral.sh
#
# If the remote repo is empty or clone fails, this script exits 0 and keeps the
# placeholder index.html already committed in Website.

set -euo pipefail

REPO_URL="${T1REFERRAL_REPO_URL:-https://github.com/Rorhoff/T1Referral.git}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$ROOT/static/t1-referral"

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

if [[ ! -f "$TARGET/index.html" ]]; then
  die "Missing $TARGET/index.html — run git pull on Website first."
fi

# Never block deploy on an interactive GitHub username/password prompt.
export GIT_TERMINAL_PROMPT=0

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

log "Cloning ${REPO_URL}…"
if ! git clone --depth 1 "$REPO_URL" "$TMP/repo" 2>/dev/null; then
  warn "Could not clone T1Referral (private repo, auth, or network)."
  warn "Using placeholder from Website git. For a private repo, set T1REFERRAL_REPO_URL=git@github.com:Rorhoff/T1Referral.git"
  exit 0
fi

mapfile -t entries < <(find "$TMP/repo" -mindepth 1 -maxdepth 1 ! -name .git -print)
if [[ ${#entries[@]} -eq 0 ]]; then
  warn "T1Referral repo is empty — keeping existing files in ${TARGET}"
  exit 0
fi

mkdir -p "$TARGET"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude .git "$TMP/repo/" "$TARGET/"
else
  find "$TARGET" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
  cp -a "$TMP/repo"/. "$TARGET/"
  rm -rf "$TARGET/.git" 2>/dev/null || true
fi

ok "Synced T1Referral into ${TARGET}"
