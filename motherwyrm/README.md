# MotherWyrm

Ten-player couch brawler — TV runs the game in the browser, phones are controllers.

## In this repo

| Path | Role |
|------|------|
| `motherwyrm/tv/` | Phaser 3 TV client (Vite + TypeScript) |
| `motherwyrm/art/` | Aseprite sources, export scripts, built sheets |
| `static/mw/` | Built TV client + phone controller (`pad/`) |
| `motherwyrm_routes.py` | FastAPI WebSocket relay at `/api/mw/ws` |

## URLs (portfolio deploy)

- **TV:** `/mw/`
- **Phone controller:** `/mw/pad/` (deep link `/mw/pad/c/ABCD`)

## Dev

```bash
# Terminal 1 — site + relay
uvicorn main:app --reload

# Terminal 2 — TV client (optional; or use built static/mw)
cd motherwyrm/tv && npm run dev
```

Rebuild TV after source changes:

```bash
cd motherwyrm/tv && npm run build
```

## Carry rules

- **Whelps** carry **one** gem at a time (`TUNING.carryMax = 1`).
- The **mother wyrm** carries **zero** gems — she cannot pick up, throw, or deposit.
- A **punt** knocks **one** gem loose from a carrying enemy (not an armful).
- Mother **stun** still drops whatever the whelp is carrying (at most one).

## Art pipeline

Hand-drawn pixel art lives in `art/src/` (`.aseprite` working files). Export is a **manual local step** — Aseprite is not on CI.

```bash
cd motherwyrm/tv
npm run art        # export sheets → art/build/ → tv/public/assets/
npm run art:check  # validate sources only (baseline, tags, alpha, palette)
```

Set `ASEPRITE_BIN` if the binary is not on PATH.

**Rules:**

- One sheet per character source file (never pack multiple sources — tag ranges collide in JSON).
- No `--trim` or `--scale` on export; sprites render at `setScale(2)` with `pixelArt: true`.
- Tag names are prefixed on export (`whelp_blue_run`) so blue/red atlases do not clobber global Phaser anims.
- Procedural sprites in `arena.ts` remain as permanent fallbacks — a partial art set still produces a playable game.

After export, commit `art/build/` and `tv/public/assets/`, then `npm run build`.

## QA / debug views

| URL query | Purpose |
|-----------|---------|
| `?debug=assets` | Atlas load status + expected vs found tags |
| `?debug=anims` | Every animation at 2× with labels |
| `?debug=collision` | Collision overlay on background; **E** exports PNG for the artist |

In-game: **F3** toggles collision overlay during a match.

```bash
cd motherwyrm/tv && npm test          # unit tests incl. arena symmetry + carry rules
bash ../../scripts/run-feature-qa.sh  # full MotherWyrm + LDBG QA
```

## Game design

Three win conditions: **mother kills** (4 deaths), **wyrm race** (pull the bone worm to your side), **gem hoard** (fill all 15 slots).

- TV is simulation authority; phones send input only.
- `arena.ts` owns all collision geometry — art is decorative, never authoritative.
- All tuning numbers live in `TUNING`; do not scatter magic numbers into asset code.
