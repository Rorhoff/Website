#!/usr/bin/env bash
# set-classifieds-admin.sh — grant classifieds admin (+verified) by email.
#
# Marks the account with the given email as is_admin + is_verified in the
# prod classifieds database, and prints the account's username so you can
# see what it is (login also accepts email as of prod-v1.54).
#
# Usage:
#   PGPASSWORD='your-real-password' ~/set-classifieds-admin.sh                       # rorhoff@gmail.com, prod DB
#   PGPASSWORD='...' ~/set-classifieds-admin.sh someone@example.com                  # another email, prod DB
#   PGPASSWORD='...' TARGET_DB=dev ~/set-classifieds-admin.sh                        # dev DB instead

set -euo pipefail

RDS_HOST="roryporfolio.cl0oawym20pw.us-west-1.rds.amazonaws.com"
RDS_PORT="5432"
RDS_USER="sysop"
DEV_DB="RoryPorfolioDB"
PROD_DB="Classifieds_Prod"

EMAIL="${1:-rorhoff@gmail.com}"
# Strip quotes/apostrophes — value is interpolated into SQL below.
EMAIL="${EMAIL//[\'\"]/}"

DB="$PROD_DB"
if [[ "${TARGET_DB:-prod}" == "dev" ]]; then
  DB="$DEV_DB"
fi

if [[ -t 1 ]]; then
  GREEN=$'\e[32m'; RED=$'\e[31m'; BLUE=$'\e[34m'; RESET=$'\e[0m'
else
  GREEN=""; RED=""; BLUE=""; RESET=""
fi
log()  { echo "${BLUE}==>${RESET} $*"; }
ok()   { echo "${GREEN}OK${RESET}  $*"; }
die()  { echo "${RED}ERR${RESET} $*" >&2; exit 1; }

command -v psql >/dev/null 2>&1 || die "psql not found on PATH."

if [[ -z "${PGPASSWORD:-}" ]]; then
  read -rsp "RDS password for ${RDS_USER}: " PGPASSWORD
  echo
  export PGPASSWORD
fi

log "Granting classifieds admin to ${EMAIL} in ${DB}…"
RESULT=$(psql "host=${RDS_HOST} port=${RDS_PORT} user=${RDS_USER} dbname=${DB}" \
  --set ON_ERROR_STOP=1 --tuples-only --no-align <<SQL
UPDATE classified_user
   SET is_admin = TRUE,
       is_verified = TRUE
 WHERE LOWER(email) = LOWER('${EMAIL}')
RETURNING id || '|' || username || '|' || email;
SQL
)

if [[ -z "$RESULT" ]]; then
  die "No account found with email ${EMAIL} in ${DB}. Check the address (SELECT username, email FROM classified_user)."
fi

while IFS='|' read -r uid uname uemail; do
  [[ -z "$uid" ]] && continue
  ok "Admin granted: username '${uname}' (id ${uid}, ${uemail})."
done <<< "$RESULT"

ok "Done. Log out and back in for the admin flag to take effect."
