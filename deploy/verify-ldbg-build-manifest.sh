#!/usr/bin/env bash
# verify-ldbg-build-manifest.sh — every chunk in app-build-manifest.json must exist on disk.
set -euo pipefail

ROOT="${LDBG_REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
LDBG="$ROOT/ldbg"
MANIFEST="$LDBG/.next/app-build-manifest.json"

if [[ ! -f "$MANIFEST" ]]; then
  echo "ERR  Missing $MANIFEST — run LDBG build first" >&2
  exit 1
fi

export LDBG_DIR="$LDBG"
node <<'NODE'
const fs = require("fs");
const path = require("path");

const ldbg = process.env.LDBG_DIR;
const manifestPath = path.join(ldbg, ".next/app-build-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const refs = new Set();

for (const files of Object.values(manifest.pages || {})) {
  if (!Array.isArray(files)) continue;
  for (const rel of files) refs.add(rel);
}

if (refs.size === 0) {
  console.error("ERR  No chunk paths in app-build-manifest.json");
  process.exit(1);
}

let fail = 0;
for (const rel of refs) {
  const filePath = path.join(ldbg, ".next", rel);
  try {
    const st = fs.statSync(filePath);
    if (st.size === 0) {
      console.error(`ERR  Empty chunk: ${rel}`);
      fail = 1;
    }
  } catch {
    console.error(`ERR  Missing chunk: ${rel}`);
    fail = 1;
  }
}

if (fail) {
  console.error("ERR  LDBG build incomplete — re-run: bash deploy/ldbg-build.sh");
  process.exit(1);
}

console.log(`OK   LDBG build manifest (${refs.size} chunks on disk)`);
NODE
