# Deploy runbook — `rorhoff.com` (dev) + `t1classifieds.com` (prod)

This folder holds the platform configs that make the dev/prod split real.
Code lives in the repo root; this file walks you from a working dev box to two
isolated services on one EC2 instance, with Cloudflare in front of prod.

```
                        ┌─────────────────────────────┐
   rorhoff.com (DNS) ──►│  nginx (rorhoff.conf)       │──► 127.0.0.1:8000  webapi-dev
                        │                             │                    SERVICE_MODE=full
                        │                             │                    DB=RoryPortfolio
                        │                             │                    cwd=/home/ubuntu/Website (tracks `main`)
                        │                             │
   t1classifieds.com ──►│  nginx (t1classifieds.conf) │──► 127.0.0.1:8001  webapi-prod
   (proxied via         │                             │                    SERVICE_MODE=classifieds
    Cloudflare)         └─────────────────────────────┘                    DB=Classifieds_Prod
                                                                            cwd=/home/ubuntu/website-prod (pinned to a prod-v* tag)
```

One EC2 box, one RDS instance (separate database), one R2 bucket (separate key prefix),
**two separate git checkouts so `main` never auto-deploys to prod**.

---

## Release model — short version

- **`main` branch = dev.** A push to `main` flows to `rorhoff.com` after you `git pull` on
  the dev box. It does **not** touch prod.
- **`prod-v*` tags = prod.** Prod runs from `/home/ubuntu/website-prod` which is checked
  out at a specific tag (e.g. `prod-v1.0`). It only moves when you explicitly tag and
  re-checkout.
- **Promote**: tag `main`, push the tag, then on EC2 `git fetch --tags && git checkout
  prod-vX` in the prod directory and restart the service.
- **Rollback**: `git checkout prod-v(X-1)` in the prod directory and restart.

Tag scheme: `prod-vMAJOR.MINOR`. Bump MINOR for normal ships, MAJOR for breaking changes
(DB migrations, env-var changes). Annotated tags only — they show up nicely in `git log`
and carry a release note: `git tag -a prod-v1.1 -m "Bugfix: webhook signature handling"`.

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

Each lives next to its own checkout and is gitignored. Copy `.env.example` as the
template; chmod 600 so only the deploy user reads them.

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

# Stripe — TEST keys for dev so you can buy gold frames without charging real cards.
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_test_...
STRIPE_PUBLIC_BASE_URL=https://rorhoff.com
```

**`/home/ubuntu/website-prod/.env.prod`** (prod — classifieds-only, must have storage):

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

# Stripe — LIVE keys for prod. Webhook secret comes from a *separate* live-mode endpoint.
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_live_...
STRIPE_PUBLIC_BASE_URL=https://t1classifieds.com

# DIFFERENT pair from dev — these grant access to the API dashboard.
API_KEY=...
API_SECRET=...
```

```bash
sudo chown ubuntu:ubuntu /home/ubuntu/Website/.env.dev
sudo chown ubuntu:ubuntu /home/ubuntu/website-prod/.env.prod
sudo chmod 600 /home/ubuntu/Website/.env.dev /home/ubuntu/website-prod/.env.prod
```

## 4. Set up the side-by-side checkouts

The dev directory likely already exists at `/home/ubuntu/Website` (tracking `main`).
We're adding a **second** checkout next to it that prod will run from.

```bash
cd /home/ubuntu

# DEV: confirm the existing checkout is on main and up to date.
cd /home/ubuntu/Website
git checkout main
git pull
.venv/bin/pip install -r requirements.txt   # picks up boto3, stripe, etc.

# PROD: brand-new checkout, pinned to a prod-v* tag.
cd /home/ubuntu
git clone https://github.com/Rorhoff/Website.git website-prod
cd website-prod
git fetch --tags
git checkout prod-v1.0       # ← whichever tag represents the version you want live
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
```

If you previously had `.env.prod` inside `/home/ubuntu/Website`, move it now:

```bash
sudo mv /home/ubuntu/Website/.env.prod /home/ubuntu/website-prod/.env.prod
sudo chown ubuntu:ubuntu /home/ubuntu/website-prod/.env.prod
sudo chmod 600 /home/ubuntu/website-prod/.env.prod
```

## 5. Install the two systemd services

```bash
# Use the dev-checkout copy of the unit files; the prod service unit
# already points at /home/ubuntu/website-prod by design.
sudo cp /home/ubuntu/Website/deploy/webapi-dev.service  /etc/systemd/system/
sudo cp /home/ubuntu/Website/deploy/webapi-prod.service /etc/systemd/system/
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

## 6. Install the two nginx vhosts

```bash
sudo cp /home/ubuntu/Website/deploy/nginx-rorhoff.conf        /etc/nginx/sites-available/rorhoff.conf
sudo cp /home/ubuntu/Website/deploy/nginx-t1classifieds.conf  /etc/nginx/sites-available/t1classifieds.conf
sudo ln -sf /etc/nginx/sites-available/rorhoff.conf       /etc/nginx/sites-enabled/
sudo ln -sf /etc/nginx/sites-available/t1classifieds.conf /etc/nginx/sites-enabled/

sudo nginx -t && sudo systemctl reload nginx
```

If you had a default vhost serving everything, remove its symlink:

```bash
sudo rm /etc/nginx/sites-enabled/default 2>/dev/null || true
```

## 7. Issue / install the prod TLS cert

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

## 8. Point Cloudflare DNS at EC2

In Cloudflare → DNS for `t1classifieds.com`:

| Type | Name | Content                  | Proxy   |
| ---- | ---- | ------------------------ | ------- |
| A    | @    | <EC2 public IPv4>        | Proxied |
| A    | www  | <EC2 public IPv4>        | Proxied |
| CNAME| images | <bucket public hostname> | Proxied (if you used `images.t1classifieds.com`) |

In Cloudflare → SSL/TLS → Overview: set mode to **Full (strict)**.

## 9. Verify

```bash
# from anywhere
curl -s https://rorhoff.com/which-app
curl -s https://t1classifieds.com/which-app

# the prod call should print:
#   APP_ENV=production
#   SERVICE_MODE=classifieds
#   ENV_FILE=/home/ubuntu/website-prod/.env.prod
```

Visit `https://t1classifieds.com/` in a browser — you should land on the classifieds SPA
directly (no `/classifieds/` in the URL). Register a fresh account; confirm it does **not**
appear on `https://rorhoff.com/classifieds/`. That's your isolation proof.

---

## Day-2 ops

Two scripts in this folder are the supported entry points on EC2:

- **`commit.sh`** — push test (rorhoff.com / dev). Pulls `origin/main` into
  `/home/ubuntu/Website` and restarts the dev service.
- **`commitprod.sh`** — push prod (t1classifieds.com). Checks out a `prod-v*`
  tag in `/home/ubuntu/website-prod` and restarts `webapi-prod`.

Install both once (this also overwrites your old `~/commit.sh`):

```bash
cd /home/ubuntu/Website && git pull
cp deploy/commit.sh     ~/commit.sh
cp deploy/commitprod.sh ~/commitprod.sh
chmod +x ~/commit.sh ~/commitprod.sh
```

Each script lists the variables you can tweak at the top (directory paths,
service name, venv pip path) — change them once if your layout differs from
the defaults.

### Deploying to dev / test (the normal workflow)

```bash
~/commit.sh
```

Refuses to run on a dirty working tree, fast-forwards `main`, restarts the dev
service, and curl-probes `127.0.0.1:8000/which-app` to make sure it came back up.
Prod is untouched.

Manual equivalent:

```bash
cd /home/ubuntu/Website
git pull --ff-only origin main
sudo systemctl restart roryportfolio
```

### Promoting test → prod (release a new version)

```bash
# Local: tag the commit you want live and push the tag.
git checkout main && git pull
git tag -a prod-v1.1 -m "Image-tile browse + ad-detail modal"
git push origin prod-v1.1

# On EC2: deploy the tag. This is the only step that actually moves prod.
~/commitprod.sh prod-v1.1
```

The script fetches tags, refuses to deploy if the tag doesn't exist on origin,
checks out the tag in `/home/ubuntu/website-prod`, runs `pip install` only when
`requirements.txt` changed, restarts `webapi-prod`, and probes `127.0.0.1:8001`.

Manual equivalent:

```bash
cd /home/ubuntu/website-prod
git fetch --tags
git checkout prod-v1.1
.venv/bin/pip install -r requirements.txt   # only if deps changed
sudo systemctl restart webapi-prod
```

### Listing tags

```bash
~/commitprod.sh                 # no args = show recent prod-v* tags + usage
```

### Rolling back prod

Same script, with an older tag:

```bash
~/commitprod.sh prod-v1.0
```

Code rollbacks are this simple. If a release also ran a DB migration you need
to undo, restoring an RDS snapshot is a separate (AWS console) step.

### Independent restarts

```bash
sudo systemctl restart webapi-prod      # bounce one without touching the other
sudo systemctl stop    webapi-prod      # take prod down; dev keeps serving
```

### (Optional, later) Lock down the EC2 origin

Once prod is healthy, tighten the EC2 security group so port 443 only accepts
Cloudflare's IP ranges (https://www.cloudflare.com/ips/). This means
`t1classifieds.com` is reachable only via Cloudflare — and your raw EC2 IP isn't.
`rorhoff.com` can stay open if you want the unproxied path.
