#!/usr/bin/env bash
# migrate-prod-v1.37.sh — Password reset tokens table (hashed, DB-backed)
#
# Run BEFORE deploying code that uses ClassifiedPasswordResetToken.
#
# Usage:
#   PGPASSWORD='your-real-password' ~/migrate-prod-v1.37.sh

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

CREATE TABLE IF NOT EXISTS classified_password_reset_token (
    id VARCHAR(36) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES classified_user(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    used_at TIMESTAMP WITHOUT TIME ZONE,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
    ip_address VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS ix_password_reset_token_hash
    ON classified_password_reset_token (token_hash);

CREATE INDEX IF NOT EXISTS ix_password_reset_user_created
    ON classified_password_reset_token (user_id, created_at DESC);

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

ok "v1.37 migration complete."
