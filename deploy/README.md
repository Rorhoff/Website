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
`create_all()` is idempotent and **only creates missing tables** — adding new tables on a
deploy (e.g. `classified_ad_report`, `classified_blocked_signature`) is automatic on
service restart, but altering existing columns still requires a manual `ALTER TABLE`.

### Column migrations (run before / right after deploying the matching tag)

Run these once against **each** classifieds database (dev `RoryPorfolioDB` and
prod `Classifieds_Prod`). They're idempotent thanks to `IF NOT EXISTS` and
narrow `WHERE` clauses.

#### prod-v1.13 (city dropdown + display name required)

There's a script that runs the migration against both databases in one
shot — preferred over copy/pasting SQL into `psql`:

```bash
# One-time install on EC2:
cd /home/ubuntu/Website && git pull
cp deploy/migrate-prod-v1.13.sh ~/migrate-prod-v1.13.sh
chmod +x ~/migrate-prod-v1.13.sh

# Run it (PGPASSWORD lets you skip the interactive prompt):
PGPASSWORD='your-real-password' ~/migrate-prod-v1.13.sh
```

The script wraps both statements in a transaction per database and uses
`ON_ERROR_STOP=1` so a failure on one DB halts the script before touching
the other. Re-running is safe (`ADD COLUMN IF NOT EXISTS` + narrow `WHERE`).

If you'd rather run the SQL by hand, this is what the script does:

```sql
-- prod-v1.12: seller-chosen display name shown in the ad detail modal.
ALTER TABLE classified_ad ADD COLUMN IF NOT EXISTS contact_name VARCHAR(120);

-- prod-v1.13: city picked at ad-creation time; powers per-ad SEO.
ALTER TABLE classified_ad ADD COLUMN IF NOT EXISTS city VARCHAR(120);

-- prod-v1.13 backfill: legacy ads created before the display-name field
-- existed have contact_name = NULL. The application no longer falls back
-- to the login username at render time, so we set contact_name to the
-- author's username once as a one-time backfill. New ads will always
-- provide their own non-empty contact_name via the API.
UPDATE classified_ad
   SET contact_name = author_username
 WHERE contact_name IS NULL OR contact_name = '';
```

#### prod-v1.16 (Gold pro-rata refunds when auto-removed)

Run **before** deploying code that calls `Refund.create` — the new columns hold
the Stripe payment snapshot from the fulfilled Checkout webhook.

```bash
# One-time install on EC2:
cd /home/ubuntu/Website && git pull
cp deploy/migrate-prod-v1.16.sh ~/migrate-prod-v1.16.sh
chmod +x ~/migrate-prod-v1.16.sh

PGPASSWORD='your-real-password' ~/migrate-prod-v1.16.sh
```

Or run the SQL by hand:

```sql
ALTER TABLE classified_ad ADD COLUMN IF NOT EXISTS last_gold_payment_intent_id VARCHAR(255);
ALTER TABLE classified_ad ADD COLUMN IF NOT EXISTS last_gold_payment_cents INTEGER;
ALTER TABLE classified_ad ADD COLUMN IF NOT EXISTS last_gold_window_start TIMESTAMP WITHOUT TIME ZONE;
ALTER TABLE classified_ad ADD COLUMN IF NOT EXISTS last_gold_window_end TIMESTAMP WITHOUT TIME ZONE;
```

No backfill needed: ads boosted before prod-v1.16 simply won't auto-refund
programmatically (documented publicly on `/classifieds/gold-policy.html`).

#### prod-v1.22 (aggregator import columns)

Run **before** deploying code that reads `listing_source` / `source_*` on `classified_ad`.

```bash
cd /home/ubuntu/Website && git pull
cp deploy/migrate-prod-v1.22.sh ~/migrate-prod-v1.22.sh
chmod +x ~/migrate-prod-v1.22.sh
PGPASSWORD='your-real-password' ~/migrate-prod-v1.22.sh
```

#### Messaging MVP (prod-v1.33 migration + prod-v1.34 app)

Run migration before deploy:

```bash
PGPASSWORD='your-real-password' ~/migrate-prod-v1.33.sh
```

If the unique email index fails on duplicates, pull the latest script (it auto-suffixes
duplicate rows as `email.legacy.<id>` keeping `rorhoff` when present). Inspect first:

```sql
SELECT id, username, email FROM classified_user
WHERE LOWER(email) IN (
  SELECT LOWER(email) FROM classified_user GROUP BY LOWER(email) HAVING COUNT(*) > 1
);
```

Grant admin (adjust usernames):

```sql
UPDATE classified_user SET is_admin = TRUE WHERE username IN ('rorhoff', 'qa_admin');
UPDATE classified_user SET is_verified = TRUE WHERE username = 'rorhoff';
```

Env (prod `website-prod/.env.prod`, dev `.env.dev`):

```bash
# On EC2 (backs up .env.prod, sets vars, restarts webapi-prod):
cd ~/website-prod && git pull
bash deploy/set-messaging-env-prod.sh              # live SES
bash deploy/set-messaging-env-prod.sh --dev-log-only   # test: log emails only
```

Manual equivalents: `CLASSIFIEDS_PUBLIC_URL`, `AWS_SES_REGION=us-west-1`,
`CLASSIFIEDS_EMAIL_FROM=noreply@t1classifieds.com`, `MAGIC_LINK_TTL_HOURS=24`,
`EMAIL_DEV_LOG_ONLY=0` (prod) or `1` (dev test).

Verify SES domain + `noreply@t1classifieds.com` before running without `--dev-log-only`.

#### Craigslist imports (disabled by default)

Remove all imported Craigslist ads from the database:

```bash
cd /home/ubuntu/website-prod
ENV_FILE=/home/ubuntu/website-prod/.env.prod .venv/bin/python -m tools.purge_craigslist_classifieds
```

Remove any `craigslist-import` cron line from crontab so listings are not re-added.

To re-enable imports (optional): set `CRAIGSLIST_IMPORT_ENABLED=1`, then run
`python -m tools.sync_craigslist_classifieds` (10 per state; see `tools/craigslist_sites.py`).

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

---

## referr-all.com — a third (Referr-All) prod service

This mirrors the t1classifieds prod model exactly, for Referr-All. It adds a third
service on the same box; `rorhoff.com/referr-all/` keeps running as dev/staging.

```
                        ┌─────────────────────────────┐
   referr-all.com ─────►│  nginx (referr-all.conf)    │──► 127.0.0.1:8002  webapi-referrall
   (proxied via         │                             │                    SERVICE_MODE=referrall
    Cloudflare)         └─────────────────────────────┘                    DB=ReferrAll_Prod
                                                                            cwd=/home/ubuntu/website-referrall (pinned to a referrall-v* tag)
```

- **Tag scheme:** `referrall-vMAJOR.MINOR` (annotated tags only).
- **Service mode:** `SERVICE_MODE=referrall` makes the app mount only the Referr-All
  router and serve the SPA at `/` (built with Vite base `/`). On referr-all.com the API
  client's `/api/referr-all` calls resolve to `https://referr-all.com/api/referr-all`.
- **Data:** a dedicated, initially empty `ReferrAll_Prod` database — separate from the dev
  `RoryPortfolio` DB, so prod users/posts are isolated from staging.

### One-time setup

1. **DNS:** add `referr-all.com` to Cloudflare, proxied (orange cloud), pointing at the EC2 IP.

2. **TLS (Cloudflare Origin cert):** Cloudflare → referr-all.com → SSL/TLS → Origin Server →
   Create Certificate (hostnames `referr-all.com, *.referr-all.com`, RSA, 15 years). Then on EC2:

   ```bash
   sudo mkdir -p /etc/ssl/cloudflare
   sudo nano /etc/ssl/cloudflare/referr-all.com.pem   # paste the certificate body
   sudo nano /etc/ssl/cloudflare/referr-all.com.key   # paste the private key
   sudo chmod 600 /etc/ssl/cloudflare/referr-all.com.key
   ```

   Set the Cloudflare SSL/TLS mode to **Full (strict)**.

3. **Create the prod database** on the existing RDS instance:

   ```bash
   psql "postgresql://dbadmin:PASS@roryporfolio.cl0oawym20pw.us-west-1.rds.amazonaws.com:5432/RoryPortfolio"
   ```
   ```sql
   CREATE DATABASE "ReferrAll_Prod";
   ```

   Tables are auto-created on first uvicorn start (`Base.metadata.create_all`). A fresh DB
   needs **no** migration scripts — it's created with all current columns.

4. **Prod checkout + venv:**

   ```bash
   git clone https://github.com/Rorhoff/Website.git /home/ubuntu/website-referrall
   cd /home/ubuntu/website-referrall
   python3 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   ```

5. **Env file:** copy the template and fill it in (DB URL, Cloudflare email token/account,
   live Stripe, etc.):

   ```bash
   cp deploy/.env.referrall.example /home/ubuntu/website-referrall/.env.referrall
   nano /home/ubuntu/website-referrall/.env.referrall
   chmod 600 /home/ubuntu/website-referrall/.env.referrall
   ```

6. **systemd service:**

   ```bash
   sudo cp deploy/webapi-referrall.service /etc/systemd/system/webapi-referrall.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now webapi-referrall
   ```

7. **nginx vhost:**

   ```bash
   sudo cp deploy/nginx-referr-all.conf /etc/nginx/sites-available/referr-all.conf
   sudo ln -s /etc/nginx/sites-available/referr-all.conf /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

8. **Deploy script:**

   ```bash
   cp deploy/commitreferrall.sh ~/commitreferrall.sh
   chmod +x ~/commitreferrall.sh
   ```

### Promoting test → referr-all.com (release)

```bash
# Local: tag the commit you want live and push the tag.
git checkout main && git pull
git tag -a referrall-v1.0 -m "First referr-all.com release"
git push origin referrall-v1.0

# On EC2: the only step that moves referr-all.com.
~/commitreferrall.sh referrall-v1.0
```

The script checks out the tag in `/home/ubuntu/website-referrall`, rebuilds the SPA with
base `/`, runs `pip install` only when `requirements.txt` changed, restarts
`webapi-referrall`, and probes `127.0.0.1:8002/which-app`.

### Rollback / list tags / restart

```bash
~/commitreferrall.sh                  # show recent referrall-v* tags + usage
~/commitreferrall.sh referrall-v0.9   # roll back to an older tag
sudo systemctl restart webapi-referrall
```

### Verify isolation

```bash
curl -s https://referr-all.com/which-app   # SERVICE_MODE=referrall, ENV_FILE=...referrall
curl -s https://rorhoff.com/which-app      # SERVICE_MODE=full (dev untouched)
```
