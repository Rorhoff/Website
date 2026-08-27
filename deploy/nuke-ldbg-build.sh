#!/usr/bin/env bash
# nuke-ldbg-build.sh — delete corrupt .next trees and force a clean LDBG rebuild.
#
# Use when /ldbg/_next/static/*.css or webpack-*.js return 400 after deploy.
#
# Usage (on EC2):
#   bash ~/Website/deploy/nuke-ldbg-build.sh
#
set -euo pipefail

DEV_DIR="${DEV_DIR:-/home/ubuntu/Website}"
LDBG="$DEV_DIR/ldbg"
COMMIT="${HOME}/commit.sh"
[[ -x "$COMMIT" ]] || COMMIT="$DEV_DIR/deploy/commit.sh"

ensure_ldbg_up() {
  echo "==> Ensuring ldbg service is running…"
  sudo systemctl start ldbg 2>/dev/null || true
  sleep 3
  if systemctl is-active --quiet ldbg; then
    echo "OK   ldbg is active."
    curl -sS --max-time 8 "http://127.0.0.1:3002/ldbg/api/diag" || true
    echo
    return 0
  fi
  echo "ERR  ldbg failed to stay up — journalctl -u ldbg -n 50:" >&2
  sudo journalctl -u ldbg -n 50 --no-pager >&2 || true
  return 1
}

# Always try to start ldbg on exit (nuke stops it first; commit may fail verify).
trap 'ensure_ldbg_up || true' EXIT

echo "==> Stopping ldbg…"
sudo systemctl stop ldbg 2>/dev/null || true

echo "==> Removing ${LDBG}/.next and ${LDBG}/.next.prev…"
rm -rf "$LDBG/.next" "$LDBG/.next.prev"

echo "==> Clean rebuild via commit.sh…"
COMMIT_FORCE=1 bash "$COMMIT"

ensure_ldbg_up
