#!/usr/bin/env bash
# repair-ldbg-static.sh — clean LDBG .next rebuild + verify (no Referr-All / DB migrations).
#
# Use when /ldbg loads unstyled and DevTools shows 400 on _next/static/css or webpack-*.js.
#
# Usage (on EC2):
#   bash ~/Website/deploy/repair-ldbg-static.sh
#
set -euo pipefail

DEV_DIR="${DEV_DIR:-/home/ubuntu/Website}"
LDBG="$DEV_DIR/ldbg"

log() { echo "==> $*"; }
die() { echo "ERR  $*" >&2; exit 1; }

[[ -d "$DEV_DIR/.git" ]] || die "Not a git checkout: $DEV_DIR"

avail_kb="$(df -Pk "$DEV_DIR" | awk 'NR==2 {print $4}')"
if [[ "${avail_kb:-0}" -lt 2097152 ]]; then
  die "Less than 2GB free on $(df -h "$DEV_DIR" | awk 'NR==2 {print $1}') — free disk before rebuilding LDBG."
fi

log "Pulling latest main…"
git -C "$DEV_DIR" fetch origin main --prune
git -C "$DEV_DIR" checkout main >/dev/null
git -C "$DEV_DIR" pull --ff-only origin main
log "At $(git -C "$DEV_DIR" rev-parse --short HEAD)"

log "Stopping ldbg…"
sudo systemctl stop ldbg 2>/dev/null || true

log "Removing stale .next trees…"
rm -rf "$LDBG/.next" "$LDBG/.next.prev"

if [[ -d "$LDBG/node_modules" ]]; then
  log "Using existing node_modules (npm ci skipped)."
else
  log "Installing LDBG dependencies…"
  (cd "$LDBG" && npm ci)
fi

log "Building LDBG…"
LDBG_REPO_ROOT="$DEV_DIR" bash "$DEV_DIR/deploy/ldbg-build.sh"

log "Restarting ldbg…"
sudo systemctl restart ldbg
sleep 3
systemctl is-active --quiet ldbg || die "ldbg failed to start — journalctl -u ldbg -n 40"

log "Verifying static assets on :3002…"
LDBG_REPO_ROOT="$DEV_DIR" bash "$DEV_DIR/deploy/verify-ldbg-static.sh"

log "Restarting roryportfolio (FastAPI proxy)…"
sudo systemctl restart roryportfolio
sleep 2

log "Verifying static assets through proxy :8000…"
LDBG_VERIFY_ORIGIN="http://127.0.0.1:8000" LDBG_REPO_ROOT="$DEV_DIR" \
  bash "$DEV_DIR/deploy/verify-ldbg-static.sh"

log "OK   LDBG static repair complete — hard-refresh https://rorhoff.com/ldbg/"
