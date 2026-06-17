#!/usr/bin/env bash
# install-referr-all-origin-cert.sh — install the Cloudflare Origin Certificate for
# referr-all.com on EC2, with correct permissions, then validate nginx.
#
# Cloudflare Origin certs are issued in the dashboard, not via CLI:
#   Cloudflare -> referr-all.com -> SSL/TLS -> Origin Server -> Create Certificate
#   Hostnames: referr-all.com, *.referr-all.com   (RSA, 15 years)
# Copy the "Origin Certificate" block and the "Private Key" block when prompted below.
# Afterwards set SSL/TLS -> Overview mode to "Full (strict)".
#
# Usage:
#   # Interactive (paste each block, end with Ctrl-D):
#   sudo ./install-referr-all-origin-cert.sh
#
#   # Or from files you already saved:
#   sudo ./install-referr-all-origin-cert.sh /path/to/cert.pem /path/to/key.key

set -euo pipefail

DOMAIN="referr-all.com"
CERT_DIR="/etc/ssl/cloudflare"
PEM="$CERT_DIR/$DOMAIN.pem"
KEY="$CERT_DIR/$DOMAIN.key"

if [[ -t 1 ]]; then
  GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; BLUE=$'\e[34m'; RESET=$'\e[0m'
else
  GREEN=""; YELLOW=""; RED=""; BLUE=""; RESET=""
fi
log()  { echo "${BLUE}==>${RESET} $*"; }
ok()   { echo "${GREEN}OK${RESET}  $*"; }
warn() { echo "${YELLOW}WARN${RESET} $*"; }
die()  { echo "${RED}ERR${RESET} $*" >&2; exit 1; }

# Re-exec under sudo so the writes to /etc/ssl succeed.
if [[ $EUID -ne 0 ]]; then
  exec sudo -E bash "$0" "$@"
fi

install -d -m 755 -o root -g root "$CERT_DIR"

if [[ -f "$PEM" || -f "$KEY" ]]; then
  warn "Existing cert/key found in ${CERT_DIR}."
  read -r -p "Overwrite ${DOMAIN} cert + key? [y/N] " ans
  [[ "${ans:-}" =~ ^[Yy]$ ]] || die "Aborted — nothing changed."
fi

if [[ $# -eq 2 ]]; then
  # File mode.
  cert_src="$1"; key_src="$2"
  [[ -f "$cert_src" ]] || die "Certificate file not found: $cert_src"
  [[ -f "$key_src"  ]] || die "Private key file not found: $key_src"
  install -m 644 -o root -g root "$cert_src" "$PEM"
  install -m 600 -o root -g root "$key_src"  "$KEY"
elif [[ $# -eq 0 ]]; then
  # Interactive paste mode.
  echo
  echo "Paste the ${BLUE}Origin Certificate${RESET} (-----BEGIN CERTIFICATE----- … -----END CERTIFICATE-----)."
  echo "Then press ${BLUE}Ctrl-D${RESET} on a new line:"
  umask 022
  cat > "$PEM"
  echo
  echo "Paste the ${BLUE}Private Key${RESET} (-----BEGIN PRIVATE KEY----- … -----END PRIVATE KEY-----)."
  echo "Then press ${BLUE}Ctrl-D${RESET} on a new line:"
  umask 077
  cat > "$KEY"
else
  die "Usage: $0  [cert.pem key.key]   (no args = interactive paste)"
fi

chown root:root "$PEM" "$KEY"
chmod 644 "$PEM"
chmod 600 "$KEY"

# Sanity: non-empty + correct PEM markers.
grep -q "BEGIN CERTIFICATE"  "$PEM" || die "$PEM does not contain a certificate."
grep -q "BEGIN .*PRIVATE KEY" "$KEY" || die "$KEY does not contain a private key."

# Sanity: the key actually matches the certificate (modulus comparison).
if command -v openssl >/dev/null 2>&1; then
  cert_mod=$(openssl x509 -noout -modulus -in "$PEM" 2>/dev/null | openssl md5 2>/dev/null || true)
  key_mod=$(openssl rsa  -noout -modulus -in "$KEY" 2>/dev/null | openssl md5 2>/dev/null || true)
  if [[ -n "$cert_mod" && -n "$key_mod" && "$cert_mod" != "$key_mod" ]]; then
    die "Certificate and private key do NOT match (modulus mismatch). Re-check what you pasted."
  fi
  exp=$(openssl x509 -noout -enddate -in "$PEM" 2>/dev/null | cut -d= -f2 || true)
  [[ -n "$exp" ]] && log "Certificate valid until: ${exp}"
else
  warn "openssl not found — skipped cert/key match check."
fi

ok "Installed:"
echo "    $PEM   (644)"
echo "    $KEY   (600)"

# Validate nginx if the referr-all vhost references these paths.
if command -v nginx >/dev/null 2>&1; then
  log "Testing nginx config…"
  if nginx -t; then
    ok "nginx config is valid."
    echo
    echo "Next:"
    echo "  sudo systemctl reload nginx"
    echo "  # Cloudflare -> referr-all.com -> SSL/TLS -> Overview -> set mode to 'Full (strict)'"
    echo "  curl -s https://referr-all.com/which-app"
  else
    warn "nginx -t failed. Make sure deploy/nginx-referr-all.conf is installed and enabled:"
    echo "  sudo cp deploy/nginx-referr-all.conf /etc/nginx/sites-available/referr-all.conf"
    echo "  sudo ln -s /etc/nginx/sites-available/referr-all.conf /etc/nginx/sites-enabled/"
    echo "  sudo nginx -t && sudo systemctl reload nginx"
  fi
else
  warn "nginx not found on PATH — skipped config test."
fi
