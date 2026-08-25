#!/usr/bin/env bash
# verify-ldbg-static.sh — confirm HTML-referenced _next/static assets return 200 (post-restart).
set -euo pipefail

ORIGIN="${LDBG_VERIFY_ORIGIN:-http://127.0.0.1:3002}"
PATHS=(
  "/ldbg/"
  "/ldbg/projects/new"
  "/ldbg/projects/00000000-0000-0000-0000-000000000000"
)

collect_assets() {
  local url="$1"
  local html
  html="$(curl -sS --max-time 20 "${ORIGIN}${url}" || true)"
  if [[ -z "$html" ]]; then
    echo "ERR  Empty response: ${url}" >&2
    return 1
  fi
  printf '%s' "$html" | grep -oE '/ldbg/_next/static/[^"'\'' )]+\.(css|js)' | sort -u
}

ALL_ASSETS=()
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
for rel in "${UNIQUE_ASSETS[@]}"; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "${ORIGIN}${rel}" || echo 000)"
  if [[ "$code" != "200" ]]; then
    echo "ERR  ${rel} -> HTTP ${code}" >&2
    FAIL=1
  fi
done

if [[ "$FAIL" -ne 0 ]]; then
  echo "ERR  LDBG static assets broken — run: bash deploy/rebuild-ldbg.sh" >&2
  exit 1
fi

echo "OK   LDBG static assets (${#UNIQUE_ASSETS[@]} URLs across ${#PATHS[@]} routes)"
