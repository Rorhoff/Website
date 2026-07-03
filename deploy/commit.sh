#!/usr/bin/env bash
# commit.sh — push test (rorhoff.com / dev). Pulls origin/main into
# /home/ubuntu/Website, rebuilds Referr-All into static/referr-all, and
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

# Discard Vite rebuild output before any pull/dirty checks (never block deploy on this path).
if [[ -d "$DEV_DIR/.git" ]]; then
  git -C "$DEV_DIR" checkout -- static/referr-all 2>/dev/null || true
  git -C "$DEV_DIR" checkout -- static/in-the-wild 2>/dev/null || true
  rm -rf "$DEV_DIR/static/t1-referrall" "$DEV_DIR/static/t1-referral"
fi

if [[ -t 1 ]]; then
  GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; BLUE=$'\e[34m'; RESET=$'\e[0m'
else
  GREEN=""; YELLOW=""; RED=""; BLUE=""; RESET=""
fi
log()  { echo "${BLUE}==>${RESET} $*"; }
ok()   { echo "${GREEN}OK${RESET}  $*"; }
warn() { echo "${YELLOW}WARN${RESET} $*"; }
die()  { echo "${RED}ERR${RESET} $*" >&2; exit 1; }

# Keep ~/commit.sh in sync with deploy/commit.sh so a one-time cp doesn't leave stale paths.
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

# Build Referr-All (Vite/React) into static/referr-all after each pull.
# Prefers referr-all-app/ in this repo (Referr-All branding), then ./T1Referrall on EC2,
# otherwise shallow-clones from GitHub (legacy T1Referral repo).
# Non-fatal — a failed build keeps the last good static output (or git placeholder).
sync_referr_all() {
  local target="$DEV_DIR/static/referr-all"
  local vite_base="/referr-all/"
  local repo_url="${REFERR_ALL_REPO_URL:-${T1REFERRALL_REPO_URL:-https://github.com/Rorhoff/T1Referral.git}}"
  local src_dir="" tmp="" use_tmp=0

  if ! command -v npm >/dev/null 2>&1; then
    warn "npm not found — skipping Referr-All build."
    return 0
  fi

  if [[ -f "$DEV_DIR/referr-all-app/package.json" ]]; then
    log "Building Referr-All from ${DEV_DIR}/referr-all-app…"
    src_dir="$DEV_DIR/referr-all-app"
  elif [[ -d "$DEV_DIR/T1Referrall/.git" && -f "$DEV_DIR/T1Referrall/package.json" ]]; then
    log "Syncing Referr-All from local T1Referrall clone…"
    src_dir="$DEV_DIR/T1Referrall"
    git -C "$src_dir" pull --ff-only origin main 2>/dev/null \
      || warn "T1Referrall local pull skipped (using current checkout)."
  else
    export GIT_TERMINAL_PROMPT=0
    tmp="$(mktemp -d)"
    use_tmp=1
    log "Cloning Referr-All from ${repo_url}…"
    if ! git clone --depth 1 "$repo_url" "$tmp/repo" 2>/dev/null; then
      warn "Could not clone Referr-All — keeping existing ${target}."
      rm -rf "$tmp"
      return 0
    fi
    src_dir="$tmp/repo"
  fi

  if [[ ! -f "$src_dir/package.json" ]]; then
    warn "Referr-All has no package.json — nothing to build."
    [[ "$use_tmp" -eq 1 ]] && rm -rf "$tmp"
    return 0
  fi

  log "Installing Referr-All dependencies…"
  if ! (cd "$src_dir" && npm ci); then
    warn "Referr-All npm ci failed."
    [[ "$use_tmp" -eq 1 ]] && rm -rf "$tmp"
    return 0
  fi

  if [[ -f "$DEV_DIR/deploy/referrall-vite-env.sh" ]]; then
    # shellcheck disable=SC1091
    source "$DEV_DIR/deploy/referrall-vite-env.sh"
    referrall_export_vite_build_env "${DEV_DIR}/.env.dev"
    referrall_export_vite_build_env "${DEV_DIR}/.env"
  fi

  log "Building Referr-All for ${vite_base}…"
  if ! (cd "$src_dir" && npm run build -- --base="${vite_base}"); then
    warn "Referr-All build failed."
    [[ "$use_tmp" -eq 1 ]] && rm -rf "$tmp"
    return 0
  fi

  if [[ ! -d "$src_dir/dist" ]]; then
    warn "Referr-All build did not produce dist/."
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
  rm -rf "$DEV_DIR/static/t1-referrall" "$DEV_DIR/static/t1-referral"
  ok "Referr-All deployed to ${target}"
}

# Build In the Wild (Vite/React) into static/in-the-wild after each pull.
sync_in_the_wild() {
  local target="$DEV_DIR/static/in-the-wild"
  local vite_base="/in-the-wild/"
  local src_dir="$DEV_DIR/in-the-wild-app"

  if ! command -v npm >/dev/null 2>&1; then
    warn "npm not found — skipping In the Wild build."
    return 0
  fi

  if [[ ! -f "$src_dir/package.json" ]]; then
    warn "in-the-wild-app/package.json not found — skipping build."
    return 0
  fi

  log "Building In the Wild from ${src_dir}…"
  if ! (cd "$src_dir" && npm ci); then
    warn "In the Wild npm ci failed."
    return 0
  fi

  log "Building In the Wild for ${vite_base}…"
  if ! (cd "$src_dir" && npm run build -- --base="${vite_base}"); then
    warn "In the Wild build failed."
    return 0
  fi

  if [[ ! -d "$src_dir/dist" ]]; then
    warn "In the Wild build did not produce dist/."
    return 0
  fi

  mkdir -p "$target"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$src_dir/dist/" "$target/"
  else
    find "$target" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    cp -a "$src_dir/dist"/. "$target/"
  fi
  ok "In the Wild deployed to ${target}"
}

# ---------------------------------------------------------------------------
# Sanity checks: refuse to run if the checkout has uncommitted edits, since
# `git pull` would silently lose or conflict with them.
# static/referr-all is rebuilt every deploy — never treat it as a blocker.
# ---------------------------------------------------------------------------
[[ -d "$DEV_DIR/.git" ]] || die "Not a git checkout: $DEV_DIR"
git -C "$DEV_DIR" checkout -- static/referr-all 2>/dev/null || true
git -C "$DEV_DIR" checkout -- static/in-the-wild 2>/dev/null || true
rm -rf "$DEV_DIR/static/t1-referrall" "$DEV_DIR/static/t1-referral"
_diff_paths=(':!static/referr-all' ':!static/in-the-wild')
if ! git -C "$DEV_DIR" diff --quiet HEAD -- . "$_diff_paths" \
  || ! git -C "$DEV_DIR" diff --cached --quiet HEAD -- . "$_diff_paths"; then
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

sync_referr_all || warn "Referr-All sync skipped — using placeholder from Website git"
sync_in_the_wild || warn "In the Wild sync skipped — using placeholder from Website git"

after=$(git -C "$DEV_DIR" rev-parse --short HEAD)
if [[ "$before" == "$after" ]]; then
  log "No code change — restarting anyway in case env/config moved."
else
  log "Updated ${before} → ${after}"
fi

# Install deps when requirements.txt changed, or when key packages are missing
# (e.g. passlib for Referr-All) so migrate scripts and the API don't fail.
# shellcheck disable=SC1091
source "$DEV_DIR/deploy/ensure-venv.sh"
ensure_project_venv "$DEV_DIR"
DEV_VENV_PIP="$PIP"

needs_pip=0
if [[ "$before" != "$after" ]] && ! git -C "$DEV_DIR" diff --quiet "$before" "$after" -- requirements.txt; then
  needs_pip=1
elif ! "$PYTHON" -c "import passlib" 2>/dev/null; then
  needs_pip=1
elif ! "$PYTHON" -c "import pytest" 2>/dev/null; then
  needs_pip=1
fi
if [[ "$needs_pip" -eq 1 ]]; then
  log "Installing Python dependencies in dev venv…"
  "$DEV_VENV_PIP" install -r "$DEV_DIR/requirements.txt"
fi

log "Referr-All DB migrations (auth schema v8–v12)…"
# shellcheck disable=SC1091
source "$DEV_DIR/deploy/referrall-migrate-env.sh"
_dev_env_candidates=()
[[ -f /home/ubuntu/Website/.env.dev ]] && _dev_env_candidates+=("/home/ubuntu/Website/.env.dev")
[[ -f /home/ubuntu/Website/.env ]] && _dev_env_candidates+=("/home/ubuntu/Website/.env")
[[ -f "$DEV_DIR/.env.dev" ]] && _dev_env_candidates+=("$DEV_DIR/.env.dev")
[[ -f "$DEV_DIR/.env" ]] && _dev_env_candidates+=("$DEV_DIR/.env")
export ENV_FILE="$(referrall_resolve_env_file "${_dev_env_candidates[@]}")" || die "No env file with DATABASE_URL found — cannot run Referr-All migrations."
export ROOT="$DEV_DIR"
referrall_resolve_python
log "Migration target env: ${ENV_FILE} (python: ${PYTHON})"
bash "$DEV_DIR/deploy/migrate-t1referrall-v8.sh" || die "v8 migration failed"
bash "$DEV_DIR/deploy/migrate-t1referrall-v9.sh" || die "v9 migration failed"
bash "$DEV_DIR/deploy/migrate-t1referrall-v10.sh" || die "v10 migration failed — login will 503 until fixed"
bash "$DEV_DIR/deploy/migrate-t1referrall-v11.sh" || die "v11 migration failed — login will 503 until fixed"
bash "$DEV_DIR/deploy/migrate-t1referrall-v12.sh" || die "v12 migration failed"
bash "$DEV_DIR/deploy/bootstrap-referrall-admin.sh" || warn "Admin bootstrap skipped (run deploy/bootstrap-referrall-admin.sh manually)"

log "In the Wild DB migration (v1)…"
bash "$DEV_DIR/deploy/migrate-t1inthewild-v1.sh" || die "In the Wild v1 migration failed"
bash "$DEV_DIR/deploy/migrate-t1inthewild-v2.sh" || die "In the Wild v2 migration failed"
bash "$DEV_DIR/deploy/migrate-t1inthewild-v3.sh" || die "In the Wild v3 migration failed"
bash "$DEV_DIR/deploy/migrate-t1inthewild-v4.sh" || die "In the Wild v4 migration failed"
bash "$DEV_DIR/deploy/bootstrap-itw-admin.sh" || warn "In the Wild admin bootstrap skipped"

log "Ensuring Stripe public base URL on dev…"
bash "$DEV_DIR/deploy/ensure-stripe-public-base-dev.sh" || warn "Could not update Stripe env — run deploy/set-stripe-dev.sh manually"

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
  pay_status="$(curl -sS --max-time 5 "http://127.0.0.1:8000/api/referr-all/status" 2>/dev/null || true)"
  if [[ -n "$pay_status" ]] && echo "$pay_status" | grep -q '"paymentsConfigured": false'; then
    warn "Stripe test keys not configured — Featured checkout disabled until you run:"
    warn "  bash ${DEV_DIR}/deploy/set-stripe-dev.sh"
  fi
fi

ok "Test/dev push complete. https://rorhoff.com/which-app"
