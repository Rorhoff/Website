#!/usr/bin/env bash
# rebuild-ldbg.sh — pull latest main, rebuild LDBG, restart service (EC2).
# Usage: bash ~/Website/deploy/rebuild-ldbg.sh

set -euo pipefail

ROOT="${LDBG_REPO_ROOT:-/home/ubuntu/Website}"
LDBG="$ROOT/ldbg"

cd "$ROOT"
git fetch origin main
git checkout main
git pull --ff-only origin main
echo "At commit: $(git rev-parse --short HEAD)"

cd "$LDBG"
npm ci
rm -rf .next
LDBG_BASE_PATH=/ldbg npm run build
bash "$ROOT/deploy/verify-ldbg-build-manifest.sh"
git -C "$ROOT" rev-parse --short HEAD >"$LDBG/.ldbg-build-rev"

bash "$ROOT/deploy/ensure-ldbg-puppeteer-deps.sh"

sudo systemctl restart ldbg
sleep 2

bash "$ROOT/deploy/verify-ldbg-static.sh"

echo "--- diag ---"
curl -sS "http://127.0.0.1:3002/ldbg/api/diag"
echo
