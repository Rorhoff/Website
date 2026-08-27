#!/usr/bin/env bash
# ldbg-build.sh — clean webpack build with .next rollback on failure.
# Usage: bash deploy/ldbg-build.sh
set -euo pipefail

ROOT="${LDBG_REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
LDBG="$ROOT/ldbg"
PREV="$LDBG/.next.prev"

cd "$LDBG"

if [[ -d .next ]]; then
  rm -rf "$PREV"
  mv .next "$PREV"
  echo "==> Backed up previous .next to .next.prev"
fi

restore_prev() {
  if [[ -d "$PREV" ]]; then
    rm -rf .next
    mv "$PREV" .next
    echo "==> Restored previous .next (rollback)"
  fi
}

trap 'if [[ $? -ne 0 ]]; then restore_prev; fi' EXIT

echo "==> Building LDBG (webpack, basePath /ldbg)…"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
LDBG_BASE_PATH=/ldbg npm run build

if find .next/static/chunks -name '*.js' -empty -print -quit 2>/dev/null | grep -q .; then
  echo "ERR  Empty JS chunk in .next — build aborted" >&2
  exit 1
fi

bash "$ROOT/deploy/verify-ldbg-build-manifest.sh"

# Spot-check layout CSS + webpack exist (common failure mode when .next is corrupt).
layout_css="$(grep -oE 'static/css/[a-f0-9]+\.css' "$LDBG/.next/app-build-manifest.json" | head -1 || true)"
webpack_js="$(grep -oE 'static/chunks/webpack-[a-f0-9]+\.js' "$LDBG/.next/app-build-manifest.json" | head -1 || true)"
for rel in "$layout_css" "$webpack_js"; do
  [[ -z "$rel" ]] && continue
  fp="$LDBG/.next/$rel"
  if [[ ! -s "$fp" ]]; then
    echo "ERR  Missing or empty build artifact: $rel" >&2
    exit 1
  fi
done

if grep -rq '"/_next/static' .next/server 2>/dev/null \
  && ! grep -rq '"/ldbg/_next/static' .next/server 2>/dev/null; then
  echo "ERR  Build missing basePath /ldbg in server manifests" >&2
  exit 1
fi

git -C "$ROOT" rev-parse --short HEAD >"$LDBG/.ldbg-build-rev"

rm -rf "$PREV"
trap - EXIT
echo "OK   LDBG build at $(cat "$LDBG/.ldbg-build-rev")"
