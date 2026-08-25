#!/usr/bin/env bash
# ensure-ldbg-python-deps.sh — install ldbg/scripts/requirements-geo.txt into Website/.venv
# (Ubuntu 24+ blocks system pip; LDBG Python scripts use this venv via LDBG_PYTHON.)
set -euo pipefail

ROOT="${LDBG_REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
REQ="$ROOT/ldbg/scripts/requirements-geo.txt"

# shellcheck source=ensure-venv.sh
source "$ROOT/deploy/ensure-venv.sh"
ensure_project_venv "$ROOT"

if [[ ! -f "$REQ" ]]; then
  echo "ERR  Missing $REQ" >&2
  exit 1
fi

echo "==> Installing LDBG geo/CV Python deps into ${ROOT}/.venv …"
"$PIP" install -r "$REQ"

"$PYTHON" - <<'PY'
import cv2
import numpy
import rasterio
from skimage.morphology import skeletonize
print("OK   LDBG Python: cv2, numpy, rasterio, skimage")
PY
