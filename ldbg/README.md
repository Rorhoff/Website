# LDBG — Landscape Design Board Generator

Next.js app for turning annotated drone orthophotos into client-ready landscape design boards.

See [`../SPEC.md`](../SPEC.md) for the full build spec and milestone order.

## Milestone 1 (current)

- Project scaffold + local `storage/` persistence
- Upload annotated + clean orthophotos
- Scale calibration (two-point + real-world distance)
- North arrow rotation
- Project metadata form
- Legend config + editor

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
