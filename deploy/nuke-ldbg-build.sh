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

echo "==> Stopping ldbg…"
sudo systemctl stop ldbg 2>/dev/null || true

echo "==> Removing ${LDBG}/.next and ${LDBG}/.next.prev…"
rm -rf "$LDBG/.next" "$LDBG/.next.prev"

echo "==> Clean rebuild via commit.sh…"
COMMIT_FORCE=1 exec "${HOME}/commit.sh"
