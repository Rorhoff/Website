#!/usr/bin/env bash
# Export Aseprite sources to art/build/ and copy to tv/public/assets/.
# Manual step only — Aseprite is not available in CI.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/src"
BUILD="$ROOT/build"
PUBLIC="$ROOT/../tv/public/assets"
SCRIPTS="$ROOT/scripts"

ASEPRITE="${ASEPRITE_BIN:-${ASEPRITE:-aseprite}}"

if [[ "${1:-}" == "--validate-only" ]]; then
  exec "$ASEPRITE" -b --script "$SCRIPTS/validate.lua" --script-param srcDir="$SRC"
fi

if ! command -v "$ASEPRITE" >/dev/null 2>&1; then
  echo "ERROR: Aseprite not found on PATH." >&2
  echo "Install Aseprite and add it to PATH, or set ASEPRITE_BIN to the binary." >&2
  echo "  macOS example: export ASEPRITE_BIN=/Applications/Aseprite.app/Contents/MacOS/aseprite" >&2
  echo "  Windows example: export ASEPRITE_BIN='/c/Program Files/Aseprite/Aseprite.exe'" >&2
  exit 1
fi

mkdir -p "$BUILD" "$PUBLIC"

export_one() {
  local src_file="$1"
  local atlas_key="$2"
  local out_png="$BUILD/${atlas_key}.png"
  local out_json="$BUILD/${atlas_key}.json"

  if [[ ! -f "$src_file" ]]; then
    echo "SKIP  missing source $(basename "$src_file")"
    return 0
  fi

  echo "EXPORT $atlas_key ← $(basename "$src_file")"
  "$ASEPRITE" -b "$src_file" \
    --sheet "$out_png" \
    --data "$out_json" \
    --format json-array \
    --list-tags \
    --sheet-pack \
    --shape-padding 1

  "$ASEPRITE" -b --script "$SCRIPTS/palette-swap.lua" \
    --script-param jsonPath="$out_json" \
    --script-param atlasKey="$atlas_key"
}

# One sheet per source file — never pack multiple sources together.
export_one "$SRC/whelp.aseprite"   "whelp_blue"
export_one "$SRC/mother.aseprite"  "mother_blue"
export_one "$SRC/wyrm.aseprite"      "wyrm"
export_one "$SRC/props.aseprite"     "props"

# Team recolors: palette-swap script duplicates blue exports to red variants.
if [[ -f "$BUILD/whelp_blue.png" ]]; then
  cp "$BUILD/whelp_blue.png" "$BUILD/whelp_red.png"
  cp "$BUILD/whelp_blue.json" "$BUILD/whelp_red.json"
  "$ASEPRITE" -b --script "$SCRIPTS/palette-swap.lua" \
    --script-param jsonPath="$BUILD/whelp_red.json" \
    --script-param atlasKey="whelp_red" \
    --script-param recolor=red
fi

if [[ -f "$BUILD/mother_blue.png" ]]; then
  cp "$BUILD/mother_blue.png" "$BUILD/mother_red.png"
  cp "$BUILD/mother_blue.json" "$BUILD/mother_red.json"
  "$ASEPRITE" -b --script "$SCRIPTS/palette-swap.lua" \
    --script-param jsonPath="$BUILD/mother_red.json" \
    --script-param atlasKey="mother_red" \
    --script-param recolor=red
fi

if [[ -f "$SRC/background.aseprite" ]]; then
  echo "EXPORT background ← background.aseprite"
  "$ASEPRITE" -b "$SRC/background.aseprite" \
    --sheet "$BUILD/background.png" \
    --sheet-pack \
    --shape-padding 1
fi

echo "VALIDATE sources"
"$ASEPRITE" -b --script "$SCRIPTS/validate.lua" --script-param srcDir="$SRC"

echo "COPY → tv/public/assets/"
cp -f "$BUILD"/*.png "$PUBLIC/" 2>/dev/null || true
cp -f "$BUILD"/*.json "$PUBLIC/" 2>/dev/null || true

echo "Done. Commit art/build/ and tv/public/assets/ when satisfied."
