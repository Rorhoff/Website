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
# Usage (from anywhere on EC2):
#   ~/commit.sh
#   — or if ~/commit.sh is stale/broken after a bad pull:
#   bash ~/Website/deploy/commit.sh
#   bash ~/Website/deploy/run-commit.sh
#
# One script does the full dev deploy — no need to run rebuild-ldbg.sh or git pull
# separately. Skips unchanged builds/migrations; set COMMIT_FORCE=1 to rebuild everything.

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

# Vite output under static/ is rebuilt every deploy. Drop untracked files there so
# `git pull` is not blocked by leftover manifest.json, sw.js, nav-toggle.js, etc.
_clean_spa_static() {
  local repo="$1"
  git -C "$repo" checkout -- static/referr-all 2>/dev/null || true
  git -C "$repo" clean -fd -- static/referr-all 2>/dev/null || true
  rm -rf "$repo/static/t1-referrall" "$repo/static/t1-referral"
}

# Discard Vite rebuild output before any pull/dirty checks (never block deploy on this path).
if [[ -d "$DEV_DIR/.git" ]]; then
  _clean_spa_static "$DEV_DIR"
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

# Keep ~/commit.sh in sync with deploy/commit.sh (before pull — local edits on disk).
_maybe_refresh_commit_script() {
  local repo_script="$DEV_DIR/deploy/commit.sh"
  [[ -f "$repo_script" ]] || return 0
  local self="${BASH_SOURCE[0]}"
  [[ "$self" == "$repo_script" ]] && return 0
  if ! cmp -s "$self" "$repo_script" 2>/dev/null; then
    log "Updating ${HOME}/commit.sh from ${repo_script}…"
    cp "$repo_script" "$HOME/commit.sh"
    chmod +x "$HOME/commit.sh"
    exec "$HOME/commit.sh" "$@"
  fi
}

# COMMIT_FORCE=1  — rebuild Referr-All + LDBG even when git HEAD unchanged
# COMMIT_FORCE=1  — also rebuild when paths unchanged (e.g. fix a bad .next)
COMMIT_FORCE="${COMMIT_FORCE:-0}"
DEPLOY_BEFORE=""
DEPLOY_AFTER=""
LDBG_REBUILT=0

# Files changed between DEPLOY_BEFORE and DEPLOY_AFTER (empty if same commit).
_changed_files() {
  if [[ -z "$DEPLOY_BEFORE" || -z "$DEPLOY_AFTER" || "$DEPLOY_BEFORE" == "$DEPLOY_AFTER" ]]; then
    return 0
  fi
  git -C "$DEV_DIR" diff --name-only "$DEPLOY_BEFORE" "$DEPLOY_AFTER"
}

# True when COMMIT_FORCE=1 or any changed path matches the extended-regex.
_path_changed() {
  local pattern="$1"
  if [[ "$COMMIT_FORCE" == "1" ]]; then
    return 0
  fi
  [[ "$DEPLOY_BEFORE" != "$DEPLOY_AFTER" ]] || return 1
  _changed_files | grep -qE "$pattern"
}

_ldbg_python_ok() {
  local py="/home/ubuntu/app/venv/bin/python"
  if [[ -x "$py" ]] && "$py" -c "import cv2, numpy, rasterio" 2>/dev/null; then
    return 0
  fi
  py="$DEV_DIR/.venv/bin/python"
  [[ -x "$py" ]] && "$py" -c "import cv2, numpy, rasterio" 2>/dev/null
}

_ldbg_lock_unchanged() {
  [[ "$DEPLOY_BEFORE" == "$DEPLOY_AFTER" ]] && return 0
  git -C "$DEV_DIR" diff --quiet "$DEPLOY_BEFORE" "$DEPLOY_AFTER" -- ldbg/package-lock.json 2>/dev/null
}

_referrall_lock_unchanged() {
  local lock_dir="$1"
  [[ "$DEPLOY_BEFORE" == "$DEPLOY_AFTER" ]] && return 0
  git -C "$DEV_DIR" diff --quiet "$DEPLOY_BEFORE" "$DEPLOY_AFTER" -- "$lock_dir/package-lock.json" 2>/dev/null
}

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
  if _referrall_lock_unchanged "$src_dir" && [[ -d "$src_dir/node_modules" ]]; then
    ok "Referr-All package-lock unchanged — skipping npm ci."
  elif ! (cd "$src_dir" && npm ci); then
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

# Build LDBG (Next.js) in ldbg/ and restart the ldbg systemd unit.
sync_ldbg() {
  local src_dir="$DEV_DIR/ldbg"

  if ! command -v npm >/dev/null 2>&1; then
    warn "npm not found — skipping LDBG build."
    return 0
  fi

  if [[ ! -f "$src_dir/package.json" ]]; then
    warn "ldbg/package.json not found — skipping LDBG build."
    return 0
  fi

  log "Building LDBG from ${src_dir}…"

  if [[ "$COMMIT_FORCE" == "1" ]]; then
    log "COMMIT_FORCE=1 — removing stale .next and .next.prev before clean rebuild…"
    rm -rf "$src_dir/.next" "$src_dir/.next.prev"
  fi

  if _ldbg_lock_unchanged && [[ -d "$src_dir/node_modules" ]]; then
    ok "ldbg package-lock unchanged — skipping npm ci."
  elif ! (cd "$src_dir" && npm ci); then
    die "LDBG npm ci failed — fix package-lock or network and re-run commit.sh."
  fi

  log "Building LDBG with basePath /ldbg…"
  LDBG_REPO_ROOT="$DEV_DIR" bash "$DEV_DIR/deploy/ldbg-build.sh" || die "LDBG build failed — see errors above."

  ok "LDBG built in ${src_dir} ($(git -C "$DEV_DIR" rev-parse --short HEAD)) basePath=/ldbg"
  LDBG_REBUILT=1

  if grep -q puppeteerDepsOk "$src_dir/src/app/api/diag/route.ts" 2>/dev/null; then
    if ! grep -rq puppeteerDepsOk "$src_dir/.next/server" 2>/dev/null; then
      die "LDBG .next build missing puppeteerDepsOk — rebuild did not pick up api/diag changes."
    fi
  fi

  if [[ -f "$DEV_DIR/deploy/ensure-ldbg-puppeteer-deps.sh" ]]; then
    local diag_ok=0
    diag_ok="$(curl -sS --max-time 4 "http://127.0.0.1:3002/ldbg/api/diag" 2>/dev/null | grep -c '"puppeteerDepsOk":true' || true)"
    if [[ "$diag_ok" -ge 1 ]]; then
      ok "Puppeteer Chrome deps already OK — skipping apt install."
    else
      log "Ensuring Puppeteer / Chrome system libraries for board export…"
      bash "$DEV_DIR/deploy/ensure-ldbg-puppeteer-deps.sh" || die "Puppeteer Chrome deps missing — PDF export will fail."
    fi
  fi

  if [[ -f "$DEV_DIR/deploy/ensure-ldbg-python-deps.sh" ]]; then
    if _path_changed '^ldbg/scripts/requirements-geo\.txt$' || ! _ldbg_python_ok; then
      log "Ensuring LDBG Python geo/CV deps in project venv…"
      bash "$DEV_DIR/deploy/ensure-ldbg-python-deps.sh" || die "LDBG Python deps missing."
    else
      ok "LDBG Python deps unchanged — skipping pip install."
    fi
  fi
}

install_ldbg_service() {
  local unit="/etc/systemd/system/ldbg.service"
  if [[ ! -f "$DEV_DIR/deploy/ldbg.service" ]]; then
    return 0
  fi
  if ! cmp -s "$DEV_DIR/deploy/ldbg.service" "$unit" 2>/dev/null; then
    log "Installing ldbg.service…"
    sudo cp "$DEV_DIR/deploy/ldbg.service" "$unit"
    sudo systemctl daemon-reload
    sudo systemctl enable ldbg 2>/dev/null || true
  fi
}

# LDBG orthophoto uploads need client_max_body_size 200M on /ldbg (not the global 12M).
install_nginx_ldbg_upload() {
  local src="$DEV_DIR/deploy/nginx-rorhoff.conf"
  local dst="/etc/nginx/sites-available/rorhoff.conf"
  if [[ ! -f "$src" ]]; then
    return 0
  fi
  if [[ ! -f "$dst" ]]; then
    warn "nginx vhost not found at $dst — install deploy/nginx-rorhoff.conf manually for large /ldbg uploads."
    return 0
  fi
  if ! cmp -s "$src" "$dst" 2>/dev/null; then
    log "Updating nginx rorhoff.conf (/ldbg upload limit 200M)…"
    sudo cp "$src" "$dst"
    if sudo nginx -t 2>/dev/null; then
      sudo systemctl reload nginx
      ok "nginx reloaded — /ldbg accepts large orthophoto uploads"
    else
      warn "nginx -t failed after config copy — restore $dst and reload manually"
    fi
  fi
}

# Restart ldbg; full static verify + rollback only after a fresh build.
restart_ldbg_service() {
  log "Restarting ldbg…"
  sudo systemctl restart ldbg || warn "ldbg failed to restart — check journalctl -u ldbg"
  sleep 2
  if [[ "$LDBG_REBUILT" == "1" ]]; then
    restart_ldbg_with_verify
  elif [[ -f "$DEV_DIR/deploy/verify-ldbg-static.sh" ]]; then
    if bash "$DEV_DIR/deploy/verify-ldbg-static.sh"; then
      ok "ldbg static assets OK (no rebuild)."
    else
      die "LDBG static assets broken — run: bash ${DEV_DIR}/deploy/nuke-ldbg-build.sh"
    fi
  else
    ok "ldbg restarted (no rebuild — skipped static asset verify)."
  fi
}

# Restart ldbg and verify static assets. Do not roll back to .next.prev — it is often
# the same corrupt tree that caused the failure (HTML references missing CSS/webpack).
restart_ldbg_with_verify() {
  if [[ ! -f "$DEV_DIR/deploy/verify-ldbg-static.sh" ]]; then
    return 0
  fi

  local attempt
  for attempt in 1 2 3 4 5 6; do
    sleep 2
    if bash "$DEV_DIR/deploy/verify-ldbg-static.sh"; then
      ok "LDBG static assets verified (attempt ${attempt})."
      rm -rf "$DEV_DIR/ldbg/.next.prev"
      return 0
    fi
    warn "LDBG static verify attempt ${attempt}/6 failed — waiting for next start…"
  done

  warn "LDBG static verify failed after rebuild."
  if ! systemctl is-active --quiet ldbg; then
    sudo journalctl -u ldbg -n 40 --no-pager || true
    die "ldbg is not running after rebuild — see journal above."
  fi
  die "LDBG static assets broken after rebuild — run: bash ${DEV_DIR}/deploy/nuke-ldbg-build.sh"
}

# ---------------------------------------------------------------------------
# Sanity checks: refuse to run if the checkout has uncommitted edits, since
# `git pull` would silently lose or conflict with them.
# static/referr-all is rebuilt every deploy — never treat it as a blocker.
# ---------------------------------------------------------------------------
[[ -d "$DEV_DIR/.git" ]] || die "Not a git checkout: $DEV_DIR"
_maybe_refresh_commit_script
_clean_spa_static "$DEV_DIR"
_diff_paths=(':!static/referr-all')
if ! git -C "$DEV_DIR" diff --quiet HEAD -- . "$_diff_paths" \
  || ! git -C "$DEV_DIR" diff --cached --quiet HEAD -- . "$_diff_paths"; then
  git -C "$DEV_DIR" status --short
  die "$DEV_DIR has uncommitted changes — stash or revert before pulling."
fi

before=$(git -C "$DEV_DIR" rev-parse --short HEAD)
DEPLOY_BEFORE="$before"
log "DEV: ${DEV_DIR} currently at ${before}"

log "Fetching origin/main…"
git -C "$DEV_DIR" fetch origin main --tags --prune --force
git -C "$DEV_DIR" checkout main >/dev/null
git -C "$DEV_DIR" pull --ff-only origin main

_maybe_refresh_commit_script

after=$(git -C "$DEV_DIR" rev-parse --short HEAD)
DEPLOY_AFTER="$after"
log "Deploying commit ${after} from origin/main"
if [[ "$before" == "$after" ]]; then
  log "No new commits on main."
else
  log "Updated ${before} → ${after}"
fi

# --- Conditional builds (biggest time savers) ---
if _path_changed '^(referr-all-app/|deploy/referrall-vite-env\.sh)'; then
  sync_referr_all || warn "Referr-All sync skipped — using placeholder from Website git"
else
  log "No Referr-All app changes — skipping Vite build."
fi

if _path_changed '^(ldbg/|deploy/ldbg|deploy/ensure-ldbg|deploy/verify-ldbg)' \
  || [[ ! -d "$DEV_DIR/ldbg/.next" ]]; then
  sync_ldbg || die "LDBG sync failed — fix the build and re-run commit.sh."
else
  log "No ldbg/ changes — skipping LDBG build (COMMIT_FORCE=1 to rebuild anyway)."
fi

install_ldbg_service
install_nginx_ldbg_upload

if _path_changed '^(ldbg/|deploy/ensure-ldbg-anthropic)' \
  || [[ ! -f "$DEV_DIR/ldbg/.env.local" ]]; then
  bash "$DEV_DIR/deploy/ensure-ldbg-anthropic-env.sh" || warn "LDBG Anthropic env sync skipped"
else
  log "Skipping LDBG Anthropic env sync (unchanged)."
fi

if [[ -f "$DEV_DIR/deploy/ensure-ldbg-python-env.sh" ]]; then
  bash "$DEV_DIR/deploy/ensure-ldbg-python-env.sh" || warn "LDBG Python env sync skipped"
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
else
  log "requirements.txt unchanged — skipping pip install."
fi

if _path_changed '^deploy/migrate-t1referrall' \
  || _path_changed '^(models/|database\.py|db\.py|schemas/)'; then
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
  bash "$DEV_DIR/deploy/bootstrap-referrall-admin.sh" || warn "Admin bootstrap skipped"
else
  log "No migration script changes — skipping Referr-All DB migrations."
fi

if _path_changed '^deploy/(ensure-stripe|set-stripe)'; then
  log "Ensuring Stripe public base URL on dev…"
  bash "$DEV_DIR/deploy/ensure-stripe-public-base-dev.sh" || warn "Could not update Stripe env"
else
  log "Skipping Stripe env check (unchanged)."
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

if systemctl list-unit-files 2>/dev/null | grep -q '^ldbg.service'; then
  restart_ldbg_service
  if systemctl is-active --quiet ldbg; then
    ok "ldbg is running."
    if [[ "$LDBG_REBUILT" == "1" ]]; then
      if [[ -f /home/ubuntu/Website/.env ]] && ! grep -Eq '^(export[[:space:]]+)?ANTHROPIC_API_KEY=' /home/ubuntu/Website/.env; then
        if [[ -f /home/ubuntu/Website/.env.dev ]] && grep -Eq '^(export[[:space:]]+)?ANTHROPIC_API_KEY=' /home/ubuntu/Website/.env.dev; then
          : # key in .env.dev only
        else
          warn "ANTHROPIC_API_KEY not in .env or .env.dev — LDBG interpret will fail."
        fi
      fi
      ldbg_diag=""
      ldbg_diag="$(curl -sS --max-time 10 "http://127.0.0.1:3002/ldbg/api/diag" 2>/dev/null || true)"
      if echo "$ldbg_diag" | grep -q '"anthropicConfigured"'; then
        ok "LDBG diag: $ldbg_diag"
        if ! echo "$ldbg_diag" | grep -q '"puppeteerDepsOk"'; then
          warn "LDBG diag missing puppeteerDepsOk — re-run ~/commit.sh after pulling latest main."
        elif echo "$ldbg_diag" | grep -q '"puppeteerDepsOk":false'; then
          warn "Puppeteer Chrome libraries missing — PDF/PNG export will fail."
        fi
      else
        warn "LDBG /api/diag did not return JSON — re-run ~/commit.sh after git push."
      fi
    fi
  else
    warn "ldbg is not active — run: journalctl -u ldbg -n 50"
    sudo systemctl start ldbg 2>/dev/null || true
    sleep 2
    if systemctl is-active --quiet ldbg; then
      ok "ldbg started on retry."
    fi
  fi
fi

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
