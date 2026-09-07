# MotherWyrm Map Builder

Browser-based arena editor for MotherWyrm. Produces JSON map files — it does **not** modify game source.

**URL:** `/mw/mapbuilder/` (static files in `static/mw/mapbuilder/`)

## Develop

```bash
cd motherwyrm/mapbuilder
npm install
npm run dev
npm test
npm run build   # → static/mw/mapbuilder/
```

## Map JSON schema

See `src/types.ts`. Fields mirror `arena-layout.ts`:

| Field | Game equivalent |
|-------|-----------------|
| `platforms[]` | `PLATFORMS` tuples + optional `skin` / `palette` |
| `gemSeams[]` | `GEM_SPAWNS` |
| `hoardSlots` | `HOARD_X` / `HOARD_Y` anchor per team |
| `wyrmPath` | `TUNING.wyrmWin` + `cowGroundY` |

## Symmetry

Mirror-lock is **on by default**. Left-half edits auto-update right-half pairs. Export validates mirrored geometry and warns on mismatch.

## Platform skins

Tile art uses indexed palette marker colors (see `src/palette.ts`):

| Slot | Marker color |
|------|----------------|
| base | `#ff006e` |
| shadow | `#8338ec` |
| highlight | `#3a86ff` |
| trim | `#ffbe0b` |

The editor recolors these client-side. **Prerequisite:** the game's `Game.ts` `buildPlatforms()` still draws plain rectangles and does not load map JSON or apply palette swaps — that renderer work is separate.

## Workflow

1. New map or **Load default arena** (current shipped geometry).
2. Edit on canvas; export JSON.
3. Game integration (future): load JSON at runtime instead of hard-coded `PLATFORMS`.
