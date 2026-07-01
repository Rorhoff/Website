#!/usr/bin/env bash
# ensure-venv.sh — create $ROOT/.venv and install requirements when missing.
#
# Usage:
#   source "$ROOT/deploy/ensure-venv.sh"
#   ensure_project_venv "$ROOT"

ensure_project_venv() {
  local root="${1:?project root required}"
  local venv="$root/.venv"
  local python="$venv/bin/python"
  local pip="$venv/bin/pip"

  if [[ -x /home/ubuntu/app/venv/bin/python && ! -x "$python" ]]; then
    python=/home/ubuntu/app/venv/bin/python
    pip=/home/ubuntu/app/venv/bin/pip
    PYTHON="$python"
    PIP="$pip"
    export PYTHON PIP
    return 0
  fi

  if [[ ! -x "$python" ]]; then
    echo "==> Creating Python venv at ${venv}…"
    python3 -m venv "$venv"
  fi

  if ! "$python" -c "import fastapi" 2>/dev/null \
    || ! "$python" -c "import pytest" 2>/dev/null; then
    echo "==> Installing Python dependencies from requirements.txt…"
    "$pip" install -r "$root/requirements.txt"
  fi

  PYTHON="$python"
  PIP="$pip"
  export PYTHON PIP
}
