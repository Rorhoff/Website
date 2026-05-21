#!/usr/bin/env bash
# cleanup-prod-env-backups.sh — delete .env.prod.bak.* snapshots in website-prod.
#
# Created by set-messaging-env-prod.sh and set-stripe-live-prod.sh before editing
# .env.prod. Safe to remove once you have confirmed prod is healthy.
#
# Run on EC2:
#   cd /home/ubuntu/Website && git pull
#   bash deploy/cleanup-prod-env-backups.sh --dry-run
#   bash deploy/cleanup-prod-env-backups.sh
#
# Install (optional):
#   cp deploy/cleanup-prod-env-backups.sh ~/cleanup-prod-env-backups.sh
#   chmod +x ~/cleanup-prod-env-backups.sh

set -euo pipefail

PROD_DIR="${PROD_DIR:-/home/ubuntu/website-prod}"
DRY_RUN=0

if [[ -t 1 ]]; then
  GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; BLUE=$'\e[34m'; RESET=$'\e[0m'
else
  GREEN=""; YELLOW=""; RED=""; BLUE=""; RESET=""
fi
log()  { echo "${BLUE}==>${RESET} $*"; }
ok()   { echo "${GREEN}OK${RESET}  $*"; }
warn() { echo "${YELLOW}WARN${RESET} $*"; }
die()  { echo "${RED}ERR${RESET} $*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: bash deploy/cleanup-prod-env-backups.sh [OPTIONS]

Deletes timestamped backups matching:
  /home/ubuntu/website-prod/.env.prod.bak.<digits>

Options:
  --dry-run   List files that would be deleted; do not remove anything.
  -h, --help  Show this help.

Environment:
  PROD_DIR    Directory to scan (default: /home/ubuntu/website-prod)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
  shift
done

[[ -d "$PROD_DIR" ]] || die "Directory not found: $PROD_DIR"

shopt -s nullglob
backups=( "$PROD_DIR"/.env.prod.bak.[0-9]* )
shopt -u nullglob

if [[ ${#backups[@]} -eq 0 ]]; then
  ok "No .env.prod.bak.* files in $PROD_DIR"
  exit 0
fi

log "Found ${#backups[@]} backup file(s) in $PROD_DIR"
for f in "${backups[@]}"; do
  base=$(basename "$f")
  # Belt-and-suspenders: only touch the expected backup naming pattern.
  [[ "$base" =~ ^\.env\.prod\.bak\.[0-9]+$ ]] || die "Refusing unexpected name: $base"
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "  would delete: $f"
  else
    rm -f -- "$f"
    echo "  deleted: $f"
  fi
done

if [[ $DRY_RUN -eq 1 ]]; then
  warn "Dry run only — re-run without --dry-run to delete."
else
  ok "Removed ${#backups[@]} backup file(s)."
fi
