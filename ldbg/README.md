# LDBG — Landscape Design Board Generator

Next.js app for turning annotated drone orthophotos into client-ready landscape design boards.

See [`../SPEC.md`](../SPEC.md) and [`../SPEC-A-webodm.md`](../SPEC-A-webodm.md) for the full build spec. Addendum A wins on conflict.

## WebODM ingest (Addendum A1)

- Create a project from a WebODM export folder (browser folder pick or server path)
- Python sidecar (`scripts/parse_geotiff.py`) extracts CRS, affine, GSD, bounds via rasterio
- Generates `ortho-preview.jpg` for UI; full GeoTIFF stored under `webodm/`
- Georeferenced scale replaces manual calibration for WebODM projects

```bash
pip install -r scripts/requirements-geo.txt
```

## Dev

```bash
cd ldbg
cp .env.local.example .env.local   # add ANTHROPIC_API_KEY when Milestone 2 is built
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Storage

Projects live in `./storage/{uuid}/`:

- `project.json` — metadata, calibration, image refs
- `annotated.jpg` / `clean.jpg` — source images

## Samples

Drop test orthophotos in `./samples/` for Milestone 2+ scripts.
