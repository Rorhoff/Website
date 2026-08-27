#!/usr/bin/env bash
# rebuild-ldbg.sh — deprecated wrapper; full dev deploy is ~/commit.sh
#
# commit.sh already pulls main, builds LDBG (webpack + manifest verify), installs
# Python/Puppeteer deps, restarts ldbg, and rolls back .next on static verify failure.
#
# Usage (preferred):
#   ~/commit.sh
#
# This file remains so old docs/commands still work:
#   bash ~/Website/deploy/rebuild-ldbg.sh
#   bash ~/Website/deploy/nuke-ldbg-build.sh   (when _next/static returns 400)

set -euo pipefail

COMMIT="${HOME}/commit.sh"
REPO_COMMIT="/home/ubuntu/Website/deploy/commit.sh"

if [[ -x "$COMMIT" ]]; then
  echo "==> rebuild-ldbg.sh: running ${COMMIT} (full dev deploy)…"
  exec "$COMMIT" "$@"
fi

if [[ -f "$REPO_COMMIT" ]]; then
  echo "==> rebuild-ldbg.sh: running ${REPO_COMMIT}…"
  exec bash "$REPO_COMMIT" "$@"
fi

echo "ERR  Install commit.sh first: cp /home/ubuntu/Website/deploy/commit.sh ~/commit.sh && chmod +x ~/commit.sh" >&2
exit 1
