#!/usr/bin/env bash
# migrate-prod-v1.55.sh — Admin panel: user suspension column
#
# Run BEFORE deploying prod-v1.55 (code reads classified_user.is_suspended).
# Idempotent; applies to both the dev and prod classifieds databases.
#
# Usage:
#   PGPASSWORD='your-real-password' ~/migrate-prod-v1.55.sh

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

ALTER TABLE classified_user
    ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
SQL

if [[ -z "${PGPASSWORD:-}" ]]; then
  read -rsp "RDS password for ${RDS_USER}: " PGPASSWORD
  echo
  export PGPASSWORD
fi

for DB in "$DEV_DB" "$PROD_DB"; do
  log "Migrating ${DB}…"
  psql "host=${RDS_HOST} port=${RDS_PORT} user=${RDS_USER} dbname=${DB}" \
    --set ON_ERROR_STOP=1 <<<"$MIGRATION_SQL"
  ok "${DB} migrated."
done

ok "v1.55 migration complete."
