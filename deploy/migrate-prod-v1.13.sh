#!/usr/bin/env bash
# migrate-prod-v1.13.sh — cumulative DB migration through prod-v1.13.
#
# Applies BOTH outstanding column migrations to both classifieds DBs:
#   - prod-v1.12: ADD COLUMN contact_name (seller-chosen display name)
#   - prod-v1.13: ADD COLUMN city         (city picked at ad creation)
#   - prod-v1.13: backfill contact_name = author_username on legacy rows
#
# All statements use IF NOT EXISTS / narrow WHERE clauses so the script is
# safe to re-run, and it works whether you skipped the v1.12 SQL or already
# applied it. Wrapped in BEGIN/COMMIT per DB so a partial failure on one
# database doesn't half-apply on the other.
#
# Run this BEFORE `commitprod.sh prod-v1.13`. If you deploy first by
# mistake, run this immediately after and then
# `sudo systemctl restart webapi-prod`.
#
# Usage (on EC2 or anywhere with psql + network access to the RDS host):
#   PGPASSWORD='your-real-password' ./migrate-prod-v1.13.sh
#
# Or interactively (psql will prompt twice — once per database):
#   ./migrate-prod-v1.13.sh
#
# Install (one-time, on EC2):
#   cd /home/ubuntu/Website && git pull
#   cp deploy/migrate-prod-v1.13.sh ~/migrate-prod-v1.13.sh
#   chmod +x ~/migrate-prod-v1.13.sh

set -euo pipefail

# ---------------------------------------------------------------------------
# Edit these only if the RDS host or admin user ever changes. The two DB
# names cover both dev (rorhoff.com) and prod (t1classifieds.com).
# ---------------------------------------------------------------------------
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

# The whole migration in one transaction per database so a failure on the
# UPDATE rolls back the ALTER too. ALTER ... ADD COLUMN IF NOT EXISTS and
# the narrow WHERE on the UPDATE both make this safe to run twice.
read -r -d '' MIGRATION_SQL <<'SQL' || true
BEGIN;

-- prod-v1.12: seller-chosen display name shown in the ad detail modal.
-- Idempotent ALTER so this is fine to run even on DBs where v1.12 was
-- already applied (no-op).
ALTER TABLE classified_ad ADD COLUMN IF NOT EXISTS contact_name VARCHAR(120);

-- prod-v1.13: city picked at ad-creation time; powers per-ad SEO.
ALTER TABLE classified_ad ADD COLUMN IF NOT EXISTS city VARCHAR(120);

-- prod-v1.13 backfill: legacy ads created before the display-name field
-- existed have contact_name = NULL. The application no longer falls
-- back to the login username at render time, so we set contact_name to
-- the author's username once as a one-time backfill. New ads will
-- always provide their own non-empty contact_name via the API.
UPDATE classified_ad
   SET contact_name = author_username
 WHERE contact_name IS NULL OR contact_name = '';

COMMIT;
SQL

run_migration() {
  local db="$1"
  log "${BOLD}${db}${RESET}: connecting to ${RDS_USER}@${RDS_HOST}…"
  # -v ON_ERROR_STOP=1 makes psql exit non-zero the moment any statement
  # fails, which (combined with `set -e`) means the script halts before
  # touching the second database.
  if psql --host="$RDS_HOST" --port="$RDS_PORT" --username="$RDS_USER" \
          --dbname="$db" --no-psqlrc --quiet \
          --variable=ON_ERROR_STOP=1 \
          --command="$MIGRATION_SQL"; then
    ok "${db}: migration applied."
  else
    die "${db}: migration FAILED. See psql output above."
  fi
}

if [[ -z "${PGPASSWORD:-}" ]]; then
  warn "PGPASSWORD is not set — psql will prompt for the RDS password twice (once per DB)."
fi

log "Applying prod-v1.13 migration to BOTH classifieds databases."
log "  DEV  → ${DEV_DB}"
log "  PROD → ${PROD_DB}"
echo

run_migration "$DEV_DB"
run_migration "$PROD_DB"

echo
ok "prod-v1.13 migration complete on both databases."
ok "Next step: ./commitprod.sh prod-v1.13   (and ./commit.sh for dev)"
