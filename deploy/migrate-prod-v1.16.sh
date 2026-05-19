#!/usr/bin/env bash
# migrate-prod-v1.16.sh — Gold pro-rata refund columns on classified_ad
#
# Adds the four Stripe snapshot columns used by stripe_service.apply_completed_checkout
# and refund_prorated_gold_for_platform_removal. Idempotent (`IF NOT EXISTS`).
#
# Run this BEFORE deploying prod-v1.16 (`commitprod.sh prod-v1.16`). If code
# deploys first without these columns, the webhook path will fail on INSERT/UPDATE.
#
# Usage:
#   PGPASSWORD='your-real-password' ~/migrate-prod-v1.16.sh
#
# Install (one-time, on EC2):
#   cd /home/ubuntu/Website && git pull
#   cp deploy/migrate-prod-v1.16.sh ~/migrate-prod-v1.16.sh
#   chmod +x ~/migrate-prod-v1.16.sh

set -euo pipefail

RDS_HOST="roryporfolio.cl0oawym20pw.us-west-1.rds.amazonaws.com"
RDS_PORT="5432"
RDS_USER="sysop"
DEV_DB="RoryPorfolioDB"
PROD_DB="Classifieds_Prod"

if [[ -t 1 ]]; then
  GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; BLUE=$'\e[34m'; BOLD=$'\e[1m'; RESET=$'\e[0m'
else
  GREEN=""; YELLOW=""; RED=""; BLUE=""; BOLD=""; RESET=""
fi
log()  { echo "${BLUE}==>${RESET} $*"; }
ok()   { echo "${GREEN}OK${RESET}  $*"; }
warn() { echo "${YELLOW}WARN${RESET} $*"; }
die()  { echo "${RED}ERR${RESET} $*" >&2; exit 1; }

command -v psql >/dev/null 2>&1 || die "psql not found on PATH. Install postgresql-client-18 first (see deploy/README.md)."

read -r -d '' MIGRATION_SQL <<'SQL' || true
BEGIN;

ALTER TABLE classified_ad ADD COLUMN IF NOT EXISTS last_gold_payment_intent_id VARCHAR(255);
ALTER TABLE classified_ad ADD COLUMN IF NOT EXISTS last_gold_payment_cents INTEGER;
ALTER TABLE classified_ad ADD COLUMN IF NOT EXISTS last_gold_window_start TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE classified_ad ADD COLUMN IF NOT EXISTS last_gold_window_end TIMESTAMP WITHOUT TIME ZONE;

COMMIT;
SQL

run_migration() {
  local db="$1"
  log "${BOLD}${db}${RESET}: connecting to ${RDS_USER}@${RDS_HOST}…"
  if psql --host="$RDS_HOST" --port="$RDS_PORT" --username="$RDS_USER" \
          --dbname="$db" --no-psqlrc --quiet \
          --variable=ON_ERROR_STOP=1 \
          --command="$MIGRATION_SQL"; then
    ok "${db}: prod-v1.16 columns applied."
  else
    die "${db}: migration FAILED. See psql output above."
  fi
}

if [[ -z "${PGPASSWORD:-}" ]]; then
  warn "PGPASSWORD is not set — psql will prompt for the RDS password twice (once per DB)."
fi

log "Applying prod-v1.16 migration to BOTH classifieds databases."
log "  DEV  → ${DEV_DB}"
log "  PROD → ${PROD_DB}"
echo

run_migration "$DEV_DB"
run_migration "$PROD_DB"

echo
ok "prod-v1.16 migration complete on both databases."
ok "Next: ~/commitprod.sh prod-v1.16   (and ~/commit.sh for dev)"
