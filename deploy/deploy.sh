#!/usr/bin/env bash
# deploy.sh — single entry point for deploying dev (rorhoff.com) and prod (t1classifieds.com).
# Replaces the old "cd /home/ubuntu/Website && git pull && restart" one-liner now that
# prod runs from its own checkout pinned to git tags. Dev still tracks `main`; prod only
# moves when you explicitly check out a `prod-v*` tag.
#
# Install (one-time, on EC2):
#   sudo cp /home/ubuntu/Website/deploy/deploy.sh /home/ubuntu/deploy.sh
#   sudo chmod +x /home/ubuntu/deploy.sh
#
# Usage:
#   ./deploy.sh dev                  Pull origin/main into /home/ubuntu/Website, restart webapi-dev.
#   ./deploy.sh prod <prod-vX.Y>     Fetch tags, check out the given tag in /home/ubuntu/website-prod,
#                                    restart webapi-prod. Use the same command to roll back to a
#                                    previous tag.
#   ./deploy.sh prod-list            Show the most recent prod-v* tags from origin.
#   ./deploy.sh status               Print what each service is running and whether it's active.
#
# Examples:
#   ./deploy.sh dev
#   ./deploy.sh prod prod-v1.1       # ship the new release
#   ./deploy.sh prod prod-v1.0       # rollback to the previous tag
#   ./deploy.sh status

set -euo pipefail

# ---------------------------------------------------------------------------
# Configurable paths. Match the values in deploy/README.md and the systemd
# unit files; if you ever rename a directory or service, change it once here.
# ---------------------------------------------------------------------------
DEV_DIR="/home/ubuntu/Website"
PROD_DIR="/home/ubuntu/website-prod"
DEV_SERVICE="webapi-dev"
PROD_SERVICE="webapi-prod"
DEV_HEALTH_URL="http://127.0.0.1:8000/which-app"
PROD_HEALTH_URL="http://127.0.0.1:8001/which-app"

# ---------------------------------------------------------------------------
# Pretty logging — coloured only when stdout is a TTY so cron / journal stays
# clean if you ever wire this into automation.
# ---------------------------------------------------------------------------
if [[ -t 1 ]]; then
  GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; BLUE=$'\e[34m'; BOLD=$'\e[1m'; RESET=$'\e[0m'
else
  GREEN=""; YELLOW=""; RED=""; BLUE=""; BOLD=""; RESET=""
fi

log()  { echo "${BLUE}==>${RESET} $*"; }
ok()   { echo "${GREEN}OK${RESET}  $*"; }
warn() { echo "${YELLOW}WARN${RESET} $*"; }
die()  { echo "${RED}ERR${RESET} $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Small git helpers. Always pass -C <dir> so we never get confused by the
# caller's cwd; that means this script works the same whether you run it
# from /home/ubuntu, from inside one of the checkouts, or via `bash -lc`.
# ---------------------------------------------------------------------------
short_sha() { git -C "$1" rev-parse --short HEAD; }

current_ref() {
  local dir="$1" ref=""
  # Prefer an exact-tag match (prod is usually checked out at a tag in detached HEAD);
  # fall back to the branch name (dev), and finally to "detached" if neither applies.
  if ref=$(git -C "$dir" describe --tags --exact-match 2>/dev/null); then
    echo "$ref"
  else
    ref=$(git -C "$dir" branch --show-current 2>/dev/null || true)
    echo "${ref:-detached}"
  fi
}

verify_dir() {
  [[ -d "$1/.git" ]] || die "Not a git checkout: $1"
}

verify_clean() {
  # Refuse to deploy on top of uncommitted edits — those would be silently lost on
  # checkout, and "clean working tree" is part of why we have two directories.
  if ! git -C "$1" diff --quiet || ! git -C "$1" diff --cached --quiet; then
    git -C "$1" status --short
    die "$1 has uncommitted changes. Stash or revert them before deploying."
  fi
}

# Run pip install only when requirements.txt actually changed between the
# previous and new commits. Saves ~10s on no-op deploys and avoids re-resolving
# transitive deps that haven't moved.
pip_install_if_changed() {
  local dir="$1" pre="$2" post="$3"
  local pip="$dir/.venv/bin/pip"
  [[ -x "$pip" ]] || die "venv pip missing: $pip — was the venv created?"
  if [[ "$pre" == "$post" ]]; then
    log "No commit change — skipping pip install."
    return 0
  fi
  if git -C "$dir" diff --quiet "$pre" "$post" -- requirements.txt 2>/dev/null; then
    log "requirements.txt unchanged — skipping pip install."
  else
    log "requirements.txt changed — running pip install…"
    "$pip" install -r "$dir/requirements.txt"
  fi
}

restart_service() {
  local svc="$1" health_url="$2"
  log "Restarting ${svc}…"
  sudo systemctl restart "$svc"
  # Give uvicorn a beat to bind its socket and run startup hooks before we probe.
  sleep 2
  if ! systemctl is-active --quiet "$svc"; then
    echo "--- last 50 log lines for ${svc} ---"
    sudo journalctl -u "$svc" -n 50 --no-pager || true
    die "${svc} failed to start."
  fi
  ok "${svc} is running."
  if command -v curl >/dev/null 2>&1; then
    # Best-effort liveness check; don't fail the deploy if curl can't reach it
    # (the SystemD restart already proved the process is alive).
    if curl --fail --silent --max-time 5 "$health_url" >/dev/null; then
      ok "Health probe ${health_url} responded."
    else
      warn "Health probe ${health_url} did not respond — check the service logs."
    fi
  fi
}

# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------
cmd_dev() {
  verify_dir "$DEV_DIR"
  verify_clean "$DEV_DIR"
  local before after
  before=$(short_sha "$DEV_DIR")
  log "DEV: ${DEV_DIR} currently at $(current_ref "$DEV_DIR") (${before})"
  log "Fetching origin (main + tags)…"
  git -C "$DEV_DIR" fetch origin main --tags --prune
  # Fast-forward only — refuse to merge unrelated divergent history; those should be
  # handled deliberately by hand, not via the deploy script.
  git -C "$DEV_DIR" checkout main >/dev/null
  git -C "$DEV_DIR" pull --ff-only origin main
  after=$(short_sha "$DEV_DIR")
  if [[ "$before" == "$after" ]]; then
    log "Already at $after — restarting anyway in case env/config moved."
  else
    log "Updated ${before} → ${after}"
  fi
  pip_install_if_changed "$DEV_DIR" "$before" "$after"
  restart_service "$DEV_SERVICE" "$DEV_HEALTH_URL"
  ok "Dev deploy complete. https://rorhoff.com/which-app"
}

cmd_prod() {
  local tag="${1:-}"
  [[ -n "$tag" ]] || die "Missing tag. Usage: $0 prod <prod-vX.Y>  (try '$0 prod-list')"
  if [[ "$tag" != prod-v* ]]; then
    warn "Tag '$tag' doesn't follow prod-v* convention — proceeding because you asked."
  fi
  verify_dir "$PROD_DIR"
  verify_clean "$PROD_DIR"
  local before after current
  before=$(short_sha "$PROD_DIR")
  current=$(current_ref "$PROD_DIR")
  log "PROD: ${PROD_DIR} currently at ${current} (${before})"
  log "Fetching tags from origin…"
  git -C "$PROD_DIR" fetch origin --tags --prune --prune-tags
  if ! git -C "$PROD_DIR" rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
    die "Tag '${tag}' not found even after fetch. Did you 'git push origin ${tag}'?"
  fi
  log "Checking out ${tag}…"
  git -C "$PROD_DIR" checkout --quiet "$tag"
  after=$(short_sha "$PROD_DIR")
  if [[ "$before" == "$after" ]]; then
    log "Already at $after — restarting anyway."
  else
    log "Updated ${before} → ${after}"
  fi
  pip_install_if_changed "$PROD_DIR" "$before" "$after"
  restart_service "$PROD_SERVICE" "$PROD_HEALTH_URL"
  ok "Prod deploy complete. Tag: ${tag} → ${after}. https://t1classifieds.com/which-app"
}

cmd_prod_list() {
  verify_dir "$PROD_DIR"
  log "Fetching tags from origin…"
  git -C "$PROD_DIR" fetch origin --tags --quiet --prune --prune-tags
  log "Recent prod-v* tags (newest first):"
  git -C "$PROD_DIR" tag --list 'prod-v*' --sort=-v:refname \
    --format='  %(refname:short)%09%(taggerdate:short)%09%(subject)' \
    | head -n 20 || true
}

cmd_status() {
  echo "${BOLD}Dev${RESET}  (${DEV_DIR} → ${DEV_SERVICE})"
  if [[ -d "$DEV_DIR/.git" ]]; then
    echo "  ref:    $(current_ref "$DEV_DIR")"
    echo "  sha:    $(short_sha "$DEV_DIR")"
    echo "  svc:    $(systemctl is-active "$DEV_SERVICE" 2>/dev/null || echo unknown)"
  else
    echo "  (not installed)"
  fi
  echo
  echo "${BOLD}Prod${RESET} (${PROD_DIR} → ${PROD_SERVICE})"
  if [[ -d "$PROD_DIR/.git" ]]; then
    echo "  ref:    $(current_ref "$PROD_DIR")"
    echo "  sha:    $(short_sha "$PROD_DIR")"
    echo "  svc:    $(systemctl is-active "$PROD_SERVICE" 2>/dev/null || echo unknown)"
  else
    echo "  (not installed — see deploy/README.md migration runbook)"
  fi
}

usage() {
  cat <<USAGE
Usage:
  $0 dev                       Pull origin/main into $DEV_DIR and restart $DEV_SERVICE.
  $0 prod <prod-vX.Y>          Check out a release tag in $PROD_DIR and restart $PROD_SERVICE.
                               Use the same command with an older tag to roll back.
  $0 prod-list                 Show recent prod-v* tags from origin.
  $0 status                    Print what each service is running and whether it's active.

Examples:
  $0 dev
  $0 prod prod-v1.1            # ship a new release
  $0 prod prod-v1.0            # rollback to a previous tag
  $0 status
USAGE
}

case "${1:-}" in
  dev)        cmd_dev ;;
  prod)       shift; cmd_prod "${1:-}" ;;
  prod-list)  cmd_prod_list ;;
  status)     cmd_status ;;
  ""|-h|--help|help) usage ;;
  *) usage; exit 1 ;;
esac
