#!/usr/bin/env bash
# migrate-prod-v1.17.sh — Gold refund audit table (anti-abuse + logging)
#
# Run BEFORE deploying code that writes to classified_gold_refund_event.
#
# Usage:
#   PGPASSWORD='your-real-password' ~/migrate-prod-v1.17.sh

set -euo pipefail

RDS_HOST="roryporfolio.cl0oawym20pw.us-west-1.rds.amazonaws.com"
RDS_PORT="5432"
RDS_USER="sysop"
DEV_DB="RoryPorfolioDB"
PROD_DB="Classifieds_Prod"

if [[ -t 1 ]]; then
  GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; BLUE=$'\e[34m'; RESET=$'\e[0m'
else
  GREEN=""; YELLOW=""; RED=""; BLUE=""; RESET=""
fi
log()  { echo "${BLUE}==>${RESET} $*"; }
ok()   { echo "${GREEN}OK${RESET}  $*"; }
die()  { echo "${RED}ERR${RESET} $*" >&2; exit 1; }

command -v psql >/dev/null 2>&1 || die "psql not found on PATH."

read -r -d '' MIGRATION_SQL <<'SQL' || true
BEGIN;

CREATE TABLE IF NOT EXISTS classified_gold_refund_event (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES classified_user(id) ON DELETE SET NULL,
    ad_id VARCHAR(36) NOT NULL,
    payment_intent_id VARCHAR(255),
    reason VARCHAR(64) NOT NULL,
    eligible BOOLEAN NOT NULL DEFAULT FALSE,
    refund_cents INTEGER NOT NULL DEFAULT 0,
    blocked_reason VARCHAR(128),
    breakdown JSONB,
    stripe_refund_id VARCHAR(255),
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT (NOW() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS ix_gold_refund_user_created
    ON classified_gold_refund_event (user_id, created_at);

CREATE INDEX IF NOT EXISTS ix_classified_gold_refund_event_ad_id
    ON classified_gold_refund_event (ad_id);

COMMIT;
SQL

if [[ -z "${PGPASSWORD:-}" ]]; then
  read -rsp "RDS password for ${RDS_USER}: " PGPASSWORD
  echo
  export PGPASSWORD
fi

for db in "$DEV_DB" "$PROD_DB"; do
  log "Migrating ${db}…"
  psql -h "$RDS_HOST" -p "$RDS_PORT" -U "$RDS_USER" -d "$db" -v ON_ERROR_STOP=1 -c "$MIGRATION_SQL"
  ok "${db}"
done

ok "v1.17 migration complete."
