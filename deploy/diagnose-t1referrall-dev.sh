#!/usr/bin/env bash
# diagnose-t1referrall-dev.sh — check Referr-All payments + avatar storage on dev EC2.
#
# Usage: bash ~/Website/deploy/diagnose-t1referrall-dev.sh

set -euo pipefail

ENV_FILE="${ENV_FILE:-/home/ubuntu/Website/.env.dev}"
[[ -f "$ENV_FILE" ]] || ENV_FILE="/home/ubuntu/Website/.env"

echo "==> Env file: $ENV_FILE"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

check_var() {
  local name="$1"
  if [[ -n "${!name:-}" ]]; then
    echo "OK   $name is set"
  else
    echo "MISS $name"
  fi
}

echo
echo "Stripe (required for Featured / Premium checkout):"
check_var STRIPE_SECRET_KEY
check_var STRIPE_WEBHOOK_SECRET
check_var REFERR_ALL_STRIPE_WEBHOOK_SECRET
check_var STRIPE_PUBLIC_BASE_URL

echo
echo "Database premium tables:"
if [[ -n "${DATABASE_URL:-}" ]]; then
  python3 - <<'PY'
import os, sys
if not os.getenv("DATABASE_URL"):
    sys.exit(0)
try:
    from sqlalchemy import create_engine, text
    engine = create_engine(os.environ["DATABASE_URL"])
    with engine.connect() as conn:
        for table in ("t1referrall_seeker_post", "t1referrall_premium_purchase"):
            row = conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = :t)"
            ), {"t": table}).scalar()
            print(f"{'OK  ' if row else 'MISS'} table {table}")
        cols = conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 't1referrall_seeker_post' "
            "AND column_name IN ('is_premium', 'premium_expires_at', 'premium_order')"
        )).scalars().all()
        for col in ("is_premium", "premium_expires_at", "premium_order"):
            print(f"{'OK  ' if col in cols else 'MISS'} column t1referrall_seeker_post.{col}")
        user_cols = conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 't1referrall_user' "
            "AND column_name IN ('totp_enabled', 'banner_url', 'settings')"
        )).scalars().all()
        for col in ("totp_enabled", "banner_url", "settings"):
            print(f"{'OK  ' if col in user_cols else 'MISS'} column t1referrall_user.{col}")
        sess_cols = conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 't1referrall_session' "
            "AND column_name IN ('user_agent', 'ip', 'last_seen_at')"
        )).scalars().all()
        for col in ("user_agent", "ip", "last_seen_at"):
            print(f"{'OK  ' if col in sess_cols else 'MISS'} column t1referrall_session.{col}")
except Exception as exc:
    print(f"WARN DB check failed: {exc}")
PY
else
  echo "WARN DATABASE_URL not loaded from env file"
fi
echo "  If any MISS above, run: bash ~/Website/deploy/fix-referr-all-premium.sh"
echo "  Login 500 usually means v10/v11 migrations were not run on dev yet."

echo
echo "S3/R2 (optional — avatars fall back to inline storage without this):"
check_var S3_BUCKET
check_var S3_ACCESS_KEY_ID
check_var S3_SECRET_ACCESS_KEY
check_var S3_PUBLIC_BASE_URL
check_var S3_ENDPOINT_URL

echo
echo "API status:"
curl -sS "http://127.0.0.1:8000/api/referr-all/status" | python3 -m json.tool 2>/dev/null || echo "(start webapi-dev first)"

echo
echo "If payments show missing, add TEST Stripe keys to $ENV_FILE and restart roryportfolio:"
echo "  STRIPE_PUBLIC_BASE_URL=https://rorhoff.com"
echo "  REFERR_ALL_STRIPE_WEBHOOK_SECRET=whsec_...  (Dashboard → /api/referr-all/premium/webhook)"
echo "  STRIPE_WEBHOOK_SECRET=whsec_...             (same or Classifieds secret)"
echo
echo "If Stripe webhooks return 500, run: bash ~/Website/deploy/migrate-t1referrall-v3.sh"
