# In the Wild

Event-based dating app for [rorhoff.com/in-the-wild/](https://rorhoff.com/in-the-wild/).

**Product spec:** [`docs/in-the-wild/SPEC.md`](../docs/in-the-wild/SPEC.md)

## Dev

```bash
cd in-the-wild-app
npm ci
npm run dev
```

## Build

```bash
npm run build -- --base="/in-the-wild/"
```

Output goes to `dist/`; deploy copies to `static/in-the-wild/` via `deploy/commit.sh`.

## API

`/api/in-the-wild/*` — see spec for full schema.
