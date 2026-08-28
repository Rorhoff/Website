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

# On failure: do not restore .next.prev — it is often the same corrupt tree that
# caused missing webpack/css (HTML from new build + 400 on static files).
on_build_fail() {
  if [[ $? -ne 0 ]]; then
    echo "ERR  LDBG build failed — leaving .next removed (not rolling back to .next.prev)" >&2
    rm -rf .next
    rm -rf "$PREV"
  fi
}

trap on_build_fail EXIT

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
projects_page_js="$(grep -oE 'static/chunks/app/projects/\%5Bid\%5D/page-[a-f0-9]+\.js' "$LDBG/.next/app-build-manifest.json" | head -1 || true)"
for rel in "$layout_css" "$webpack_js" "$projects_page_js"; do
  [[ -z "$rel" ]] && continue
  fp="$LDBG/.next/$rel"
  if [[ ! -s "$fp" ]]; then
    echo "ERR  Missing or empty build artifact: $rel" >&2
    exit 1
  fi
done

if [[ -f "$LDBG/.next/BUILD_ID" ]]; then
  bid="$(tr -d '\n\r' <"$LDBG/.next/BUILD_ID")"
  for rel in "static/${bid}/_buildManifest.js" "static/${bid}/_ssgManifest.js"; do
    fp="$LDBG/.next/$rel"
    if [[ ! -s "$fp" ]]; then
      echo "ERR  Missing or empty build artifact: $rel" >&2
      exit 1
    fi
  done
fi

if grep -rq '"/_next/static' .next/server 2>/dev/null \
  && ! grep -rq '"/ldbg/_next/static' .next/server 2>/dev/null; then
  echo "ERR  Build missing basePath /ldbg in server manifests" >&2
  exit 1
fi

git -C "$ROOT" rev-parse --short HEAD >"$LDBG/.ldbg-build-rev"

rm -rf "$PREV"
trap - EXIT
echo "OK   LDBG build at $(cat "$LDBG/.ldbg-build-rev")"
