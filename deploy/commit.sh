#!/usr/bin/env bash
# commit.sh — push test (rorhoff.com / dev). Pulls origin/main into
# /home/ubuntu/Website, rebuilds T1Referrall into static/t1-referrall, and
# restarts the dev service. Replaces the old
#
#   cd ~/Website && git pull && sudo systemctl restart roryportfolio
#
# with the same intent plus a few guard rails so a half-broken pull or a
# dirty working tree doesn't silently take dev down.
#
# Install (one-time, on EC2):
#   cd /home/ubuntu/Website && git pull
#   cp deploy/commit.sh ~/commit.sh
#   chmod +x ~/commit.sh
#
# Usage:
#   ~/commit.sh

set -euo pipefail

# ---------------------------------------------------------------------------
# Edit these if you ever rename the dev directory or service. The defaults
# match the existing setup (the systemd unit is `roryportfolio`; the FastAPI
# app listens on :8000 behind nginx for rorhoff.com).
# ---------------------------------------------------------------------------
DEV_DIR="/home/ubuntu/Website"
DEV_SERVICE="roryportfolio"
DEV_HEALTH_URL="http://127.0.0.1:8000/which-app"
DEV_VENV_PIP="$DEV_DIR/.venv/bin/pip"

if [[ -t 1 ]]; then
  GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; BLUE=$'\e[34m'; RESET=$'\e[0m'
else
  GREEN=""; YELLOW=""; RED=""; BLUE=""; RESET=""
fi
log()  { echo "${BLUE}==>${RESET} $*"; }
ok()   { echo "${GREEN}OK${RESET}  $*"; }
warn() { echo "${YELLOW}WARN${RESET} $*"; }
die()  { echo "${RED}ERR${RESET} $*" >&2; exit 1; }

# Keep ~/commit.sh in sync with deploy/commit.sh so a one-time cp doesn't leave stale paths
# (e.g. building into static/t1-referral instead of static/t1-referrall).
_REPO_COMMIT="$DEV_DIR/deploy/commit.sh"
if [[ -f "$_REPO_COMMIT" ]]; then
  _this="${BASH_SOURCE[0]}"
  if [[ "$_this" != "$_REPO_COMMIT" ]] && ! cmp -s "$_this" "$_REPO_COMMIT" 2>/dev/null; then
    echo "${BLUE}==>${RESET} Updating ${HOME}/commit.sh from ${DEV_DIR}/deploy/commit.sh…"
    cp "$_REPO_COMMIT" "$HOME/commit.sh"
    chmod +x "$HOME/commit.sh"
    exec "$HOME/commit.sh" "$@"
  fi
fi

# Build T1Referrall (Vite/React) into static/t1-referrall after each pull.
# Uses ./T1Referrall when present; otherwise shallow-clones from GitHub.
# Non-fatal — a failed build keeps the last good static output (or git placeholder).
sync_t1_referrall() {
  local target="$DEV_DIR/static/t1-referrall"
  local vite_base="/t1-referrall/"
  local repo_url="${T1REFERRALL_REPO_URL:-https://github.com/Rorhoff/T1Referral.git}"
  local src_dir="" tmp="" use_tmp=0

  if ! command -v npm >/dev/null 2>&1; then
    warn "npm not found — skipping T1Referrall build."
    return 0
  fi

  if [[ -d "$DEV_DIR/T1Referrall/.git" && -f "$DEV_DIR/T1Referrall/package.json" ]]; then
    log "Syncing T1Referrall from local clone…"
    src_dir="$DEV_DIR/T1Referrall"
    git -C "$src_dir" pull --ff-only origin main 2>/dev/null \
      || warn "T1Referrall local pull skipped (using current checkout)."
  else
    export GIT_TERMINAL_PROMPT=0
    tmp="$(mktemp -d)"
    use_tmp=1
    log "Cloning T1Referrall from ${repo_url}…"
    if ! git clone --depth 1 "$repo_url" "$tmp/repo" 2>/dev/null; then
      warn "Could not clone T1Referrall — keeping existing ${target}."
      rm -rf "$tmp"
      return 0
    fi
    src_dir="$tmp/repo"
  fi

  if [[ ! -f "$src_dir/package.json" ]]; then
    warn "T1Referrall has no package.json — nothing to build."
    [[ "$use_tmp" -eq 1 ]] && rm -rf "$tmp"
    return 0
  fi

  log "Installing T1Referrall dependencies…"
  if ! (cd "$src_dir" && npm ci); then
    warn "T1Referrall npm ci failed."
    [[ "$use_tmp" -eq 1 ]] && rm -rf "$tmp"
    return 0
  fi

  log "Building T1Referrall for ${vite_base}…"
  if ! (cd "$src_dir" && npm run build -- --base="${vite_base}"); then
    warn "T1Referrall build failed."
    [[ "$use_tmp" -eq 1 ]] && rm -rf "$tmp"
    return 0
  fi

  if [[ ! -d "$src_dir/dist" ]]; then
    warn "T1Referrall build did not produce dist/."
    [[ "$use_tmp" -eq 1 ]] && rm -rf "$tmp"
    return 0
  fi

  mkdir -p "$target"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$src_dir/dist/" "$target/"
  else
    find "$target" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    cp -a "$src_dir/dist"/. "$target/"
  fi

  [[ "$use_tmp" -eq 1 ]] && rm -rf "$tmp"
  legacy="$DEV_DIR/static/t1-referral"
  if [[ -d "$legacy" && "$legacy" != "$target" ]]; then
    rm -rf "$legacy"
    log "Removed legacy ${legacy} (use /t1-referrall/ only)."
  fi
  ok "T1Referrall deployed to ${target}"
}

# ---------------------------------------------------------------------------
# Sanity checks: refuse to run if the checkout has uncommitted edits, since
# `git pull` would silently lose or conflict with them.
# Vite rebuilds overwrite static/t1-referrall — discard those before checking.
# ---------------------------------------------------------------------------
[[ -d "$DEV_DIR/.git" ]] || die "Not a git checkout: $DEV_DIR"
git -C "$DEV_DIR" checkout -- static/t1-referrall 2>/dev/null || true
rm -rf "$DEV_DIR/static/t1-referral"
if ! git -C "$DEV_DIR" diff --quiet || ! git -C "$DEV_DIR" diff --cached --quiet; then
  git -C "$DEV_DIR" status --short
  die "$DEV_DIR has uncommitted changes — stash or revert before pulling."
fi

before=$(git -C "$DEV_DIR" rev-parse --short HEAD)
log "DEV: ${DEV_DIR} currently at ${before}"

log "Fetching origin/main…"
# --force on the tag fetch so a tag that was moved on origin (e.g. you
# re-tagged prod-v1.X while testing) overwrites the local copy instead of
# aborting the whole script with "would clobber existing tag". We don't
# rely on those tags here — we just want them in sync so prod operations
# from this same checkout don't surprise anyone.
git -C "$DEV_DIR" fetch origin main --tags --prune --force
git -C "$DEV_DIR" checkout main >/dev/null
# Fast-forward only — refuse to merge unrelated history. Anything funky should
# be sorted out by hand, not by a deploy script.
git -C "$DEV_DIR" pull --ff-only origin main

sync_t1_referrall || warn "T1Referrall sync skipped — using placeholder from Website git"

after=$(git -C "$DEV_DIR" rev-parse --short HEAD)
if [[ "$before" == "$after" ]]; then
  log "No code change — restarting anyway in case env/config moved."
else
  log "Updated ${before} → ${after}"
fi

# Install deps when requirements.txt changed, or when key packages are missing
# (e.g. passlib for T1Referrall) so migrate scripts and the API don't fail.
needs_pip=0
if [[ "$before" != "$after" ]] && ! git -C "$DEV_DIR" diff --quiet "$before" "$after" -- requirements.txt; then
  needs_pip=1
elif [[ -x "$DEV_DIR/.venv/bin/python" ]] && ! "$DEV_DIR/.venv/bin/python" -c "import passlib" 2>/dev/null; then
  needs_pip=1
fi
if [[ "$needs_pip" -eq 1 ]]; then
  if [[ -x "$DEV_VENV_PIP" ]]; then
    log "Installing Python dependencies in dev venv…"
    "$DEV_VENV_PIP" install -r "$DEV_DIR/requirements.txt"
  else
    warn "Dev venv pip missing at ${DEV_VENV_PIP} — run:"
    warn "  python3 -m venv $DEV_DIR/.venv && $DEV_VENV_PIP install -r $DEV_DIR/requirements.txt"
  fi
fi

log "Restarting ${DEV_SERVICE}…"
sudo systemctl restart "$DEV_SERVICE"
sleep 2
if ! systemctl is-active --quiet "$DEV_SERVICE"; then
  echo "--- last 50 log lines for ${DEV_SERVICE} ---"
  sudo journalctl -u "$DEV_SERVICE" -n 50 --no-pager || true
  die "${DEV_SERVICE} failed to start."
fi
ok "${DEV_SERVICE} is running."

if command -v curl >/dev/null 2>&1; then
  if curl --fail --silent --max-time 5 "$DEV_HEALTH_URL" >/dev/null; then
    ok "Health probe ${DEV_HEALTH_URL} responded."
  else
    warn "Health probe ${DEV_HEALTH_URL} did not respond — check the service logs."
  fi
fi

ok "Test/dev push complete. https://rorhoff.com/which-app"
