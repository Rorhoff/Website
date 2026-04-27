"""Secret Space Society — WebSocket game backend."""
from __future__ import annotations

import asyncio
import random
import string
import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(prefix="/api/sss", tags=["sss"])

# ── Race definitions ──────────────────────────────────────────────────────────

RACES = {
    "vorrkai":        {"name": "Vorrkai",        "color": "#e74c3c"},
    "nexari":         {"name": "Nexari",          "color": "#3498db"},
    "luminae":        {"name": "Luminae",         "color": "#ff69b4"},
    "thornveld":      {"name": "Thornveld",       "color": "#27ae60"},
    "obsidian_pact":  {"name": "Obsidian Pact",   "color": "#9b59b6"},
    "dust_runners":   {"name": "Dust Runners",    "color": "#8B4513"},
}

PIECE_SET = {
    "death": 1, "super_ship": 3, "cruise_ship": 6,
    "frigate": 9, "outpost": 3, "battle_station": 4,
    "empire_flag": 6, "unrest": 1,
}

NEUTRAL_PIECES = {
    "guardian": 1, "moon_shark": 2, "pirate": 7, "pirate_base": 1,
}

# ── Board geometry ────────────────────────────────────────────────────────────

import math

R = 24  # circumradius px, flat-top hexagons

# Flat-top hex neighbors sit at 30°, 90°, 150°, 210°, 270°, 330°, distance R√3.
_ND = R * math.sqrt(3)  # neighbor distance ≈ 41.57
_hex_offsets = [(0, 0)]
for _i in range(6):
    _a = math.pi / 6 + math.pi / 3 * _i   # start at 30°
    _hex_offsets.append((round(_ND * math.cos(_a), 2), round(_ND * math.sin(_a), 2)))

# 9 clusters in a true diamond (1-2-3-2-1) using staggered rows.
# Each row is offset by DX/2; DY is the vertical row spacing.
_CX, _CY = 415, 380
_DX = 166   # horizontal cluster-to-cluster distance (same row)
_DY = 120   # vertical cluster-to-cluster distance (adjacent rows)

# Layout (SVG y increases downward):
#          N  (018)
#       NW   NE  (011, 015)
#     W   CTR   E  (002, 001, 003)
#       SW   SE  (009, 007)
#          S  (013)
_CLUSTER_POSITIONS = [
    (_CX,           _CY - 2*_DY),   # 0  N  — yellow  (018)
    (_CX - _DX//2,  _CY - _DY),     # 1  NW — blue    (011)
    (_CX + _DX//2,  _CY - _DY),     # 2  NE — red     (015)
    (_CX - _DX,     _CY),           # 3  W  — white   (002)
    (_CX,           _CY),           # 4  CTR— black hole (001)
    (_CX + _DX,     _CY),           # 5  E  — blue    (003)
    (_CX - _DX//2,  _CY + _DY),     # 6  SW — white   (009)
    (_CX + _DX//2,  _CY + _DY),     # 7  SE — green   (007)
    (_CX,           _CY + 2*_DY),   # 8  S  — red     (013)
]

# Center hex types  [N, NW, NE, W, CTR, E, SW, SE, S]
_CENTER_COLORS = ["yellow", "blue", "red", "white", "black_hole", "blue", "white", "green", "red"]

# Human-readable cluster labels sent to the client
CLUSTER_LABELS = ["018", "011", "015", "002", "001", "003", "009", "007", "013"]


_TRI_TYPES = {"red", "blue", "yellow"}


def _build_board() -> list[dict]:
    hexes = []
    hex_id = 0
    for cluster_idx, (cx, cy) in enumerate(_CLUSTER_POSITIONS):
        center_color = _CENTER_COLORS[cluster_idx]
        label = CLUSTER_LABELS[cluster_idx]
        # Pick one random surrounding hex (local 1-6) to host the system triangles.
        # Use -1 as sentinel so local_idx == tri_local is never true for the center hex (local 0).
        tri_local = random.randint(1, 6) if center_color in _TRI_TYPES else -1
        for local_idx, (ox, oy) in enumerate(_hex_offsets):
            hexes.append({
                "id": hex_id,
                "cluster": cluster_idx,
                "local": local_idx,
                "label": label if local_idx == 0 else "",
                "tri": local_idx == tri_local,
                "tri_color": center_color if local_idx == tri_local else "",
                "x": round(cx + ox, 1),
                "y": round(cy + oy, 1),
                "type": center_color if local_idx == 0 else "space",
                "pieces": [],
            })
            hex_id += 1
    return hexes


# ── Game state ────────────────────────────────────────────────────────────────

@dataclass
class Player:
    ws: WebSocket
    name: str
    role: str        # "host" | "player" | "watcher"
    race: str | None = None
    pieces: dict = field(default_factory=dict)


@dataclass
class Game:
    code: str
    host_name: str
    phase: str = "lobby"   # lobby | race_pick | board | ended
    players: dict[str, Player] = field(default_factory=dict)  # name → Player
    watchers: list[Player] = field(default_factory=list)
    races_taken: dict[str, str] = field(default_factory=dict)  # race_id → player_name
    board: list[dict] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)

    def public_state(self) -> dict:
        return {
            "code": self.code,
            "phase": self.phase,
            "host": self.host_name,
            "players": [
                {
                    "name": n,
                    "role": p.role,
                    "race": p.race,
                    "color": RACES[p.race]["color"] if p.race else None,
                    "race_name": RACES[p.race]["name"] if p.race else None,
                }
                for n, p in self.players.items()
            ],
            "watcher_count": len(self.watchers),
            "races_taken": self.races_taken,
            "races": {k: v for k, v in RACES.items()},
        }

    async def broadcast(self, msg: dict, exclude: WebSocket | None = None) -> None:
        targets = list(self.players.values()) + self.watchers
        await asyncio.gather(
            *(p.ws.send_json(msg) for p in targets if p.ws is not exclude),
            return_exceptions=True,
        )

    async def send_to(self, name: str, msg: dict) -> None:
        p = self.players.get(name)
        if p:
            try:
                await p.ws.send_json(msg)
            except Exception:
                pass


# ── In-memory store ───────────────────────────────────────────────────────────

_games: dict[str, Game] = {}


def _new_code() -> str:
    for _ in range(100):
        code = "".join(random.choices(string.ascii_uppercase, k=4))
        if code not in _games:
            return code
    raise RuntimeError("Could not generate unique code")


# ── WebSocket endpoint ────────────────────────────────────────────────────────

@router.websocket("/ws/{game_code}")
async def sss_ws(ws: WebSocket, game_code: str):
    await ws.accept()
    game: Game | None = None
    player: Player | None = None

    try:
        async for raw in ws.iter_json():
            kind = raw.get("type")

            # ── host ──────────────────────────────────────────────────────────
            if kind == "host":
                name = (raw.get("name") or "").strip()[:32]
                if not name:
                    await ws.send_json({"type": "error", "msg": "Name required"})
                    continue
                code = _new_code()
                game = Game(code=code, host_name=name)
                _games[code] = game
                player = Player(ws=ws, name=name, role="host")
                game.players[name] = player
                await ws.send_json({"type": "joined", "code": code, "name": name, "role": "host"})
                await ws.send_json({"type": "game_state", **game.public_state()})

            # ── join ──────────────────────────────────────────────────────────
            elif kind == "join":
                name = (raw.get("name") or "").strip()[:32]
                code = (raw.get("code") or "").strip().upper()
                if not name or not code:
                    await ws.send_json({"type": "error", "msg": "Name and code required"})
                    continue
                g = _games.get(code)
                if not g:
                    await ws.send_json({"type": "error", "msg": "Game not found"})
                    continue
                if g.phase != "lobby":
                    await ws.send_json({"type": "error", "msg": "Game already started"})
                    continue
                if len(g.players) >= 4:
                    await ws.send_json({"type": "error", "msg": "Game is full (max 4)"})
                    continue
                if name in g.players:
                    await ws.send_json({"type": "error", "msg": "Name taken"})
                    continue
                game = g
                player = Player(ws=ws, name=name, role="player")
                game.players[name] = player
                await ws.send_json({"type": "joined", "code": code, "name": name, "role": "player"})
                await game.broadcast({"type": "game_state", **game.public_state()})

            # ── watch ─────────────────────────────────────────────────────────
            elif kind == "watch":
                code = (raw.get("code") or "").strip().upper()
                g = _games.get(code)
                if not g:
                    await ws.send_json({"type": "error", "msg": "Game not found"})
                    continue
                game = g
                player = Player(ws=ws, name="", role="watcher")
                game.watchers.append(player)
                await ws.send_json({"type": "joined", "code": code, "name": "", "role": "watcher"})
                state = game.public_state()
                if game.phase == "board":
                    state["board"] = game.board
                await ws.send_json({"type": "game_state", **state})

            # ── start_game ────────────────────────────────────────────────────
            elif kind == "start_game":
                if not game or not player:
                    continue
                if player.role != "host":
                    await ws.send_json({"type": "error", "msg": "Only host can start"})
                    continue
                if game.phase != "lobby":
                    continue
                if len(game.players) < 1:
                    await ws.send_json({"type": "error", "msg": "Need at least 1 player"})
                    continue
                game.phase = "race_pick"
                await game.broadcast({"type": "game_state", **game.public_state()})

            # ── pick_race ─────────────────────────────────────────────────────
            elif kind == "pick_race":
                if not game or not player:
                    continue
                if game.phase != "race_pick":
                    continue
                race_id = raw.get("race")
                if race_id not in RACES:
                    await ws.send_json({"type": "error", "msg": "Unknown race"})
                    continue
                # Free previously held race
                old = player.race
                if old and game.races_taken.get(old) == player.name:
                    del game.races_taken[old]
                # Try to claim new race
                if race_id in game.races_taken:
                    await ws.send_json({"type": "race_taken", "race": race_id})
                    continue
                game.races_taken[race_id] = player.name
                player.race = race_id
                await game.broadcast({"type": "game_state", **game.public_state()})

            # ── confirm_race ──────────────────────────────────────────────────
            elif kind == "confirm_race":
                if not game or not player:
                    continue
                if game.phase != "race_pick":
                    continue
                if player.role == "host":
                    # All players must have a race
                    unready = [n for n, p in game.players.items() if p.race is None]
                    if unready:
                        await ws.send_json({"type": "error", "msg": f"Waiting for: {', '.join(unready)}"})
                        continue
                    # Assign pieces
                    for p in game.players.values():
                        p.pieces = dict(PIECE_SET)
                    # Build board
                    game.board = _build_board()
                    # Place pirate base next to black hole (cluster 4, hex index 0)
                    # Black hole hex id = 4*7 = 28; neighbour local index 1 = hex 29
                    game.board[29]["pieces"].append({"type": "pirate_base", "owner": "neutral"})
                    game.phase = "board"
                    state = game.public_state()
                    state["board"] = game.board
                    await game.broadcast({"type": "board_ready", **state})

            # ── ping ──────────────────────────────────────────────────────────
            elif kind == "ping":
                await ws.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if game and player:
            if player.role == "watcher":
                try:
                    game.watchers.remove(player)
                except ValueError:
                    pass
            else:
                game.players.pop(player.name, None)
                if game.players:
                    # Promote oldest remaining player to host if needed
                    if not any(p.role == "host" for p in game.players.values()):
                        next_p = next(iter(game.players.values()))
                        next_p.role = "host"
                        game.host_name = next_p.name
                    await game.broadcast(
                        {"type": "player_disconnected", "name": player.name, **game.public_state()}
                    )
                else:
                    _games.pop(game.code, None)
