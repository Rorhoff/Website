#!/usr/bin/env bash
# migrate-t1referrall-v13.sh — job post expiry, featured job posts, referral requests.
#
# Adds:
#   - t1referrall_post.expires_at (60-day TTL, backfilled from created_at)
#   - t1referrall_post.is_premium / premium_expires_at / premium_order (featured job posts)
#   - t1referrall_premium_purchase.job_post_id
#   - t1referrall_referral_request table (structured referral asks)
#
# Run once on EC2 after deploying:
#   bash ~/Website/deploy/migrate-t1referrall-v13.sh          (dev / rorhoff.com)
#   bash ~/website-referrall/deploy/migrate-t1referrall-v13.sh (prod / referr-all.com)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -z "${PYTHON:-}" ]] || [[ ! -x "${PYTHON}" ]]; then
  if [[ -x /home/ubuntu/app/venv/bin/python ]]; then
    PYTHON=/home/ubuntu/app/venv/bin/python
  elif [[ -x "$ROOT/.venv/bin/python" ]]; then
    PYTHON="$ROOT/.venv/bin/python"
  elif [[ -x /home/ubuntu/Website/.venv/bin/python ]]; then
    PYTHON=/home/ubuntu/Website/.venv/bin/python
  else
    PYTHON=python3
  fi
fi

# shellcheck disable=SC1091
source "$ROOT/deploy/referrall-migrate-env.sh"
referrall_load_migration_env

echo "==> Referr-All v13 migration (job expiry + featured jobs + referral requests)…"

"$PYTHON" "$ROOT/deploy/referrall-migrate-db.py" \
  "ALTER TABLE t1referrall_post ADD COLUMN IF NOT EXISTS expires_at timestamp NULL" \
  "ALTER TABLE t1referrall_post ADD COLUMN IF NOT EXISTS is_premium boolean NOT NULL DEFAULT false" \
  "ALTER TABLE t1referrall_post ADD COLUMN IF NOT EXISTS premium_expires_at timestamp NULL" \
  "ALTER TABLE t1referrall_post ADD COLUMN IF NOT EXISTS premium_order integer NOT NULL DEFAULT 0" \
  "ALTER TABLE t1referrall_premium_purchase ADD COLUMN IF NOT EXISTS job_post_id varchar(36) NULL REFERENCES t1referrall_post(id) ON DELETE SET NULL" \
  "UPDATE t1referrall_post SET expires_at = created_at + interval '60 days' WHERE expires_at IS NULL" \
  "CREATE TABLE IF NOT EXISTS t1referrall_referral_request (
     id varchar(36) PRIMARY KEY,
     post_id varchar(36) NOT NULL REFERENCES t1referrall_post(id) ON DELETE CASCADE,
     requester_id varchar(36) NOT NULL REFERENCES t1referrall_user(id) ON DELETE CASCADE,
     referrer_id varchar(36) NOT NULL REFERENCES t1referrall_user(id) ON DELETE CASCADE,
     message text NOT NULL DEFAULT '',
     status varchar(16) NOT NULL DEFAULT 'pending',
     created_at timestamp NOT NULL DEFAULT now(),
     updated_at timestamp NOT NULL DEFAULT now(),
     CONSTRAINT uq_t1ref_referral_request UNIQUE (post_id, requester_id)
   )" \
  "CREATE INDEX IF NOT EXISTS ix_t1referrall_referral_request_post_id ON t1referrall_referral_request (post_id)" \
  "CREATE INDEX IF NOT EXISTS ix_t1referrall_referral_request_requester_id ON t1referrall_referral_request (requester_id)" \
  "CREATE INDEX IF NOT EXISTS ix_t1referrall_referral_request_referrer_id ON t1referrall_referral_request (referrer_id)" \
  "CREATE INDEX IF NOT EXISTS ix_t1referrall_referral_request_status ON t1referrall_referral_request (status)"

echo "OK  Referr-All v13 migration complete."
