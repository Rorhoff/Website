#!/usr/bin/env bash
# commitreferrall.sh — push prod (referr-all.com). Fetches tags, checks out a
# `referrall-v*` tag in /home/ubuntu/website-referrall, rebuilds the Referr-All SPA
# (Vite, base "/") into static/referr-all, runs pip install if requirements changed,
# and restarts webapi-referrall. Use the same script with an older tag to roll back.
#
# This is the only thing on the box that can move referr-all.com. As long as you run
# commit.sh for everyday dev work and only run commitreferrall.sh when promoting,
# dev pulls cannot accidentally touch referr-all.com prod.
#
# Mirrors commitprod.sh (t1classifieds.com) but for the Referr-All service:
#   dir     /home/ubuntu/website-referrall
#   service webapi-referrall   (SERVICE_MODE=referrall, port 8002)
#   tag     referrall-v*
#
# Install (one-time, on EC2):
#   cd /home/ubuntu/Website && git pull
#   cp deploy/commitreferrall.sh ~/commitreferrall.sh
#   chmod +x ~/commitreferrall.sh
#
# Usage:
#   ~/commitreferrall.sh                 # show recent referrall-v* tags + usage
#   ~/commitreferrall.sh referrall-v1.0  # ship that tag to referr-all.com
#   ~/commitreferrall.sh referrall-v0.9  # roll back to a previous tag
#
# To create a new tag from your dev machine before running this:
#   git checkout main && git pull
#   git tag -a referrall-v1.1 -m "what changed"
#   git push origin referrall-v1.1

set -euo pipefail

# ---------------------------------------------------------------------------
# Edit these if you ever rename the prod directory or service. They must match
# the values in /etc/systemd/system/webapi-referrall.service.
# ---------------------------------------------------------------------------
REFERRALL_DIR="/home/ubuntu/website-referrall"
REFERRALL_SERVICE="webapi-referrall"
REFERRALL_HEALTH_URL="http://127.0.0.1:8002/which-app"
REFERRALL_VENV_PIP="$REFERRALL_DIR/.venv/bin/pip"
# The SPA is served from the domain root on referr-all.com, so build with base "/".
VITE_BASE="/"

if [[ -t 1 ]]; then
  GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; BLUE=$'\e[34m'; BOLD=$'\e[1m'; RESET=$'\e[0m'
else
  GREEN=""; YELLOW=""; RED=""; BLUE=""; BOLD=""; RESET=""
fi
log()  { echo "${BLUE}==>${RESET} $*"; }
ok()   { echo "${GREEN}OK${RESET}  $*"; }
warn() { echo "${YELLOW}WARN${RESET} $*"; }
die()  { echo "${RED}ERR${RESET} $*" >&2; exit 1; }

# Keep ~/commitreferrall.sh in sync with deploy/commitreferrall.sh so a one-time cp
# doesn't leave stale paths. Re-exec the updated copy.
_REPO_SCRIPT="$REFERRALL_DIR/deploy/commitreferrall.sh"
if [[ -f "$_REPO_SCRIPT" ]]; then
  _this="${BASH_SOURCE[0]}"
  if [[ "$_this" != "$_REPO_SCRIPT" ]] && ! cmp -s "$_this" "$_REPO_SCRIPT" 2>/dev/null; then
    echo "${BLUE}==>${RESET} Updating ${HOME}/commitreferrall.sh from ${_REPO_SCRIPT}…"
    cp "$_REPO_SCRIPT" "$HOME/commitreferrall.sh"
    chmod +x "$HOME/commitreferrall.sh"
    exec "$HOME/commitreferrall.sh" "$@"
  fi
fi

show_tags_and_usage() {
  echo "${BOLD}Recent referrall-v* tags${RESET} (newest first):"
  if [[ -d "$REFERRALL_DIR/.git" ]]; then
    git -C "$REFERRALL_DIR" fetch origin --tags --quiet --prune --prune-tags --force 2>/dev/null || true
    git -C "$REFERRALL_DIR" tag --list 'referrall-v*' --sort=-v:refname \
      --format='  %(refname:short)%09%(taggerdate:short)%09%(subject)' \
      | head -n 20 || true
  else
    echo "  (referr-all checkout not installed at ${REFERRALL_DIR} — see deploy/README.md)"
  fi
  echo
  echo "${BOLD}Usage${RESET}"
  echo "  $0 <referrall-vX.Y>   ship a tag to referr-all.com (or roll back to an older one)"
}

if [[ $# -eq 0 ]]; then
  show_tags_and_usage
  exit 0
fi

TAG="$1"
[[ "$TAG" == referrall-v* ]] || warn "Tag '$TAG' doesn't follow the referrall-v* convention — proceeding because you asked."

# ---------------------------------------------------------------------------
# Sanity checks. static/referr-all is rebuilt every deploy, so it is never a
# blocker for the dirty-tree check.
# ---------------------------------------------------------------------------
[[ -d "$REFERRALL_DIR/.git" ]] || die "Not a git checkout: $REFERRALL_DIR (see deploy/README.md)"
[[ -x "$REFERRALL_VENV_PIP" ]] || die "Referr-All venv pip missing: $REFERRALL_VENV_PIP — was the venv created?"

git -C "$REFERRALL_DIR" checkout -- static/referr-all 2>/dev/null || true
_diff_paths=':!static/referr-all'
if ! git -C "$REFERRALL_DIR" diff --quiet HEAD -- . "$_diff_paths" \
  || ! git -C "$REFERRALL_DIR" diff --cached --quiet HEAD -- . "$_diff_paths"; then
  git -C "$REFERRALL_DIR" status --short
  die "$REFERRALL_DIR has uncommitted changes — investigate before deploying."
fi

before=$(git -C "$REFERRALL_DIR" rev-parse --short HEAD)
current_ref=$(git -C "$REFERRALL_DIR" describe --tags --exact-match 2>/dev/null || git -C "$REFERRALL_DIR" branch --show-current 2>/dev/null || echo "detached")
log "REFERR-ALL: ${REFERRALL_DIR} currently at ${current_ref:-detached} (${before})"

log "Fetching tags from origin…"
# --force so a moved tag on origin overwrites the local copy instead of aborting with
# "would clobber existing tag". --prune-tags still removes tags deleted upstream.
git -C "$REFERRALL_DIR" fetch origin --tags --prune --prune-tags --force
if ! git -C "$REFERRALL_DIR" rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  die "Tag '${TAG}' not found even after fetch. Did you 'git push origin ${TAG}' from your dev machine?"
fi

log "Checking out ${TAG}…"
git -C "$REFERRALL_DIR" checkout --quiet "$TAG"
after=$(git -C "$REFERRALL_DIR" rev-parse --short HEAD)
if [[ "$before" == "$after" ]]; then
  log "Already at ${after} — rebuilding + restarting anyway."
else
  log "Updated ${before} → ${after}"
fi

# ---------------------------------------------------------------------------
# Build the Referr-All SPA (Vite/React) into static/referr-all with base "/".
# Non-fatal: a failed build keeps the previous static output so prod stays up.
# ---------------------------------------------------------------------------
build_referr_all() {
  local src_dir="$REFERRALL_DIR/referr-all-app"
  local target="$REFERRALL_DIR/static/referr-all"

  if ! command -v npm >/dev/null 2>&1; then
    warn "npm not found — skipping Referr-All build (serving previous static output)."
    return 0
  fi
  if [[ ! -f "$src_dir/package.json" ]]; then
    warn "No referr-all-app/package.json at ${src_dir} — skipping build."
    return 0
  fi

  log "Installing Referr-All dependencies (npm ci)…"
  if ! (cd "$src_dir" && npm ci); then
    warn "npm ci failed — keeping previous static output."
    return 0
  fi

  log "Building Referr-All for base ${VITE_BASE}…"
  if ! (cd "$src_dir" && npm run build -- --base="${VITE_BASE}"); then
    warn "Referr-All build failed — keeping previous static output."
    return 0
  fi
  if [[ ! -d "$src_dir/dist" ]]; then
    warn "Build did not produce dist/ — keeping previous static output."
    return 0
  fi

  mkdir -p "$target"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$src_dir/dist/" "$target/"
  else
    find "$target" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
    cp -a "$src_dir/dist"/. "$target/"
  fi
  ok "Referr-All SPA built into ${target} (base ${VITE_BASE})"
}

build_referr_all || warn "Referr-All build skipped — using previous static output."

# Only re-resolve dependencies when requirements.txt actually changed.
if [[ "$before" != "$after" ]] && ! git -C "$REFERRALL_DIR" diff --quiet "$before" "$after" -- requirements.txt; then
  log "requirements.txt changed — running pip install in referr-all venv…"
  "$REFERRALL_VENV_PIP" install -r "$REFERRALL_DIR/requirements.txt"
else
  log "requirements.txt unchanged — skipping pip install."
fi

log "Referr-All DB migrations (auth schema v10/v11)…"
export PYTHON="${REFERRALL_DIR}/.venv/bin/python"
export ROOT="$REFERRALL_DIR"
export ENV_FILE="${REFERRALL_DIR}/.env.referrall"
bash "$REFERRALL_DIR/deploy/migrate-t1referrall-v10.sh" || warn "v10 migration failed"
bash "$REFERRALL_DIR/deploy/migrate-t1referrall-v11.sh" || warn "v11 migration failed"

log "Restarting ${REFERRALL_SERVICE}…"
sudo systemctl restart "$REFERRALL_SERVICE"
sleep 2
if ! systemctl is-active --quiet "$REFERRALL_SERVICE"; then
  echo "--- last 50 log lines for ${REFERRALL_SERVICE} ---"
  sudo journalctl -u "$REFERRALL_SERVICE" -n 50 --no-pager || true
  die "${REFERRALL_SERVICE} failed to start."
fi
ok "${REFERRALL_SERVICE} is running."

if command -v curl >/dev/null 2>&1; then
  if curl --fail --silent --max-time 5 "$REFERRALL_HEALTH_URL" >/dev/null; then
    ok "Health probe ${REFERRALL_HEALTH_URL} responded."
  else
    warn "Health probe ${REFERRALL_HEALTH_URL} did not respond — check the service logs."
  fi
fi

ok "Referr-All prod push complete. Tag: ${TAG} → ${after}. https://referr-all.com/which-app"
