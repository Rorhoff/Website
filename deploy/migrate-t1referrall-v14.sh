#!/usr/bin/env bash
# migrate-t1referrall-v14.sh — message read receipts / unread badges.
#
# Adds:
#   - t1referrall_message.read_at (NULL = unread)
#   - partial index for fast unread-count queries
#   - backfills every existing message as read so long-time users don't log in
#     to a wall of stale unread badges
#
# Run once on EC2 after deploying:
#   bash ~/Website/deploy/migrate-t1referrall-v14.sh          (dev / rorhoff.com)
#   bash ~/website-referrall/deploy/migrate-t1referrall-v14.sh (prod / referr-all.com)

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

echo "==> Referr-All v14 migration (message read receipts / unread badges)…"

"$PYTHON" "$ROOT/deploy/referrall-migrate-db.py" \
  "ALTER TABLE t1referrall_message ADD COLUMN IF NOT EXISTS read_at timestamp NULL" \
  "UPDATE t1referrall_message SET read_at = created_at WHERE read_at IS NULL" \
  "CREATE INDEX IF NOT EXISTS ix_t1ref_message_unread ON t1referrall_message (conversation_id, sender_id) WHERE read_at IS NULL"

echo "OK  Referr-All v14 migration complete."
