#!/usr/bin/env bash
# migrate-prod-v1.22.sh — Aggregator import columns on classified_ad
#
# Run BEFORE deploying code that reads/writes listing_source / source_* fields.
#
# Usage:
#   PGPASSWORD='your-real-password' ~/migrate-prod-v1.22.sh

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

ALTER TABLE classified_ad
    ADD COLUMN IF NOT EXISTS listing_source VARCHAR(32) NOT NULL DEFAULT 'user';

ALTER TABLE classified_ad
    ADD COLUMN IF NOT EXISTS source_listing_id VARCHAR(64);

ALTER TABLE classified_ad
    ADD COLUMN IF NOT EXISTS source_url VARCHAR(500);

ALTER TABLE classified_ad
    ADD COLUMN IF NOT EXISTS source_last_seen_at TIMESTAMP WITHOUT TIME ZONE;

ALTER TABLE classified_ad
    ADD COLUMN IF NOT EXISTS imported_at TIMESTAMP WITHOUT TIME ZONE;

CREATE INDEX IF NOT EXISTS ix_classified_ad_listing_source
    ON classified_ad (listing_source);

CREATE UNIQUE INDEX IF NOT EXISTS uq_classified_ad_source_listing
    ON classified_ad (listing_source, source_listing_id)
    WHERE source_listing_id IS NOT NULL;

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

ok "v1.22 migration complete."
