#!/usr/bin/env bash
# migrate-prod-v1.33.sh — Messaging MVP: user flags, conversations, messages, magic links
#
# Run BEFORE deploying code that uses messaging / magic-link auth.
#
# After migration, optionally grant admin (run manually):
#   UPDATE classified_user SET is_admin = TRUE WHERE username IN ('rorhoff', 'qa_admin');
#   UPDATE classified_user SET is_verified = TRUE WHERE username = 'rorhoff';
#
# Usage:
#   PGPASSWORD='your-real-password' ~/migrate-prod-v1.33.sh

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

-- classified_user: messaging + magic-link accounts
ALTER TABLE classified_user
    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE classified_user
    ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE classified_user
    ADD COLUMN IF NOT EXISTS is_lightweight BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE classified_user
    ADD COLUMN IF NOT EXISTS first_name VARCHAR(64);

ALTER TABLE classified_user
    ADD COLUMN IF NOT EXISTS display_preference VARCHAR(16) NOT NULL DEFAULT 'first_name';

ALTER TABLE classified_user
    ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP WITHOUT TIME ZONE;

ALTER TABLE classified_user
    ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE classified_user
    ALTER COLUMN password_hash DROP NOT NULL;

-- Magic-link login requires one row per email (case-insensitive). Legacy data
-- may have duplicates — keep the primary account (username rorhoff if present,
-- else oldest id) and suffix others so the unique index can be created.
WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY LOWER(TRIM(email))
            ORDER BY
                CASE WHEN LOWER(username) = 'rorhoff' THEN 0 ELSE 1 END,
                id ASC
        ) AS rn
    FROM classified_user
    WHERE TRIM(email) <> ''
)
UPDATE classified_user u
SET email = u.email || '.legacy.' || u.id::text
FROM ranked r
WHERE u.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_classified_user_email_lower
    ON classified_user (LOWER(email));

-- conversations
CREATE TABLE IF NOT EXISTS classified_conversation (
    id VARCHAR(36) PRIMARY KEY,
    listing_id VARCHAR(36) NOT NULL REFERENCES classified_ad(id) ON DELETE CASCADE,
    buyer_user_id INTEGER NOT NULL REFERENCES classified_user(id) ON DELETE CASCADE,
    seller_user_id INTEGER NOT NULL REFERENCES classified_user(id) ON DELETE CASCADE,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
    last_message_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
    CONSTRAINT uq_conversation_listing_buyer UNIQUE (listing_id, buyer_user_id)
);

CREATE INDEX IF NOT EXISTS ix_conversation_buyer_last
    ON classified_conversation (buyer_user_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS ix_conversation_seller_last
    ON classified_conversation (seller_user_id, last_message_at DESC);

-- messages
CREATE TABLE IF NOT EXISTS classified_message (
    id VARCHAR(36) PRIMARY KEY,
    conversation_id VARCHAR(36) NOT NULL REFERENCES classified_conversation(id) ON DELETE CASCADE,
    sender_user_id INTEGER NOT NULL REFERENCES classified_user(id) ON DELETE CASCADE,
    message_type VARCHAR(16) NOT NULL,
    preset_key VARCHAR(64),
    body TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS ix_message_conversation_created
    ON classified_message (conversation_id, created_at);

-- magic link tokens (hashed)
CREATE TABLE IF NOT EXISTS classified_magic_link_token (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    redirect_path VARCHAR(500) NOT NULL DEFAULT '/',
    expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    used_at TIMESTAMP WITHOUT TIME ZONE,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
    ip_address VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS ix_magic_link_email_created
    ON classified_magic_link_token (LOWER(email), created_at DESC);

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

ok "v1.33 migration complete."
