#!/usr/bin/env bash
# Install system libraries required by Puppeteer's bundled Chrome (LDBG board PDF/PNG export).
# Symptom: libatk-1.0.so.0: cannot open shared object file
#
# Usage (on Ubuntu EC2):
#   bash deploy/ensure-ldbg-puppeteer-deps.sh
#
# Safe to re-run — apt-get install is idempotent.

set -euo pipefail

log() { echo "==> $*"; }
ok() { echo "OK $*"; }
warn() { echo "WARN $*" >&2; }

if ! command -v apt-get >/dev/null 2>&1; then
  warn "apt-get not found — install Chrome deps manually (see ldbg/README.md)."
  exit 0
fi

CHROME=""
for candidate in \
  /home/ubuntu/.cache/puppeteer/chrome/*/chrome-linux64/chrome \
  /root/.cache/puppeteer/chrome/*/chrome-linux64/chrome; do
  # shellcheck disable=SC2086
  found=$(ls $candidate 2>/dev/null | head -1 || true)
  if [[ -n "$found" && -x "$found" ]]; then
    CHROME="$found"
    break
  fi
done

if [[ -n "$CHROME" ]] && ldd "$CHROME" 2>/dev/null | grep -q 'not found'; then
  log "Puppeteer Chrome missing shared libraries — installing packages…"
elif [[ -n "$CHROME" ]]; then
  ok "Puppeteer Chrome shared libraries look satisfied ($CHROME)"
  exit 0
else
  log "Puppeteer Chrome not cached yet — installing common headless Chrome deps…"
fi

export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq

PACKAGES=(
  ca-certificates
  fonts-liberation
  libasound2
  libatk-bridge2.0-0
  libatk1.0-0
  libcairo2
  libcups2
  libdbus-1-3
  libdrm2
  libexpat1
  libfontconfig1
  libgbm1
  libglib2.0-0
  libgtk-3-0
  libnspr4
  libnss3
  libpango-1.0-0
  libpangocairo-1.0-0
  libx11-6
  libx11-xcb1
  libxcb1
  libxcomposite1
  libxcursor1
  libxdamage1
  libxext6
  libxfixes3
  libxi6
  libxkbcommon0
  libxrandr2
  libxrender1
  libxss1
  libxtst6
)

if ! sudo apt-get install -y -qq "${PACKAGES[@]}" 2>/dev/null; then
  log "Retrying with Ubuntu 24.04 package names (t64)…"
  sudo apt-get install -y -qq \
    ca-certificates fonts-liberation \
    libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 \
    libcairo2 libcups2t64 libdbus-1-3 libdrm2 libexpat1 \
    libfontconfig1 libgbm1 libglib2.0-0t64 libgtk-3-0t64 \
    libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 \
    libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 \
    libxdamage1 libxext6 libxfixes3 libxi6 libxkbcommon0 \
    libxrandr2 libxrender1 libxss1 libxtst6 \
    || warn "Some packages failed — PDF export may still fail until deps are installed."
fi

if [[ -n "$CHROME" ]] && ldd "$CHROME" 2>/dev/null | grep -q 'not found'; then
  warn "Chrome still reports missing libraries after apt install:"
  ldd "$CHROME" 2>/dev/null | grep 'not found' || true
  exit 1
fi

ok "Puppeteer / Chrome system dependencies installed."
