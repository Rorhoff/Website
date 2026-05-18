#!/usr/bin/env bash
# commitprod.sh — push prod (t1classifieds.com). Fetches tags, checks out a
# `prod-v*` tag in /home/ubuntu/website-prod, runs pip install if requirements
# changed, and restarts webapi-prod. Use the same script with an older tag to
# roll back.
#
# This is the only thing on the box that can move prod. As long as you run
# commit.sh for everyday work and only run commitprod.sh when promoting, dev
# pulls cannot accidentally touch prod.
#
# Install (one-time, on EC2):
#   cd /home/ubuntu/Website && git pull
#   cp deploy/commitprod.sh ~/commitprod.sh
#   chmod +x ~/commitprod.sh
#
# Usage:
#   ~/commitprod.sh                  # show recent prod-v* tags + usage
#   ~/commitprod.sh prod-v1.1        # ship that tag to prod
#   ~/commitprod.sh prod-v1.0        # roll back to a previous tag
#
# To create a new tag from your dev machine before running this:
#   git checkout main && git pull
#   git tag -a prod-v1.1 -m "what changed"
#   git push origin prod-v1.1

set -euo pipefail

# ---------------------------------------------------------------------------
# Edit these if you ever rename the prod directory or service. They must match
# the values in /etc/systemd/system/webapi-prod.service.
# ---------------------------------------------------------------------------
PROD_DIR="/home/ubuntu/website-prod"
PROD_SERVICE="webapi-prod"
PROD_HEALTH_URL="http://127.0.0.1:8001/which-app"
PROD_VENV_PIP="$PROD_DIR/.venv/bin/pip"

if [[ -t 1 ]]; then
  GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; BLUE=$'\e[34m'; BOLD=$'\e[1m'; RESET=$'\e[0m'
else
  GREEN=""; YELLOW=""; RED=""; BLUE=""; BOLD=""; RESET=""
fi
log()  { echo "${BLUE}==>${RESET} $*"; }
ok()   { echo "${GREEN}OK${RESET}  $*"; }
warn() { echo "${YELLOW}WARN${RESET} $*"; }
die()  { echo "${RED}ERR${RESET} $*" >&2; exit 1; }

show_tags_and_usage() {
  echo "${BOLD}Recent prod-v* tags${RESET} (newest first):"
  if [[ -d "$PROD_DIR/.git" ]]; then
    git -C "$PROD_DIR" fetch origin --tags --quiet --prune --prune-tags --force 2>/dev/null || true
    git -C "$PROD_DIR" tag --list 'prod-v*' --sort=-v:refname \
      --format='  %(refname:short)%09%(taggerdate:short)%09%(subject)' \
      | head -n 20 || true
  else
    echo "  (prod checkout not installed at ${PROD_DIR} — see deploy/README.md)"
  fi
  echo
  echo "${BOLD}Usage${RESET}"
  echo "  $0 <prod-vX.Y>     ship a tag to prod (or roll back to an older one)"
}

if [[ $# -eq 0 ]]; then
  show_tags_and_usage
  exit 0
fi

TAG="$1"
[[ "$TAG" == prod-v* ]] || warn "Tag '$TAG' doesn't follow the prod-v* convention — proceeding because you asked."

# ---------------------------------------------------------------------------
# Sanity checks
# ---------------------------------------------------------------------------
[[ -d "$PROD_DIR/.git" ]] || die "Not a git checkout: $PROD_DIR (run the migration in deploy/README.md first)"
[[ -x "$PROD_VENV_PIP" ]] || die "Prod venv pip missing: $PROD_VENV_PIP — was the venv created?"
if ! git -C "$PROD_DIR" diff --quiet || ! git -C "$PROD_DIR" diff --cached --quiet; then
  git -C "$PROD_DIR" status --short
  die "$PROD_DIR has uncommitted changes — investigate before deploying."
fi

before=$(git -C "$PROD_DIR" rev-parse --short HEAD)
current_ref=$(git -C "$PROD_DIR" describe --tags --exact-match 2>/dev/null || git -C "$PROD_DIR" branch --show-current 2>/dev/null || echo "detached")
log "PROD: ${PROD_DIR} currently at ${current_ref:-detached} (${before})"

log "Fetching tags from origin…"
# --force so a moved tag on origin (e.g. you re-tagged prod-v1.X while
# testing) overwrites the local copy instead of aborting the deploy with
# "would clobber existing tag". --prune-tags still removes tags that were
# deleted upstream; --force only governs how mismatched tags are resolved.
git -C "$PROD_DIR" fetch origin --tags --prune --prune-tags --force
if ! git -C "$PROD_DIR" rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  die "Tag '${TAG}' not found even after fetch. Did you 'git push origin ${TAG}' from your dev machine?"
fi

log "Checking out ${TAG}…"
git -C "$PROD_DIR" checkout --quiet "$TAG"
after=$(git -C "$PROD_DIR" rev-parse --short HEAD)
if [[ "$before" == "$after" ]]; then
  log "Already at ${after} — restarting anyway."
else
  log "Updated ${before} → ${after}"
fi

# Only re-resolve dependencies when requirements.txt actually changed, so a
# tiny CSS-only release doesn't pay the ~10s pip cost.
if [[ "$before" != "$after" ]] && ! git -C "$PROD_DIR" diff --quiet "$before" "$after" -- requirements.txt; then
  log "requirements.txt changed — running pip install in prod venv…"
  "$PROD_VENV_PIP" install -r "$PROD_DIR/requirements.txt"
else
  log "requirements.txt unchanged — skipping pip install."
fi

log "Restarting ${PROD_SERVICE}…"
sudo systemctl restart "$PROD_SERVICE"
sleep 2
if ! systemctl is-active --quiet "$PROD_SERVICE"; then
  echo "--- last 50 log lines for ${PROD_SERVICE} ---"
  sudo journalctl -u "$PROD_SERVICE" -n 50 --no-pager || true
  die "${PROD_SERVICE} failed to start."
fi
ok "${PROD_SERVICE} is running."

if command -v curl >/dev/null 2>&1; then
  if curl --fail --silent --max-time 5 "$PROD_HEALTH_URL" >/dev/null; then
    ok "Health probe ${PROD_HEALTH_URL} responded."
  else
    warn "Health probe ${PROD_HEALTH_URL} did not respond — check the service logs."
  fi
fi

ok "Prod push complete. Tag: ${TAG} → ${after}. https://t1classifieds.com/which-app"
