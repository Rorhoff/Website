#!/usr/bin/env bash
# verify-ldbg-static.sh — confirm HTML-referenced _next/static assets return 200 (post-restart).
set -euo pipefail

ROOT="${LDBG_REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
ORIGIN="${LDBG_VERIFY_ORIGIN:-http://127.0.0.1:3002}"
MANIFEST="$ROOT/ldbg/.next/app-build-manifest.json"
PATHS=(
  "/ldbg/"
  "/ldbg/projects/new"
  "/ldbg/projects/00000000-0000-0000-0000-000000000000"
)

wait_for_ldbg() {
  local i
  for i in $(seq 1 30); do
    if curl -g -sf --max-time 3 "${ORIGIN}/ldbg/api/diag" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "ERR  LDBG not responding at ${ORIGIN}/ldbg/api/diag" >&2
  return 1
}

manifest_assets() {
  [[ -f "$MANIFEST" ]] || return 0
  grep -oE 'static/(chunks|css)/[^"'\'' ]+\.(js|css)' "$MANIFEST" \
    | sed 's|^|/ldbg/_next/|' \
    | sort -u
  if [[ -f "$ROOT/ldbg/.next/BUILD_ID" ]]; then
    bid="$(tr -d '\n\r' <"$ROOT/ldbg/.next/BUILD_ID")"
    echo "/ldbg/_next/static/${bid}/_buildManifest.js"
    echo "/ldbg/_next/static/${bid}/_ssgManifest.js"
  fi
}

collect_assets() {
  local url="$1"
  local html
  html="$(curl -g -sS --max-time 20 "${ORIGIN}${url}" || true)"
  if [[ -z "$html" ]]; then
    echo "ERR  Empty response: ${url}" >&2
    return 1
  fi
  printf '%s' "$html" | grep -oE '/ldbg/_next/static/[^"'\'' )]+\.(css|js)' | sort -u
}

wait_for_ldbg

ALL_ASSETS=()
while IFS= read -r asset; do
  [[ -z "$asset" ]] && continue
  ALL_ASSETS+=("$asset")
done < <(manifest_assets || true)
for path in "${PATHS[@]}"; do
  while IFS= read -r asset; do
    [[ -z "$asset" ]] && continue
    ALL_ASSETS+=("$asset")
  done < <(collect_assets "$path" || true)
done

mapfile -t UNIQUE_ASSETS < <(printf '%s\n' "${ALL_ASSETS[@]}" | sort -u)
if [[ ${#UNIQUE_ASSETS[@]} -eq 0 ]]; then
  echo "ERR  No static asset URLs found under ${ORIGIN}/ldbg" >&2
  exit 1
fi

FAIL=0
CRITICAL=0
for rel in "${UNIQUE_ASSETS[@]}"; do
  size="$(curl -g -sS -o /dev/null -w '%{http_code}:%{size_download}' --max-time 20 "${ORIGIN}${rel}" || echo "000:0")"
  code="${size%%:*}"
  bytes="${size#*:}"
  if [[ "$code" != "200" ]] || [[ "${bytes:-0}" -lt 32 ]]; then
    echo "ERR  ${rel} -> HTTP ${code} (${bytes} bytes)" >&2
    FAIL=1
    if [[ "$rel" == *"/webpack-"* ]] || [[ "$rel" == *"/static/css/"* ]] || [[ "$rel" == *"/projects/%5Bid%5D/"* ]]; then
      CRITICAL=1
    fi
  fi
done

if [[ "$FAIL" -ne 0 ]]; then
  if [[ "$CRITICAL" -eq 1 ]]; then
    echo "ERR  Critical LDBG chunks missing (webpack/css/projects page) — corrupt .next build" >&2
  fi
  echo "ERR  LDBG static assets broken — run: bash deploy/nuke-ldbg-build.sh" >&2
  exit 1
fi

echo "OK   LDBG static assets (${#UNIQUE_ASSETS[@]} URLs across ${#PATHS[@]} routes)"
