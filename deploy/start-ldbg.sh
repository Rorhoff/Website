#!/usr/bin/env bash
# start-ldbg.sh — start or restart ldbg and print diag + recent logs if it fails.
set -euo pipefail

DEV_DIR="${DEV_DIR:-/home/ubuntu/Website}"
LDBG="$DEV_DIR/ldbg"

if [[ ! -d "$LDBG/.next" ]]; then
  echo "ERR  Missing $LDBG/.next — run: bash $DEV_DIR/deploy/nuke-ldbg-build.sh" >&2
  exit 1
fi

echo "==> Restarting ldbg…"
sudo systemctl restart ldbg
sleep 3

if systemctl is-active --quiet ldbg; then
  echo "OK   ldbg is active."
  curl -sS --max-time 8 "http://127.0.0.1:3002/ldbg/api/diag" || true
  echo
  exit 0
fi

echo "ERR  ldbg did not stay running:" >&2
sudo journalctl -u ldbg -n 60 --no-pager >&2
exit 1
