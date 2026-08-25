# LDBG — Landscape Design Board Generator

Next.js app for turning annotated drone orthophotos into client-ready landscape design boards.

See [`../SPEC.md`](../SPEC.md) and [`../SPEC-A-webodm.md`](../SPEC-A-webodm.md) for the full build spec. Addendum A wins on conflict. Authoritative build order: **SPEC §13** (from Addendum A9).

## Build status (WebODM path)

| Step | Milestone | Status |
|------|-----------|--------|
| 1 | WebODM ingest, GeoTIFF parse, tile pyramid | Done (A1, A8) |
| 2 | Annotation base export / re-upload | Done (A3) |
| 3 | `/api/interpret` → projected coordinates | Done (A4) |
| 4 | Polygon editor in projected space | Done (A4) |
| 5 | Scale verification gate + banner | Done (A2) |
| 6 | SVG plan renderer | Done |
| 7 | DTM, slope, cut/fill | Done (A5) |
| 8 | `/api/design-content` + elevation facts | Done (A5) |
| 9 | Board template + PDF/PNG export | Done |
| 10 | DXF, GeoJSON, KML, stakeout CSV | Done (A7) |
| 11 | Blender render pipeline | Done (A6) |
| 12 | Image-to-image finish (`LDBG_RENDER_IMG2IMG`) | Done behind flag (A6) |

Steps 1–6 are the core product; 7+ are upside.

## WebODM ingest (A1)

- Create a project from a WebODM export folder (browser folder pick or server path)
- Python sidecar (`scripts/parse_geotiff.py`) extracts CRS, affine, GSD, bounds via rasterio
- Generates `ortho-preview.jpg` for UI; full GeoTIFF stored under `webodm/`
- On ingest: tile pyramid (`scripts/generate_tile_pyramid.py`), DTM cache when `dtm.tif` present
- Georeferenced scale replaces manual calibration for WebODM projects

## Performance (A8)

- Editor loads **tiles**, not the full ortho (`GET /api/projects/[id]/tiles/...`)
- Claude vision capped at **1568px** long edge
- Board export uses **print-ortho.jpg** (up to 12k long edge) generated on demand
- DTM sampled from cached grid built at ingest

## Dev

```bash
cd ldbg
cp .env.local.example .env.local
npm install
pip install -r scripts/requirements-geo.txt
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) (or port/base path from deploy config).

### Optional env

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Interpret + design content — **same key as AIRevolution** in `/home/ubuntu/Website/.env.dev` (loaded by `ldbg.service` + `anthropic-env.ts`) |
| `LDBG_PYTHON` | Path to venv Python with rasterio |
| `LDBG_BLENDER` | Headless Blender for A6 renders |
| `LDBG_RENDERS_ENABLED` | Enable AI render providers |
| `LDBG_RENDER_IMG2IMG` | Gemini img2img from Blender base |

## Storage

Projects live in `./storage/{uuid}/`:

- `project.json` — metadata, georef, features, settings
- `ortho-preview.jpg` — UI preview (~4k long edge)
- `webodm/` — ingested WebODM files including full GeoTIFF
- `tiles/orthophoto/` — XYZ tile pyramid
- `print-ortho.jpg` — high-res ortho for board export (generated)
- `dtm-cache.json` — cached elevation grid

Legacy upload projects use `annotated.jpg` / `clean.jpg` at project root.

## Upload size limits (200 MB ceiling)

When a user hits **HTTP 413**, check every layer below — the smallest active limit wins.

| Layer | Where | Limit | Notes |
|-------|--------|-------|--------|
| **Browser preflight** | `src/lib/upload-limits.ts` (`UPLOAD_MAX_BYTES`) | **200 MB** | Client rejects oversize files before upload; orthophoto + WebODM forms show progress + cancel. |
| **nginx** | `deploy/nginx-rorhoff.conf` → `/etc/nginx/sites-available/rorhoff.conf` | **200 MB** on `location /ldbg` only; **12 MB** elsewhere on the vhost | Also `client_body_timeout 300s`, `proxy_read_timeout 300s`, `proxy_send_timeout 300s` on `/ldbg`. |
| **FastAPI proxy** | `ldbg_proxy.py` | No separate body cap | Streams full body to Next.js; `httpx` timeout **300 s**. nginx must allow 200M first or you get 413 from nginx (HTML, not JSON). |
| **Next.js Route Handlers** | `POST …/upload`, `upload-annotated`, `render-upload`, `ingest-webodm` | **200 MB** enforced in code via `upload-limits.ts` | Uploads use **`req.formData()` Route Handlers**, not Server Actions. `maxDuration = 300` on large routes. |
| **Next.js Server Actions** | `next.config.ts` → `experimental.serverActions.bodySizeLimit` | **200 MB** | Only applies if a Server Action is added later; current upload UI does not use Server Actions. |
| **Next.js middleware** | `next.config.ts` → `experimental.middlewareClientMaxBodySize` | **200 MB** | No `middleware.ts` in this app today; reserved if middleware is added. |
| **CDN / load balancer** | Production (rorhoff.com) | **None in front of nginx** | Traffic is HTTPS → nginx on EC2. If Cloudflare or another CDN is added later, set its upload limit here too. |

**Canonical constant:** keep `UPLOAD_MAX_BYTES` in `src/lib/upload-limits.ts` aligned with nginx `client_max_body_size` and this table.

**Deploy nginx manually on EC2** (also copied by `~/commit.sh` when the file differs):

```bash
sudo cp ~/Website/deploy/nginx-rorhoff.conf /etc/nginx/sites-available/rorhoff.conf
sudo nginx -t
sudo systemctl reload nginx
```

## Samples

Drop test orthophotos or a WebODM export folder under `./samples/` for local iteration.
