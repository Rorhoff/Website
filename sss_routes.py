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
    "nexari":         {"name": "Nexari",          "color": "#1a5fa8"},
    "luminae":        {"name": "Luminae",         "color": "#ff69b4"},
    "thornveld":      {"name": "Thornveld",       "color": "#27ae60"},
    "obsidian_pact":  {"name": "Obsidian Pact",   "color": "#9b59b6"},
    "dust_runners":   {"name": "Dust Runners",    "color": "#8B4513"},
}

PIECE_SET = {
    "death": 1, "super_ship": 3, "cruise_ship": 6,
    "frigate": 9, "outpost": 3, "battle_station": 4,
    "empire_flag": 6, "influence_token": 3, "unrest": 1,
}

# Pieces each player places at game start (empire_flag is auto-placed on core)
START_PIECES = ["battle_station", "frigate", "frigate", "influence_token"]

NEUTRAL_PIECES = {
    "guardian": 1, "moon_shark": 2, "pirate": 7, "pirate_base": 1,
}


EMPIRE_CARDS = {
    "vorrkai":       {"id": "empire_vorrkai",       "name": "War Directive",      "effect": "In combat, add +1 to all your attack rolls this round."},
    "nexari":        {"id": "empire_nexari",         "name": "Data Network",       "effect": "Draw 1 additional tech card when performing Research."},
    "luminae":       {"id": "empire_luminae",        "name": "Radiant Presence",   "effect": "Spend 1 science to prevent 1 combat hit against your ships."},
    "thornveld":     {"id": "empire_thornveld",      "name": "Overgrowth Protocol","effect": "Gain +2 food when performing the Growth action."},
    "obsidian_pact": {"id": "empire_obsidian_pact",  "name": "Pact of Dominion",   "effect": "Once per round, force one opponent to discard 1 card of your choice."},
    "dust_runners":  {"id": "empire_dust_runners",   "name": "Salvage Rights",     "effect": "After Exploration, gain 1 money for each unowned system scouted."},
}

TECH_CARDS = [
    {
        "id": "fungal_farms",
        "name": "Fungal Farms",
        "timing": "Your Turn",
        "effect": "Spend 1 money to perform a +1 person. This increases resource production by 1.",
    },
    {
        "id": "titanium_armor",
        "name": "Titanium Armor",
        "timing": "After Combat Roll",
        "effect": "Re-roll up to 1 enemy die. You can only have one developed armor tech.",
    },
    {
        "id": "nuclear_missile",
        "name": "Nuclear Missile",
        "timing": "Combat",
        "effect": "+1 additional dice roll for combat.",
    },
    {
        "id": "biotechnology",
        "name": "Biotechnology",
        "timing": "Before +1 Person",
        "effect": "Spend 1 money to gain 2 food.",
    },
    {
        "id": "death_spores",
        "name": "Death Spores",
        "timing": "Invasion — Start",
        "effect": "Gain 1 die in the invasion roll and remove 1 person from the defending system.",
    },
    {
        "id": "molecular_manipulation",
        "name": "Molecular Manipulation",
        "timing": "During +Person",
        "effect": "Create a new person in a system you own with a battle station. Costs 1 food less (minimum 1).",
    },
]

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
_CX, _CY = 415, 385
_DX = 148   # horizontal cluster-to-cluster distance (same row)
_DY = 118   # vertical cluster-to-cluster distance (adjacent rows)

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

        # Layout starting at the tri anchor (going clockwise):
        #   offset 0 = tri (space type with marker)
        #   offset 1 = frigate  (immediately clockwise of tri)
        #   offset 2 = fill A   (bs_slot or science, random)
        #   offset 3 = frigate  (directly across from tri — non-adjacent to 1 or 5)
        #   offset 4 = fill B   (the other of bs_slot / science)
        #   offset 5 = frigate  (immediately counter-clockwise of tri — non-adjacent to 3 or 1)
        # Result: 3 frigates at alternating positions (1,3,5), never adjacent to each other.
        # For non-tri systems the same alternating pattern applies; the "tri" slot becomes space.
        fill = ["bs_slot", "science"]
        random.shuffle(fill)

        if center_color in _TRI_TYPES:
            tri_local = random.randint(1, 6)
            start = tri_local
            roles = ["space", "orbital", fill[0], "orbital", fill[1], "orbital"]
        else:
            tri_local = -1
            start = random.randint(1, 6)
            roles = ["space", "orbital", fill[0], "orbital", fill[1], "orbital"]

        for local_idx, (ox, oy) in enumerate(_hex_offsets):
            if local_idx == 0:
                hex_type = center_color
            else:
                rel      = (local_idx - start) % 6
                hex_type = roles[rel]
            hexes.append({
                "id": hex_id,
                "cluster": cluster_idx,
                "local": local_idx,
                "label": label if local_idx == 0 else "",
                "tri": local_idx == tri_local,
                "tri_color": center_color if local_idx == tri_local else "",
                "x": round(cx + ox, 1),
                "y": round(cy + oy, 1),
                "type": hex_type,
                "pieces": [],
                "wormhole": False,
                "wormhole_partner": None,
            })
            hex_id += 1

    # ── Wormholes ─────────────────────────────────────────────────────────────
    # One best non-tri hex pair per adjacent cluster pair (distance < 80 px).
    # Required per cluster: N-1 where N = adjacent cluster count.
    # A system touching 4 neighbours gets 3-4 wormholes, etc.
    by_cluster: dict = {}
    for h in hexes:
        if h["local"] > 0:
            by_cluster.setdefault(h["cluster"], []).append(h)

    best_per_pair: dict = {}  # (ci, cj) -> (ha_id, hb_id, dist)
    nc = len(_CLUSTER_POSITIONS)
    for ci in range(nc):
        for cj in range(ci + 1, nc):
            cxi, cyi = _CLUSTER_POSITIONS[ci]
            cxj, cyj = _CLUSTER_POSITIONS[cj]
            if math.sqrt((cxi - cxj) ** 2 + (cyi - cyj) ** 2) > 165:
                continue
            for hi in by_cluster.get(ci, []):
                if hi["tri"]:
                    continue
                for hj in by_cluster.get(cj, []):
                    if hj["tri"]:
                        continue
                    d = math.sqrt((hi["x"] - hj["x"]) ** 2 + (hi["y"] - hj["y"]) ** 2)
                    if d < 80:
                        key = (ci, cj)
                        if key not in best_per_pair or d < best_per_pair[key][2]:
                            best_per_pair[key] = (hi["id"], hj["id"], d)

    # Build per-cluster adjacency from best candidates (one entry per cluster pair)
    adj: dict = {ci: [] for ci in range(nc)}
    for (ci, cj), (ha_id, hb_id, _) in best_per_pair.items():
        adj[ci].append((cj, ha_id, hb_id))
        adj[cj].append((ci, hb_id, ha_id))

    # Required wormholes: N-1 per cluster (touching 4 neighbours → need 3-4)
    required: dict = {ci: max(0, len(adj[ci]) - 1) for ci in range(nc)}

    # Candidate list — already exactly one per cluster pair
    all_cands: list = [(ci, cj, ha_id, hb_id)
                       for (ci, cj), (ha_id, hb_id, _) in best_per_pair.items()]

    # Greedy: always pick the candidate that satisfies the most unmet need
    wh_counts: dict = {ci: 0 for ci in range(nc)}
    used_hexes: set = set()

    def _need(ci_n: int, cj_n: int) -> int:
        return (max(0, required[ci_n] - wh_counts[ci_n])
                + max(0, required[cj_n] - wh_counts[cj_n]))

    remaining = list(all_cands)
    while remaining:
        remaining = [c for c in remaining if c[2] not in used_hexes and c[3] not in used_hexes]
        if not remaining:
            break
        if all(wh_counts[ci] >= required[ci] for ci in range(nc)):
            break
        best = max(remaining, key=lambda c: _need(c[0], c[1]))
        ci_b, cj_b, ha, hb = best
        hexes[ha]["wormhole"] = True
        hexes[ha]["wormhole_partner"] = hb
        hexes[hb]["wormhole"] = True
        hexes[hb]["wormhole_partner"] = ha
        wh_counts[ci_b] += 1
        wh_counts[cj_b] += 1
        used_hexes.add(ha)
        used_hexes.add(hb)

    # Guarantee every adjacent cluster has at least 1 wormhole.
    # The greedy may leave a cluster at 0 if all its best_per_pair candidates
    # were blocked by used_hexes; this pass forces one using any free hex pair.
    for ci in range(nc):
        if wh_counts[ci] > 0 or not adj[ci]:
            continue
        placed = False
        # Try original best_per_pair candidates first (hexes may now be free)
        for cj, ha, hb in adj[ci]:
            if ha not in used_hexes and hb not in used_hexes:
                hexes[ha]["wormhole"] = True
                hexes[ha]["wormhole_partner"] = hb
                hexes[hb]["wormhole"] = True
                hexes[hb]["wormhole_partner"] = ha
                used_hexes.add(ha)
                used_hexes.add(hb)
                wh_counts[ci] += 1
                wh_counts[cj] += 1
                placed = True
                break
        if placed:
            continue
        # Fall back: scan by_cluster for any non-tri, non-used hex pair
        for cj, _, _ in adj[ci]:
            for hi in by_cluster.get(ci, []):
                if hi["tri"] or hi["id"] in used_hexes:
                    continue
                for hj in by_cluster.get(cj, []):
                    if hj["tri"] or hj["id"] in used_hexes:
                        continue
                    hexes[hi["id"]]["wormhole"] = True
                    hexes[hi["id"]]["wormhole_partner"] = hj["id"]
                    hexes[hj["id"]]["wormhole"] = True
                    hexes[hj["id"]]["wormhole_partner"] = hi["id"]
                    used_hexes.add(hi["id"])
                    used_hexes.add(hj["id"])
                    wh_counts[ci] += 1
                    wh_counts[cj] += 1
                    placed = True
                    break
                if placed:
                    break
            if placed:
                break

    return hexes


def _deal_draft(game) -> None:
    """Deal draft cards to all players and advance phase to 'draft'."""
    game.phase = "draft"
    for p in game.players.values():
        if not p.race:
            continue
        # 3 basic action cards (33%/66% split)
        p.action_cards = []
        for _ in range(3):
            p.action_cards.append("base1" if random.random() < 1 / 3 else "base2")
        # Empire action card
        empire = EMPIRE_CARDS.get(p.race)
        if empire:
            p.action_cards.append(empire["id"])
        # 3 tech cards
        p.tech_cards = []
        for _ in range(3):
            p.tech_cards.append(random.choice(TECH_CARDS)["id"])


# ── Game state ────────────────────────────────────────────────────────────────

@dataclass
class Player:
    ws: WebSocket
    name: str
    role: str        # "host" | "player" | "watcher"
    race: str | None = None
    pieces: dict = field(default_factory=dict)
    dice_roll: int = 0
    resources: dict = field(default_factory=dict)   # food, science, tool, money
    income: dict = field(default_factory=dict)       # per-turn income per resource
    tech: dict = field(default_factory=dict)         # column → [bool×5]
    tech_cards: list = field(default_factory=list)   # list of card ids
    action_cards: list = field(default_factory=list) # list of action card ids


@dataclass
class Game:
    code: str
    host_name: str
    phase: str = "lobby"   # lobby | race_pick | dice_roll | place_pieces | draft | board | ended
    players: dict[str, Player] = field(default_factory=dict)
    watchers: list[Player] = field(default_factory=list)
    races_taken: dict[str, str] = field(default_factory=dict)
    board: list[dict] = field(default_factory=list)
    turn_order: list[str] = field(default_factory=list)
    dice_round: list[str] = field(default_factory=list)
    placement_idx: int = 0
    player_placement: dict = field(default_factory=dict)  # name → remaining pieces list
    player_system: dict = field(default_factory=dict)     # name → cluster_idx
    created_at: float = field(default_factory=time.time)

    def public_state(self) -> dict:
        in_board = self.phase in ("place_pieces", "draft", "board")
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
                    "pieces": dict(p.pieces) if in_board else {},
                    "dice_roll": p.dice_roll,
                    "resources":  dict(p.resources)  if in_board else {},
                    "income":     dict(p.income)     if in_board else {},
                    "tech":       {k: list(v) for k, v in p.tech.items()} if in_board else {},
                    "tech_cards":   list(p.tech_cards)   if in_board else [],
                    "action_cards": list(p.action_cards) if in_board else [],
                }
                for n, p in self.players.items()
            ],
            "watcher_count": len(self.watchers),
            "races_taken": self.races_taken,
            "races": {k: v for k, v in RACES.items()},
            "turn_order": self.turn_order,
            "dice_round": self.dice_round,
            "placement_idx": self.placement_idx,
            "player_placement": {k: list(v) for k, v in self.player_placement.items()},
            "player_system": dict(self.player_system),
            "current_placer": (
                self.turn_order[self.placement_idx]
                if self.phase == "place_pieces" and self.placement_idx < len(self.turn_order)
                else None
            ),
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
                if game.phase in ("place_pieces", "draft", "board"):
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
                    unready = [n for n, p in game.players.items() if p.race is None]
                    if unready:
                        await ws.send_json({"type": "error", "msg": f"Waiting for: {', '.join(unready)}"})
                        continue
                    # Reset dice state and start dice_roll phase
                    for p in game.players.values():
                        p.dice_roll = 0
                    game.turn_order = []
                    game.dice_round = list(game.players.keys())
                    game.phase = "dice_roll"
                    await game.broadcast({"type": "game_state", **game.public_state()})

            # ── roll_dice ─────────────────────────────────────────────────────
            elif kind == "roll_dice":
                if not game or not player:
                    continue
                if game.phase != "dice_roll":
                    continue
                if player.name not in game.dice_round:
                    continue
                if player.dice_roll != 0:
                    continue  # already rolled this round
                roll = random.randint(1, 6) + random.randint(1, 6)
                player.dice_roll = roll
                await game.broadcast({"type": "game_state", **game.public_state()})

                # Check if everyone in this round has rolled
                rolled = {n for n in game.dice_round
                          if game.players[n].dice_roll != 0}
                if rolled < set(game.dice_round):
                    continue  # still waiting

                # Resolve this round
                rolls = {n: game.players[n].dice_roll for n in game.dice_round}
                max_roll = max(rolls.values())
                winners = [n for n, r in rolls.items() if r == max_roll]
                losers  = sorted(
                    [n for n, r in rolls.items() if r != max_roll],
                    key=lambda n: rolls[n], reverse=True
                )

                if len(winners) == 1:
                    # Unique high roll — place winner, then resolve losers by score
                    game.turn_order.append(winners[0])
                    # Group losers by score for cascading tie-breaks
                    from itertools import groupby
                    loser_sorted = sorted(losers, key=lambda n: rolls[n], reverse=True)
                    loser_groups = [list(g) for _, g in groupby(loser_sorted, key=lambda n: rolls[n])]
                    next_tied: list[str] = []
                    for group in loser_groups:
                        if len(group) == 1:
                            game.turn_order.append(group[0])
                        else:
                            next_tied = group
                            break
                    if next_tied:
                        for n in next_tied:
                            game.players[n].dice_roll = 0
                        game.dice_round = next_tied
                        await game.broadcast({"type": "game_state", **game.public_state()})
                        continue
                else:
                    # All winners tie — re-roll among winners; losers resolved cascading
                    loser_sorted = sorted(losers, key=lambda n: rolls[n], reverse=True)
                    from itertools import groupby as _gb
                    loser_groups = [list(g) for _, g in _gb(loser_sorted, key=lambda n: rolls[n])]
                    remaining_losers: list[str] = []
                    tie_groups: list[list[str]] = []
                    for group in loser_groups:
                        if len(group) == 1:
                            remaining_losers.append(group[0])
                        else:
                            tie_groups.append(group)
                    for n in remaining_losers:
                        game.turn_order.append(n)
                    # Re-roll winners; schedule loser tie-breaks after
                    for n in winners:
                        game.players[n].dice_roll = 0
                    game.dice_round = winners
                    await game.broadcast({"type": "game_state", **game.public_state()})
                    continue

                # All players ordered — pause so everyone sees the final roll, then start
                if len(game.turn_order) == len(game.players):
                    await asyncio.sleep(1.5)
                    for p in game.players.values():
                        p.pieces = dict(PIECE_SET)
                        # Food minimum 4; remaining split between science and tool; money 0-3
                        food = random.randint(4, 10)
                        rem  = 10 - food
                        sci  = random.randint(0, rem)
                        p.resources = {
                            "food":    food,
                            "science": sci,
                            "tool":    rem - sci,
                            "money":   random.randint(0, 3),
                        }
                        # Income 0-2 per resource per turn
                        p.income = {r: random.randint(0, 2)
                                    for r in ("food", "science", "tool", "money")}
                        p.tech = {col: [False] * 5
                                  for col in ["biology", "physics", "engineering", "government"]}
                        p.action_cards = []
                        p.tech_cards   = []
                    game.board = _build_board()
                    game.board[29]["pieces"].append({"type": "pirate_base", "owner": "neutral"})
                    for name in game.turn_order:
                        game.player_placement[name] = list(START_PIECES)
                    game.placement_idx = 0
                    game.phase = "place_pieces"
                    state = game.public_state()
                    state["board"] = game.board
                    await game.broadcast({"type": "place_pieces_start", **state})

            # ── place_piece ───────────────────────────────────────────────────
            elif kind == "place_piece":
                if not game or not player:
                    continue
                if game.phase != "place_pieces":
                    continue
                if not game.turn_order or game.placement_idx >= len(game.turn_order):
                    continue
                current = game.turn_order[game.placement_idx]
                if player.name != current:
                    await ws.send_json({"type": "error", "msg": "Not your turn to place"})
                    continue
                remaining = game.player_placement.get(player.name, [])
                if not remaining:
                    continue
                hex_id = raw.get("hex_id")
                if not isinstance(hex_id, int) or hex_id < 0 or hex_id >= len(game.board):
                    await ws.send_json({"type": "error", "msg": "Invalid hex"})
                    continue
                h = game.board[hex_id]
                next_piece = remaining[0]
                if next_piece == "battle_station":
                    if h["type"] != "bs_slot":
                        await ws.send_json({"type": "error", "msg": "Battle station must go on the designated slot (light yellow hex)"})
                        continue
                    # Must be a system that contains a triangle tile
                    has_tri = any(h2["tri"] for h2 in game.board if h2["cluster"] == h["cluster"])
                    if not has_tri:
                        await ws.send_json({"type": "error", "msg": "Battle station may only be placed in systems with a triangle tile"})
                        continue
                    # Block black hole cluster and clusters already claimed by others
                    claimed = {v for k, v in game.player_system.items() if k != player.name}
                    core_type = game.board[h["cluster"] * 7]["type"]
                    if core_type == "black_hole":
                        await ws.send_json({"type": "error", "msg": "Cannot claim the black hole system"})
                        continue
                    if h["cluster"] in claimed:
                        await ws.send_json({"type": "error", "msg": "That system is already claimed"})
                        continue
                    h["pieces"].append({"type": "battle_station", "owner": player.name})
                    game.player_system[player.name] = h["cluster"]
                    core_id = h["cluster"] * 7
                    game.board[core_id]["pieces"].append({"type": "empire_flag", "owner": player.name})
                    player.pieces["battle_station"] = player.pieces.get("battle_station", 1) - 1
                    player.pieces["empire_flag"] = player.pieces.get("empire_flag", 1) - 1
                elif next_piece == "frigate":
                    sys_cluster = game.player_system.get(player.name)
                    if sys_cluster is None:
                        await ws.send_json({"type": "error", "msg": "Place battle station first"})
                        continue
                    if h["cluster"] != sys_cluster:
                        await ws.send_json({"type": "error", "msg": "Must place within your system"})
                        continue
                    if h["type"] != "orbital":
                        await ws.send_json({"type": "error", "msg": "Frigates must go on orbital hexes (light blue)"})
                        continue
                    # Ring-adjacent locals in a 6-hex ring: prev = (i-2)%6+1, next = i%6+1
                    local = h["local"]
                    adj_locals = {(local - 2) % 6 + 1, local % 6 + 1}
                    adjacent_frigate = any(
                        any(p["type"] == "frigate" for p in adj_h["pieces"])
                        for adj_h in game.board
                        if adj_h["cluster"] == sys_cluster and adj_h["local"] in adj_locals
                    )
                    if adjacent_frigate:
                        await ws.send_json({"type": "error", "msg": "Frigates cannot be placed on adjacent hexes"})
                        continue
                    h["pieces"].append({"type": "frigate", "owner": player.name})
                    player.pieces["frigate"] = player.pieces.get("frigate", 1) - 1
                else:
                    # influence_token and others: any hex within the system
                    sys_cluster = game.player_system.get(player.name)
                    if sys_cluster is None:
                        await ws.send_json({"type": "error", "msg": "Place battle station first"})
                        continue
                    if h["cluster"] != sys_cluster:
                        await ws.send_json({"type": "error", "msg": "Must place within your system"})
                        continue
                    if next_piece == "influence_token" and any(
                        p["type"] == "influence_token" for p in h["pieces"]
                    ):
                        await ws.send_json({"type": "error", "msg": "That hex already has an influence token"})
                        continue
                    h["pieces"].append({"type": next_piece, "owner": player.name})
                    player.pieces[next_piece] = player.pieces.get(next_piece, 1) - 1
                game.player_placement[player.name].pop(0)

                # Auto-advance when this player's queue is empty
                if not game.player_placement.get(player.name):
                    game.placement_idx += 1
                    if game.placement_idx >= len(game.turn_order):
                        _deal_draft(game)
                        state = game.public_state()
                        state["board"] = game.board
                        await game.broadcast({"type": "draft_start", **state})
                    else:
                        state = game.public_state()
                        state["board"] = game.board
                        await game.broadcast({"type": "game_state", **state})
                else:
                    state = game.public_state()
                    state["board"] = game.board
                    await game.broadcast({"type": "game_state", **state})

            # ── done_placing ──────────────────────────────────────────────────
            elif kind == "done_placing":
                if not game or not player:
                    continue
                if game.phase != "place_pieces":
                    continue
                if not game.turn_order or game.placement_idx >= len(game.turn_order):
                    continue
                if player.name != game.turn_order[game.placement_idx]:
                    continue
                game.player_placement[player.name] = []
                game.placement_idx += 1
                if game.placement_idx >= len(game.turn_order):
                    _deal_draft(game)
                    state = game.public_state()
                    state["board"] = game.board
                    await game.broadcast({"type": "draft_start", **state})
                else:
                    state = game.public_state()
                    state["board"] = game.board
                    await game.broadcast({"type": "game_state", **state})

            # ── begin_action ──────────────────────────────────────────────────
            elif kind == "begin_action":
                if not game or not player:
                    continue
                if game.phase != "draft" or player.role != "host":
                    continue
                game.phase = "board"
                state = game.public_state()
                state["board"] = game.board
                await game.broadcast({"type": "board_ready", **state})

            # ── draw_tech_card ────────────────────────────────────────────────
            elif kind == "draw_tech_card":
                if not game or not player:
                    continue
                if game.phase not in ("draft", "board"):
                    continue
                card = random.choice(TECH_CARDS)
                player.tech_cards.append(card["id"])
                state = game.public_state()
                state["board"] = game.board
                await game.broadcast({"type": "game_state", **state})

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
