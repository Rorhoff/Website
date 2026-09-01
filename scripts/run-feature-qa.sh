#!/usr/bin/env bash
# Run fast feature QA for MotherWyrm bots + LDBG recent features.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== MotherWyrm unit tests ==="
(cd motherwyrm/tv && npm test)

echo ""
echo "=== MotherWyrm WebSocket relay ==="
pytest mw-test/ -v

echo ""
echo "=== LDBG feature QA ==="
(cd ldbg && npm run test:feature-qa)

echo ""
echo "All feature QA passed."
