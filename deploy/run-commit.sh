#!/usr/bin/env bash
# Thin launcher — always runs the repo copy of commit.sh (survives broken ~/commit.sh).
set -euo pipefail
REPO="${LDBG_REPO_ROOT:-/home/ubuntu/Website}"
exec bash "$REPO/deploy/commit.sh" "$@"
