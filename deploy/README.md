# Deploy runbook — `rorhoff.com` (dev) + `t1classifieds.com` (prod)

This folder holds the platform configs that make the dev/prod split real.
Code lives in the repo root; this file walks you from a working dev box to two
isolated services on one EC2 instance, with Cloudflare in front of prod.

```
                        ┌─────────────────────────────┐
   rorhoff.com (DNS) ──►│  nginx (rorhoff.conf)       │──► 127.0.0.1:8000  webapi-dev
                        │                             │                    SERVICE_MODE=full
                        │                             │                    DB=RoryPortfolio
                        │                             │
   t1classifieds.com ──►│  nginx (t1classifieds.conf) │──► 127.0.0.1:8001  webapi-prod
   (proxied via         │                             │                    SERVICE_MODE=classifieds
    Cloudflare)         └─────────────────────────────┘                    DB=Classifieds_Prod
```

One EC2 box, one RDS instance (separate database), one R2 bucket (separate key prefix).

---

## 1. Create the prod database on RDS

Connect to the existing RDS Postgres as `dbadmin`:

```bash
psql "postgresql://dbadmin:PASS@roryporfolio.cl0oawym20pw.us-west-1.rds.amazonaws.com:5432/RoryPortfolio"
```

Then:

```sql
CREATE DATABASE "Classifieds_Prod";
```

Schema is auto-created at first uvicorn start by `credential_service.create_tables()` +
SQLAlchemy `Base.metadata.create_all()`. No data is copied from dev — prod starts empty.

## 2. Create the R2 bucket and API token

In the Cloudflare dashboard:

1. **R2 → Create bucket** → `t1classifieds` (one bucket; we'll use prefixes to separate dev/prod).
2. **R2 → Manage API Tokens → Create API token** → Permissions: **Object Read & Write**,
   Specify bucket: `t1classifieds`. Copy the access key ID and secret.
3. Either turn on the bucket's **r2.dev** public URL (fast, ugly hostname) or attach a
   custom domain like `images.t1classifieds.com` once Cloudflare DNS is set up.
4. Find your **Account ID** in the R2 sidebar — that's the `<account_id>` below.

Bucket CORS is **not required** because the browser never uploads directly to R2; the
FastAPI backend is the only client that PUTs.

## 3. Create the two env files on EC2

Both files live on the EC2 box, next to `main.py`, and are gitignored. Copy
`.env.example` as the template; set chmod 600 so only the deploy user reads them.

**`/home/ubuntu/Website/.env.dev`** (dev — full app, current behavior):

```ini
APP_ENV=development
SERVICE_MODE=full
CORS_ORIGINS=https://rorhoff.com,https://www.rorhoff.com,http://127.0.0.1:8000,http://localhost:8000
SESSION_COOKIE_SECURE=1
DATABASE_URL=postgresql+psycopg://dbadmin:PASS@roryporfolio.cl0oawym20pw.us-west-1.rds.amazonaws.com:5432/RoryPortfolio

# Optional in dev; if omitted, uploads fall back to inline base64 (current behavior).
S3_BUCKET=t1classifieds
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_ENDPOINT_URL=https://<account_id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_PUBLIC_BASE_URL=https://images.t1classifieds.com
S3_KEY_PREFIX=dev/
```

**`/home/ubuntu/Website/.env.prod`** (prod — classifieds-only, must have storage):

```ini
APP_ENV=production
SERVICE_MODE=classifieds
CORS_ORIGINS=https://t1classifieds.com,https://www.t1classifieds.com
SESSION_COOKIE_SECURE=1
DATABASE_URL=postgresql+psycopg://dbadmin:PASS@roryporfolio.cl0oawym20pw.us-west-1.rds.amazonaws.com:5432/Classifieds_Prod

S3_BUCKET=t1classifieds
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_ENDPOINT_URL=https://<account_id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_PUBLIC_BASE_URL=https://images.t1classifieds.com
S3_KEY_PREFIX=prod/

# DIFFERENT pair from dev — these grant access to the API dashboard.
API_KEY=...
API_SECRET=...
```

```bash
sudo chown ubuntu:ubuntu /home/ubuntu/Website/.env.*
sudo chmod 600 /home/ubuntu/Website/.env.*
```

## 4. Install the two systemd services

```bash
cd /home/ubuntu/Website
git pull
.venv/bin/pip install -r requirements.txt   # picks up boto3

sudo cp deploy/webapi-dev.service  /etc/systemd/system/
sudo cp deploy/webapi-prod.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now webapi-dev webapi-prod

# Watch the logs the first time
sudo journalctl -u webapi-dev  -n 50 --no-pager
sudo journalctl -u webapi-prod -n 50 --no-pager
```

If you already had a single `webapi.service`, disable it now:

```bash
sudo systemctl disable --now webapi || true
```

Sanity-check the two ports respond:

```bash
curl -s http://127.0.0.1:8000/which-app
curl -s http://127.0.0.1:8001/which-app
```

The first should print `APP_ENV=development  SERVICE_MODE=full`, the second
`APP_ENV=production  SERVICE_MODE=classifieds`.

## 5. Install the two nginx vhosts

```bash
sudo cp deploy/nginx-rorhoff.conf        /etc/nginx/sites-available/rorhoff.conf
sudo cp deploy/nginx-t1classifieds.conf  /etc/nginx/sites-available/t1classifieds.conf
sudo ln -sf /etc/nginx/sites-available/rorhoff.conf       /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/t1classifieds.conf /etc/nginx/sites-enabled/

sudo nginx -t && sudo systemctl reload nginx
```

If you had a default vhost serving everything, remove its symlink:

```bash
sudo rm /etc/nginx/sites-enabled/default 2>/dev/null || true
```

## 6. Issue / install the prod TLS cert

In Cloudflare → SSL/TLS → **Origin Server → Create Certificate** (defaults are fine).
Save the certificate and private key to EC2:

```bash
sudo mkdir -p /etc/ssl/cloudflare
sudo tee /etc/ssl/cloudflare/t1classifieds.com.pem >/dev/null <<'PEM'
-----BEGIN CERTIFICATE-----
...
-----END CERTIFICATE-----
PEM
sudo tee /etc/ssl/cloudflare/t1classifieds.com.key >/dev/null <<'KEY'
-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----
KEY
sudo chmod 600 /etc/ssl/cloudflare/t1classifieds.com.*

sudo nginx -t && sudo systemctl reload nginx
```

## 7. Point Cloudflare DNS at EC2

In Cloudflare → DNS for `t1classifieds.com`:

| Type | Name | Content                  | Proxy   |
| ---- | ---- | ------------------------ | ------- |
| A    | @    | <EC2 public IPv4>        | Proxied |
| A    | www  | <EC2 public IPv4>        | Proxied |
| CNAME| images | <bucket public hostname> | Proxied (if you used `images.t1classifieds.com`) |

In Cloudflare → SSL/TLS → Overview: set mode to **Full (strict)**.

## 8. Verify

```bash
# from anywhere
curl -s https://rorhoff.com/which-app
curl -s https://t1classifieds.com/which-app

# the prod call should print:
#   APP_ENV=production
#   SERVICE_MODE=classifieds
#   ENV_FILE=/home/ubuntu/Website/.env.prod
```

Visit `https://t1classifieds.com/` in a browser — you should land on the classifieds SPA
directly (no `/classifieds/` in the URL). Register a fresh account; confirm it does **not**
appear on `https://rorhoff.com/classifieds/`. That's your isolation proof.

## 9. (Optional, later) Lock down the EC2 origin

Once prod is healthy, tighten the EC2 security group so port 443 only accepts
Cloudflare's IP ranges (https://www.cloudflare.com/ips/). This means
`t1classifieds.com` is reachable only via Cloudflare — and your raw EC2 IP isn't.
`rorhoff.com` can stay open if you want the unproxied path.

## Rollback

Each service is independent:

```bash
sudo systemctl restart webapi-prod      # bounce one without touching the other
sudo systemctl stop    webapi-prod      # take prod down; dev keeps serving
```

If a deploy breaks prod, `git checkout <previous_sha>` in `/home/ubuntu/Website`,
restart `webapi-prod`, done. Dev is unaffected.
