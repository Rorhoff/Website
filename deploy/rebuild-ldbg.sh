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

bash "$ROOT/deploy/ldbg-build.sh"

bash "$ROOT/deploy/ensure-ldbg-python-deps.sh"
bash "$ROOT/deploy/ensure-ldbg-puppeteer-deps.sh"

# Install updated unit (LDBG_PYTHON) when present.
if [[ -f "$ROOT/deploy/ldbg.service" ]] \
  && ! cmp -s "$ROOT/deploy/ldbg.service" /etc/systemd/system/ldbg.service 2>/dev/null; then
  echo "==> Updating ldbg.service…"
  sudo cp "$ROOT/deploy/ldbg.service" /etc/systemd/system/ldbg.service
  sudo systemctl daemon-reload
fi

sudo systemctl restart ldbg
sleep 3

if ! bash "$ROOT/deploy/verify-ldbg-static.sh"; then
  echo "ERR  Static verify failed after restart — rolling back .next and restarting" >&2
  if [[ -d "$LDBG/.next.prev" ]]; then
    rm -rf "$LDBG/.next"
    mv "$LDBG/.next.prev" "$LDBG/.next"
    sudo systemctl restart ldbg
  fi
  exit 1
fi

echo "--- diag ---"
curl -g -sS "http://127.0.0.1:3002/ldbg/api/diag"
echo
echo "OK   LDBG rebuild complete"
