# MotherWyrm

Ten-player couch brawler — TV runs the game in the browser, phones are controllers.

## In this repo

| Path | Role |
|------|------|
| `motherwyrm/tv/` | Phaser 3 TV client (Vite + TypeScript) |
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

## Game design

See the full design notes in the original README (three win conditions: mother kills, wyrm race, gem hoard).
