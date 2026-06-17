#!/usr/bin/env bash
# setup-referr-all-prod.sh — one-time provisioning for the referr-all.com prod service.
#
# Idempotent: safe to re-run. Each phase skips work that is already done, so if a run
# fails partway (e.g. you forgot to paste a secret), just run it again.
#
# Run on the EC2 box, as the `ubuntu` user, from the dev checkout:
#   cd /home/ubuntu/Website && git pull
#   chmod +x deploy/setup-referr-all-prod.sh
#   ./deploy/setup-referr-all-prod.sh
#
# It provisions everything that mirrors the t1classifieds prod model for Referr-All:
#   - /home/ubuntu/website-referrall  (separate git checkout + venv)
#   - ReferrAll_Prod database         (same RDS instance, separate DB; derived from .env.dev)
#   - .env.referrall                  (non-secret values auto-filled; you paste the secrets)
#   - webapi-referrall systemd unit   (installed + enabled, NOT started — see note below)
#   - nginx vhost for referr-all.com
#   - Cloudflare Origin cert          (interactive paste, via install-referr-all-origin-cert.sh)
#   - ~/commitreferrall.sh            (the deploy/rollback script)
#
# The service is intentionally NOT started here: the committed static/referr-all is a
# "/referr-all/"-base build, but referr-all.com serves the SPA at "/", which needs a
# "--base=/" build. The first `~/commitreferrall.sh referrall-v1.0` produces that build and
# starts the service.

set -euo pipefail

DEV_DIR="/home/ubuntu/Website"
REFERRALL_DIR="/home/ubuntu/website-referrall"
ENV_FILE="$REFERRALL_DIR/.env.referrall"
ENV_TEMPLATE="$DEV_DIR/deploy/.env.referrall.example"
SERVICE_SRC="$DEV_DIR/deploy/webapi-referrall.service"
SERVICE_DST="/etc/systemd/system/webapi-referrall.service"
NGINX_SRC="$DEV_DIR/deploy/nginx-referr-all.conf"
NGINX_AVAIL="/etc/nginx/sites-available/referr-all.conf"
NGINX_ENABLED="/etc/nginx/sites-enabled/referr-all.conf"
CERT_SCRIPT="$DEV_DIR/deploy/install-referr-all-origin-cert.sh"
CERT_PEM="/etc/ssl/cloudflare/referr-all.com.pem"
COMMIT_SCRIPT_SRC="$DEV_DIR/deploy/commitreferrall.sh"
COMMIT_SCRIPT_DST="$HOME/commitreferrall.sh"
PROD_DB="ReferrAll_Prod"
SERVICE="webapi-referrall"

if [[ -t 1 ]]; then
  GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; BLUE=$'\e[34m'; BOLD=$'\e[1m'; RESET=$'\e[0m'
else
  GREEN=""; YELLOW=""; RED=""; BLUE=""; BOLD=""; RESET=""
fi
log()   { echo "${BLUE}==>${RESET} $*"; }
ok()    { echo "${GREEN}OK${RESET}  $*"; }
warn()  { echo "${YELLOW}WARN${RESET} $*"; }
die()   { echo "${RED}ERR${RESET} $*" >&2; exit 1; }
phase() { echo; echo "${BOLD}── $* ──${RESET}"; }

# ---------------------------------------------------------------------------
# Phase 0: preflight
# ---------------------------------------------------------------------------
phase "Phase 0: preflight"
[[ "$EUID" -ne 0 ]] || die "Run as the ubuntu user (NOT root). The script uses sudo only where needed."
[[ -d "$DEV_DIR/.git" ]] || die "Dev checkout not found at $DEV_DIR — this script runs on the EC2 box."
[[ -f "$ENV_TEMPLATE" ]] || die "Missing $ENV_TEMPLATE — run 'git pull' in $DEV_DIR first."
[[ -f "$SERVICE_SRC" ]]  || die "Missing $SERVICE_SRC — run 'git pull' in $DEV_DIR first."
[[ -f "$NGINX_SRC" ]]    || die "Missing $NGINX_SRC — run 'git pull' in $DEV_DIR first."
[[ -f "$CERT_SCRIPT" ]]  || die "Missing $CERT_SCRIPT — run 'git pull' in $DEV_DIR first."
[[ -f "$COMMIT_SCRIPT_SRC" ]] || die "Missing $COMMIT_SCRIPT_SRC — run 'git pull' in $DEV_DIR first."

for cmd in git python3 sudo systemctl nginx; do
  command -v "$cmd" >/dev/null 2>&1 || die "Required command not found: $cmd"
done
HAVE_PSQL=1; command -v psql >/dev/null 2>&1 || { HAVE_PSQL=0; warn "psql not found — DB creation step will be skipped (create ReferrAll_Prod manually)."; }
command -v npm >/dev/null 2>&1 || warn "npm not found — fine for setup, but commitreferrall.sh needs it to build the SPA."
ok "Preflight checks passed."

# ---------------------------------------------------------------------------
# Phase 1: prod checkout + venv
# ---------------------------------------------------------------------------
phase "Phase 1: checkout + venv ($REFERRALL_DIR)"
if [[ -d "$REFERRALL_DIR/.git" ]]; then
  log "Checkout already exists — fetching latest tags/branches."
  git -C "$REFERRALL_DIR" fetch origin --tags --prune --force || warn "git fetch failed (continuing)."
else
  ORIGIN_URL="$(git -C "$DEV_DIR" remote get-url origin)"
  log "Cloning $ORIGIN_URL → $REFERRALL_DIR"
  git clone "$ORIGIN_URL" "$REFERRALL_DIR"
fi

if [[ ! -x "$REFERRALL_DIR/.venv/bin/python" ]]; then
  log "Creating virtualenv…"
  python3 -m venv "$REFERRALL_DIR/.venv"
fi
log "Installing Python dependencies (this can take a moment)…"
"$REFERRALL_DIR/.venv/bin/pip" install --upgrade pip >/dev/null
"$REFERRALL_DIR/.venv/bin/pip" install -r "$REFERRALL_DIR/requirements.txt"
ok "Checkout + venv ready."

# ---------------------------------------------------------------------------
# Phase 2: dedicated prod database (derived from dev .env.dev)
# ---------------------------------------------------------------------------
# Provision the dedicated prod DB. Fully non-fatal: every risky command is guarded so a
# missing var / bad connection only warns and the script continues to the cert phase.
# Sets the global PROD_APP_DB_URL when it can derive the connection.
provision_database() {
  [[ "$HAVE_PSQL" -eq 1 ]] || { warn "psql unavailable — create $PROD_DB manually."; return 0; }

  local dev_env="$DEV_DIR/.env.dev"
  if [[ ! -f "$dev_env" ]]; then
    warn "No $dev_env — cannot derive DB connection. Create $PROD_DB manually and set DATABASE_URL in $ENV_FILE."
    return 0
  fi

  # Pipefail-safe: sed prints the value, tail consumes all input (no SIGPIPE from an early
  # 'head' exit), and '|| true' covers the no-match case. Then strip one layer of quotes.
  local dev_db_url
  dev_db_url="$(sed -n 's/^DATABASE_URL=//p' "$dev_env" | tail -n1 || true)"
  dev_db_url="${dev_db_url%[\"\']}"
  dev_db_url="${dev_db_url#[\"\']}"
  if [[ -z "$dev_db_url" ]]; then
    warn "DATABASE_URL not set in $dev_env — skipping DB auto-create."
    return 0
  fi

  # Derive the prod app URL (keeps the +psycopg driver, db=ReferrAll_Prod) plus two admin
  # URLs (plain postgresql:// to the maintenance DB, then to the dev DB as a fallback).
  local derived app admin_pg admin_dev
  derived="$(python3 - "$dev_db_url" "$PROD_DB" <<'PY' || true
import sys, urllib.parse as u
dev, prod_db = sys.argv[1], sys.argv[2]
p = u.urlparse(dev)
print(p._replace(path="/" + prod_db).geturl())
print(p._replace(scheme="postgresql", path="/postgres").geturl())
print(p._replace(scheme="postgresql").geturl())
PY
)"
  app="$(printf '%s\n' "$derived" | sed -n '1p')"
  admin_pg="$(printf '%s\n' "$derived" | sed -n '2p')"
  admin_dev="$(printf '%s\n' "$derived" | sed -n '3p')"
  if [[ -z "$app" ]]; then
    warn "Could not parse the dev DATABASE_URL — set DATABASE_URL in $ENV_FILE manually."
    return 0
  fi
  PROD_APP_DB_URL="$app"

  local admin_url=""
  if psql "$admin_pg" -tAc "SELECT 1" >/dev/null 2>&1; then
    admin_url="$admin_pg"
  elif psql "$admin_dev" -tAc "SELECT 1" >/dev/null 2>&1; then
    admin_url="$admin_dev"
  fi
  if [[ -z "$admin_url" ]]; then
    warn "Could not connect to Postgres with the dev credentials — create $PROD_DB manually."
    return 0
  fi

  local exists
  exists="$(psql "$admin_url" -tAc "SELECT 1 FROM pg_database WHERE datname='$PROD_DB'" 2>/dev/null || true)"
  if [[ "$exists" == "1" ]]; then
    ok "Database $PROD_DB already exists."
  elif psql "$admin_url" -c "CREATE DATABASE \"$PROD_DB\""; then
    ok "Created $PROD_DB (empty; tables auto-create on first service start)."
  else
    warn "CREATE DATABASE failed — create $PROD_DB manually."
  fi
  return 0
}

phase "Phase 2: database ($PROD_DB)"
PROD_APP_DB_URL=""
provision_database || warn "Database phase skipped (continuing with provisioning)."

# ---------------------------------------------------------------------------
# Phase 3: env file
# ---------------------------------------------------------------------------
phase "Phase 3: env file ($ENV_FILE)"
if [[ -f "$ENV_FILE" ]]; then
  log ".env.referrall already exists — leaving it in place (edit it yourself if needed)."
else
  cp "$ENV_TEMPLATE" "$ENV_FILE"
  ok "Created $ENV_FILE from template."
fi
chmod 600 "$ENV_FILE"

if [[ -n "$PROD_APP_DB_URL" ]]; then
  if python3 - "$ENV_FILE" "$PROD_APP_DB_URL" <<'PY'
import sys
path, url = sys.argv[1], sys.argv[2]
lines = open(path, encoding="utf-8").read().splitlines()
out, done = [], False
for ln in lines:
    if ln.startswith("DATABASE_URL=") and not done:
        out.append("DATABASE_URL=" + url); done = True
    else:
        out.append(ln)
if not done:
    out.append("DATABASE_URL=" + url)
open(path, "w", encoding="utf-8").write("\n".join(out) + "\n")
PY
  then
    ok "Set DATABASE_URL in $ENV_FILE to the derived $PROD_DB connection."
  else
    warn "Could not rewrite DATABASE_URL — set it manually in $ENV_FILE (db must be $PROD_DB)."
  fi
else
  warn "DATABASE_URL not auto-set — set it manually in $ENV_FILE (db must be $PROD_DB)."
fi

echo
echo "${BOLD}Now paste the remaining secrets${RESET} into $ENV_FILE:"
echo "  - CLOUDFLARE_API_TOKEN   (token with 'Email Sending: Edit')"
echo "  - CLOUDFLARE_ACCOUNT_ID"
echo "  - STRIPE_* live keys      (optional, for premium)"
echo "  - S3_* / R2               (optional, for uploads)"
_ans=""
read -r -p "Open $ENV_FILE in an editor now? [Y/n] " _ans || true
if [[ ! "${_ans:-Y}" =~ ^[Nn]$ ]]; then
  "${EDITOR:-nano}" "$ENV_FILE" || warn "Editor exited non-zero — re-check $ENV_FILE before deploying."
fi
if ! grep -qE '^CLOUDFLARE_API_TOKEN=.+' "$ENV_FILE"; then
  warn "CLOUDFLARE_API_TOKEN is still empty — email sending will be a logged no-op until you set it."
fi

# ---------------------------------------------------------------------------
# Phase 4: systemd unit (install + enable, do NOT start yet)
# ---------------------------------------------------------------------------
phase "Phase 4: systemd unit ($SERVICE)"
sudo cp "$SERVICE_SRC" "$SERVICE_DST"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE" >/dev/null 2>&1 || true
ok "Installed + enabled $SERVICE (not started — the first deploy builds the SPA and starts it)."

# ---------------------------------------------------------------------------
# Phase 5: nginx vhost
# ---------------------------------------------------------------------------
phase "Phase 5: nginx vhost (referr-all.com)"
sudo cp "$NGINX_SRC" "$NGINX_AVAIL"
if [[ ! -e "$NGINX_ENABLED" ]]; then
  sudo ln -s "$NGINX_AVAIL" "$NGINX_ENABLED"
fi
ok "Installed nginx vhost (config tested after the cert is in place)."

# ---------------------------------------------------------------------------
# Phase 6: Cloudflare Origin cert
# ---------------------------------------------------------------------------
phase "Phase 6: TLS Origin certificate"
if [[ -f "$CERT_PEM" ]]; then
  ok "Origin cert already present at $CERT_PEM."
else
  log "Launching the Origin cert installer (paste the cert + key from the Cloudflare dashboard)…"
  bash "$CERT_SCRIPT" || warn "Cert install did not complete — re-run this script (or $CERT_SCRIPT) after creating the cert."
fi

if [[ -f "$CERT_PEM" ]]; then
  log "Testing nginx config…"
  if sudo nginx -t; then
    sudo systemctl reload nginx
    ok "nginx reloaded with the referr-all.com vhost."
  else
    warn "nginx -t failed — fix the config, then: sudo nginx -t && sudo systemctl reload nginx"
  fi
else
  warn "Cert not installed yet — skipping nginx reload. nginx -t will fail until the cert exists."
fi

# ---------------------------------------------------------------------------
# Phase 7: install the deploy/rollback script
# ---------------------------------------------------------------------------
phase "Phase 7: deploy script (~/commitreferrall.sh)"
cp "$COMMIT_SCRIPT_SRC" "$COMMIT_SCRIPT_DST"
chmod +x "$COMMIT_SCRIPT_DST"
ok "Installed $COMMIT_SCRIPT_DST."

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
phase "Provisioning complete"
cat <<EOF
Remaining steps to go live:

  1) From your DEV machine, create + push the first release tag:
       git checkout main && git pull
       git tag -a referrall-v1.0 -m "First referr-all.com release"
       git push origin referrall-v1.0

  2) On this box, run the first deploy (builds the SPA with base / and starts the service):
       ~/commitreferrall.sh referrall-v1.0

  3) In Cloudflare:
       - SSL/TLS -> Overview -> set mode to "Full (strict)"
       - Compute -> Email Service -> Email Sending -> onboard referr-all.com (for password reset / verify email)

  4) Verify:
       curl -s https://referr-all.com/which-app     # SERVICE_MODE=referrall
       curl -s https://rorhoff.com/which-app        # SERVICE_MODE=full (dev untouched)
EOF
ok "Setup script finished."
