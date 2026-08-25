#!/usr/bin/env bash
# verify-ldbg-static.sh — confirm HTML-referenced _next/static assets exist (post-restart).
set -euo pipefail

BASE="${LDBG_VERIFY_URL:-http://127.0.0.1:3002/ldbg/}"
HTML="$(curl -sS --max-time 15 "$BASE" || true)"
if [[ -z "$HTML" ]]; then
  echo "ERR  LDBG homepage returned empty body: $BASE" >&2
  exit 1
fi

mapfile -t CSS_PATHS < <(printf '%s' "$HTML" | grep -oE '/ldbg/_next/static/chunks/[a-f0-9]+\.css' | sort -u)
if [[ ${#CSS_PATHS[@]} -eq 0 ]]; then
  echo "ERR  No CSS chunk URLs found in LDBG homepage HTML" >&2
  exit 1
fi

ORIGIN="${BASE%/ldbg/}"
FAIL=0
for rel in "${CSS_PATHS[@]}"; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "${ORIGIN}${rel}" || echo 000)"
  if [[ "$code" != "200" ]]; then
    echo "ERR  CSS ${rel} -> HTTP ${code}" >&2
    FAIL=1
  fi
done

if [[ "$FAIL" -ne 0 ]]; then
  echo "ERR  LDBG static assets out of sync — run: rm -rf ldbg/.next && LDBG_BASE_PATH=/ldbg npm run build" >&2
  exit 1
fi

echo "OK   LDBG static CSS chunks (${#CSS_PATHS[@]})"
