#!/usr/bin/env bash
# fix-referr-all-premium.sh — one-shot fix for Stripe webhook 500 / missing featured status.
#
# Run on EC2:
#   cd ~/Website && git pull && bash deploy/fix-referr-all-premium.sh
#
# Optional: pass a Stripe checkout session id to activate immediately:
#   bash deploy/fix-referr-all-premium.sh cs_test_a1MiHqAtsogEfYeZ9Ksd10ssx6GWEAOuTiqBAUohRCUAi4MTqUNwdhHYiR

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SESSION_ID="${1:-}"

resolve_python() {
  for candidate in \
    "$ROOT/.venv/bin/python" \
    /home/ubuntu/Website/.venv/bin/python \
    /home/ubuntu/app/venv/bin/python; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  echo "python3"
}

PYTHON="$(resolve_python)"
echo "==> Using Python: $PYTHON"

echo "==> Step 1: DB migration (premium tables/columns)…"
bash "$ROOT/deploy/migrate-t1referrall-v3.sh"

echo "==> Step 2: create_all fallback (any missing Referr-All tables)…"
ENV_FILE="${ENV_FILE:-/home/ubuntu/Website/.env}"
[[ -f "$ENV_FILE" ]] || ENV_FILE="/home/ubuntu/Website/.env.dev"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
"$PYTHON" - <<'PY'
import models  # noqa: F401
from database import Base, engine
if engine is None:
    raise SystemExit("DATABASE_URL not set")
Base.metadata.create_all(bind=engine)
print("OK  create_all finished")
PY

if [[ -n "$SESSION_ID" ]]; then
  echo "==> Step 3: Manual fulfill for session $SESSION_ID…"
  "$PYTHON" "$ROOT/tools/fulfill_referr_all_premium.py" "$SESSION_ID" || true
else
  echo "==> Step 3: Skipped manual fulfill (pass session id as arg to activate a specific payment)."
fi

SERVICE="roryportfolio"
if systemctl list-unit-files --type=service 2>/dev/null | grep -q '^webapi-dev\.service'; then
  if ! systemctl is-active --quiet roryportfolio 2>/dev/null; then
    SERVICE="webapi-dev"
  fi
fi

echo "==> Step 4: Restart $SERVICE…"
sudo systemctl restart "$SERVICE"
sleep 2
systemctl is-active --quiet "$SERVICE" || {
  echo "ERR  $SERVICE failed — check: sudo journalctl -u $SERVICE -n 50 --no-pager"
  exit 1
}

echo "==> Step 5: API status…"
curl -sS "http://127.0.0.1:8000/api/referr-all/status" | python3 -m json.tool 2>/dev/null || true

echo
echo "OK  Done."
echo "  • In Stripe, Resend the failed checkout.session.completed event."
echo "  • Or run: $PYTHON tools/fulfill_referr_all_premium.py cs_test_YOUR_SESSION_ID"
echo "  • Or in Referr-All Profile → Sync payments"
