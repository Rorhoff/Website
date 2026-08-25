#!/usr/bin/env bash
# verify-ldbg-build-manifest.sh — every referenced _next/static chunk must exist on disk (non-empty).
set -euo pipefail

ROOT="${LDBG_REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
LDBG="$ROOT/ldbg"
MANIFEST="$LDBG/.next/app-build-manifest.json"

if [[ ! -f "$MANIFEST" ]]; then
  echo "ERR  Missing $MANIFEST — run LDBG build first" >&2
  exit 1
fi

collect_refs() {
  grep -oE 'static/chunks/[^"'\'' ]+\.(js|css)' "$MANIFEST" 2>/dev/null || true
  grep -roE 'static/chunks/[a-f0-9-]+\.(js|css)' "$LDBG/.next/server" 2>/dev/null || true
  grep -roE '/ldbg/_next/static/chunks/[a-f0-9-]+\.(js|css)' "$LDBG/.next/server" 2>/dev/null \
    | sed 's|.*/ldbg/_next/||' || true
}

mapfile -t REFS < <(collect_refs | sort -u)
if [[ ${#REFS[@]} -eq 0 ]]; then
  echo "ERR  No chunk paths found in LDBG build output" >&2
  exit 1
fi

FAIL=0
for rel in "${REFS[@]}"; do
  [[ -z "$rel" ]] && continue
  path="$LDBG/.next/$rel"
  if [[ ! -s "$path" ]]; then
    echo "ERR  Missing or empty chunk: $rel" >&2
    FAIL=1
  fi
done

if [[ "$FAIL" -ne 0 ]]; then
  echo "ERR  LDBG build incomplete — Turbopack can omit lazy chunks; use: LDBG_BASE_PATH=/ldbg npm run build" >&2
  exit 1
fi

echo "OK   LDBG build manifest (${#REFS[@]} chunks on disk)"
