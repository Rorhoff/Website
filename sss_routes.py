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

R = 25.2  # circumradius px, flat-top hexagons (5 % larger than original 24)

# Flat-top hex neighbors sit at 30°, 90°, 150°, 210°, 270°, 330°, distance R√3.
_ND = R * math.sqrt(3)  # neighbor distance ≈ 43.65
_hex_offsets = [(0, 0)]
for _i in range(6):
    _a = math.pi / 6 + math.pi / 3 * _i   # start at 30°
    _hex_offsets.append((round(_ND * math.cos(_a), 2), round(_ND * math.sin(_a), 2)))

# 9 clusters in a true diamond (1-2-3-2-1) using staggered rows.
# Each row is offset by DX/2; DY is the vertical row spacing.
_CX, _CY = 415, 385
_DX = 155   # horizontal cluster-to-cluster distance (same row)
_DY = 124   # vertical cluster-to-cluster distance (adjacent rows)

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
_CENTER_COLORS = ["yellow", "blue", "white", "white", "black_hole", "red", "blue", "green", "red"]

# Human-readable cluster labels sent to the client
CLUSTER_LABELS = ["018", "011", "015", "002", "001", "003", "009", "007", "013"]


_TRI_TYPES = {"red", "blue", "yellow"}


def _build_board(player_count: int = 2) -> list[dict]:
    # ── Cluster layout (extended per player count) ─────────────────────────────
    # Base 9 clusters: 0=N 1=NW 2=NE 3=W 4=CTR 5=E 6=SW 7=SE 8=S
    positions: list = list(_CLUSTER_POSITIONS)
    colors: list    = list(_CENTER_COLORS)
    labels: list    = list(CLUSTER_LABELS)
    adj: list       = [
        (0, 1), (0, 2),
        (1, 3), (1, 4),
        (2, 4), (2, 5),
        (3, 4), (3, 6),
        (4, 5), (4, 6), (4, 7),
        (5, 7),
        (6, 8), (7, 8),
    ]

    if player_count >= 3:
        # 2 bottom-left (9,10) + 2 top-right (11,12) — all triangle hex
        positions += [
            (_CX - 2*_DX,           _CY),          # 9  BL1 — left of W
            (_CX - _DX - _DX//2,    _CY + _DY),    # 10 BL2 — left of SW
            (_CX + 2*_DX,           _CY),          # 11 TR1 — right of E
            (_CX + _DX + _DX//2,    _CY - _DY),    # 12 TR2 — right of NE
        ]
        colors += ["yellow", "blue", "red", "yellow"]
        labels += ["020", "021", "022", "023"]
        adj += [
            (3, 9), (9, 10), (3, 10), (6, 10),
            (5, 11), (11, 12), (2, 12), (5, 12),
        ]

    if player_count >= 4:
        # 2 top-left (13,14) + 2 bottom-right (15,16) — all triangle hex
        # + 2 far corners (17,18): upper-right and lower-left
        positions += [
            (_CX - _DX - _DX//2,    _CY - _DY),    # 13 TL1 — left of NW
            (_CX - _DX,             _CY - 2*_DY),  # 14 TL2 — left of N
            (_CX + _DX + _DX//2,    _CY + _DY),    # 15 BR1 — right of SE
            (_CX + _DX,             _CY + 2*_DY),  # 16 BR2 — right of S
            (_CX + 2*_DX,           _CY - 2*_DY),  # 17 UR  — above TR2 (upper-right corner)
            (_CX - 2*_DX,           _CY + 2*_DY),  # 18 LL  — below BL2 (lower-left corner)
        ]
        colors += ["blue", "yellow", "red", "blue", "red", "yellow"]
        labels += ["024", "025", "026", "027", "028", "029"]
        adj += [
            (1, 13), (3, 13), (13, 14), (0, 14), (1, 14),
            (7, 15), (5, 15), (15, 16), (8, 16), (7, 16),
            (12, 17),   # TR2 — upper-right corner
            (10, 18),   # BL2 — lower-left corner
        ]

    # ── Generate hexes ─────────────────────────────────────────────────────────
    hexes = []
    hex_id = 0
    for cluster_idx, (cx, cy) in enumerate(positions):
        center_color = colors[cluster_idx]
        label = labels[cluster_idx]

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
            is_tri = local_idx == tri_local
            hexes.append({
                "id": hex_id,
                "cluster": cluster_idx,
                "local": local_idx,
                "label": label if local_idx == 0 else "",
                "tri": is_tri,
                "tri_color": center_color if is_tri else "",
                "tri_counts": [random.randint(1, 2), random.randint(1, 2), random.randint(1, 2)] if is_tri else [],
                "tri_farmer_green": False,
                "x": round(cx + ox, 1),
                "y": round(cy + oy, 1),
                "type": hex_type,
                "pieces": [],
                "wormhole": False,
                "wormhole_partner": None,
            })
            hex_id += 1

    # ── Wormholes ──────────────────────────────────────────────────────────────
    by_cluster: dict = {}
    for h in hexes:
        if h["local"] > 0:
            by_cluster.setdefault(h["cluster"], []).append(h)

    def _facing(ci_xy: tuple, hx: float, hy: float, cj_xy: tuple) -> bool:
        return (hx - ci_xy[0]) * (cj_xy[0] - ci_xy[0]) \
             + (hy - ci_xy[1]) * (cj_xy[1] - ci_xy[1]) > 0

    all_candidates: dict = {}
    for ci, cj in adj:
        ci_xy = positions[ci]
        cj_xy = positions[cj]
        pairs = []
        for hi in by_cluster.get(ci, []):
            if not _facing(ci_xy, hi["x"], hi["y"], cj_xy):
                continue
            for hj in by_cluster.get(cj, []):
                if not _facing(cj_xy, hj["x"], hj["y"], ci_xy):
                    continue
                d = math.sqrt((hi["x"] - hj["x"]) ** 2 + (hi["y"] - hj["y"]) ** 2)
                pairs.append((d, hi["id"], hj["id"]))
        all_candidates[(ci, cj)] = sorted(pairs)

    def _aug_match(pairs: list, candidates: dict) -> dict:
        """Augmenting-path bipartite matching (left=pairs, right=hex ids)."""
        match_l: dict = {}
        match_r: dict = {}

        def _augment(u, seen: set) -> bool:
            for v in candidates.get(u, []):
                if v in seen:
                    continue
                seen.add(v)
                if v not in match_r or _augment(match_r[v], seen):
                    match_l[u] = v
                    match_r[v] = u
                    return True
            return False

        for u in pairs:
            _augment(u, set())
        return match_l

    # Per-cluster bipartite matching: for each adjacency pair assign one ring hex
    # from each cluster that faces the neighbour.  The greedy single-pass can
    # fail for the high-degree centre cluster (degree 6, ring hexes each face two
    # neighbours) because an unlucky processing order exhausts facing-hex slots
    # before all pairs are covered.  Augmenting-path matching on each cluster
    # independently guarantees a perfect assignment (Hall's condition is satisfied
    # by the symmetric hex layout).
    cluster_facing: dict = {}   # cluster_idx -> {pair -> [hex_ids facing neighbour]}
    for ci, cj in adj:
        # Preserve distance ordering so closer hexes are preferred.
        ci_hexes = list(dict.fromkeys(ha for _d, ha, hb in all_candidates.get((ci, cj), [])))
        cj_hexes = list(dict.fromkeys(hb for _d, ha, hb in all_candidates.get((ci, cj), [])))
        cluster_facing.setdefault(ci, {})[(ci, cj)] = ci_hexes
        cluster_facing.setdefault(cj, {})[(ci, cj)] = cj_hexes

    assign: dict = {}   # cluster_idx -> {pair -> hex_id}
    for cluster_idx, pair_cands in cluster_facing.items():
        assign[cluster_idx] = _aug_match(list(pair_cands.keys()), pair_cands)

    for ci, cj in adj:
        ha = assign.get(ci, {}).get((ci, cj))
        hb = assign.get(cj, {}).get((ci, cj))
        if ha is not None and hb is not None:
            hexes[ha]["wormhole"] = True
            hexes[ha]["wormhole_partner"] = hb
            hexes[hb]["wormhole"] = True
            hexes[hb]["wormhole_partner"] = ha

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


_BUILDING_INCOME = {
    "building_tool":    {"tool": 1},
    "building_science": {"science": 1},
    "building_money":   {"money": 2},
}

def _apply_turn_income(game, player) -> None:
    """Collect income minus triangle upkeep, plus building bonuses."""
    upkeep: dict = {"food": 0, "science": 0, "tool": 0}
    # Find all clusters where this player has an empire_flag
    flag_clusters: set = set()
    for h in game.board:
        for p in h["pieces"]:
            if p["type"] == "empire_flag" and p["owner"] == player.name:
                flag_clusters.add(h["cluster"])
    # Sum upkeep from tri hexes in those clusters
    for h in game.board:
        if not h.get("tri") or h["cluster"] not in flag_clusters:
            continue
        counts = h.get("tri_counts") or []
        if len(counts) >= 3:
            upkeep["tool"]    += counts[0]  # yellow  → tools
            upkeep["food"]    += counts[1]  # red/green → food
            upkeep["science"] += counts[2]  # blue    → science
    # Building bonuses — all buildings owned by the player anywhere on the board
    building_bonus: dict = {"food": 0, "science": 0, "tool": 0, "money": 0}
    for h in game.board:
        for p in h["pieces"]:
            if p.get("owner") != player.name:
                continue
            for key, amount in _BUILDING_INCOME.get(p["type"], {}).items():
                building_bonus[key] = building_bonus.get(key, 0) + amount
    # Apply: resources += income − upkeep + building_bonus (floor 0)
    for key in ("food", "science", "tool", "money"):
        net = player.income.get(key, 0) - upkeep.get(key, 0) + building_bonus.get(key, 0)
        player.resources[key] = max(0, player.resources.get(key, 0) + net)


def _advance_turn(game) -> None:
    """Apply income for the current player then advance the turn index."""
    if game.turn_order:
        name = game.turn_order[game.turn_idx % len(game.turn_order)]
        p = game.players.get(name)
        if p:
            _apply_turn_income(game, p)
    game.turn_idx += 1
    game.turn_actions_remaining = 3


def _use_action(game) -> None:
    """Consume one action token; advance turn if the player has used all 3."""
    game.turn_actions_remaining -= 1
    if game.turn_actions_remaining <= 0:
        _advance_turn(game)


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
    connected: bool = True                           # False when WS is closed but slot is held for rejoin


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
    _seq: int = 0
    turn_idx: int = 0
    turn_actions_remaining: int = 3
    pending_combat: Any = None

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
            "current_turn": (
                self.turn_order[self.turn_idx % len(self.turn_order)]
                if self.phase == "board" and self.turn_order else None
            ),
            "round": (
                self.turn_idx // len(self.turn_order) + 1
                if self.phase == "board" and self.turn_order else None
            ),
            "actions_remaining": self.turn_actions_remaining,
        }

    async def broadcast(self, msg: dict, exclude: WebSocket | None = None) -> None:
        self._seq += 1
        msg = {**msg, "seq": self._seq}
        targets = list(self.players.values()) + self.watchers
        await asyncio.gather(
            *(p.ws.send_json(msg) for p in targets if p.ws is not None and p.ws is not exclude),
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
                    # Allow re-entry for a previously disconnected player
                    existing = g.players.get(name)
                    if existing and not existing.connected:
                        game = g
                        player = existing
                        player.ws = ws
                        player.connected = True
                        await ws.send_json({"type": "joined", "code": code, "name": name, "role": player.role})
                        state = game.public_state()
                        if game.phase in ("place_pieces", "draft", "board"):
                            state["board"] = game.board
                        await ws.send_json({"type": "game_state", **state})
                        await game.broadcast({"type": "game_state", **game.public_state()}, exclude=ws)
                        continue
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

            # ── rejoin ────────────────────────────────────────────────────────
            elif kind == "rejoin":
                name = (raw.get("name") or "").strip()[:32]
                code = (raw.get("code") or "").strip().upper()
                g = _games.get(code)
                if not g:
                    await ws.send_json({"type": "error", "msg": "Game not found — it may have ended."})
                    continue
                existing = g.players.get(name)
                if not existing or existing.connected:
                    await ws.send_json({"type": "error", "msg": "Could not rejoin — slot unavailable."})
                    continue
                game = g
                player = existing
                player.ws = ws
                player.connected = True
                await ws.send_json({"type": "joined", "code": code, "name": name, "role": player.role})
                state = game.public_state()
                if game.phase in ("place_pieces", "draft", "board"):
                    state["board"] = game.board
                await ws.send_json({"type": "game_state", **state})
                await game.broadcast({"type": "game_state", **game.public_state()}, exclude=ws)

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

                # Check BEFORE any await so this is atomic — no other handler
                # can interleave between the roll assignment and this check.
                rolled = {n for n in game.dice_round
                          if game.players[n].dice_roll != 0}
                if rolled < set(game.dice_round):
                    # Others still need to roll; broadcast progress and wait.
                    await game.broadcast({"type": "game_state", **game.public_state()})
                    continue

                # Every player in this round has rolled.  We own this resolution
                # (still no await since player.dice_roll was set).
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
                        # Show the rolled values first, then reset for re-roll
                        await game.broadcast({"type": "game_state", **game.public_state()})
                        await asyncio.sleep(1.5)
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
                    # Show the tied rolls before resetting for re-roll
                    await game.broadcast({"type": "game_state", **game.public_state()})
                    await asyncio.sleep(1.5)
                    for n in winners:
                        game.players[n].dice_roll = 0
                    game.dice_round = winners
                    await game.broadcast({"type": "game_state", **game.public_state()})
                    continue

                # All players ordered — show final rolls, pause, then start
                if len(game.turn_order) == len(game.players):
                    await game.broadcast({"type": "game_state", **game.public_state()})
                    await asyncio.sleep(0.4)
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
                    game.board = _build_board(len(game.players))
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
                    planet = {
                        "vp":      1,
                        "unrest":  random.randint(0, 2),
                        "food":    random.randint(1, 4),
                        "science": random.randint(1, 3),
                        "tool":    random.randint(1, 3),
                    }
                    game.board[core_id]["planet"] = planet
                    player.resources["unrest"] = player.resources.get("unrest", 0) + planet["unrest"]
                    player.income["food"]    = player.income.get("food",    0) + planet["food"]
                    player.income["science"] = player.income.get("science", 0) + planet["science"]
                    player.income["tool"]    = player.income.get("tool",    0) + planet["tool"]
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
                        await ws.send_json({"type": "error", "msg": "Frigates must be placed on frigate tiles (orbital hexes)"})
                        continue
                    if sum(1 for p in h["pieces"] if p["type"] == "frigate") >= 3:
                        await ws.send_json({"type": "error", "msg": "That frigate tile is full (max 3)"})
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

            # ── skip_turn ─────────────────────────────────────────────────────
            elif kind == "skip_turn":
                if not game or not player:
                    continue
                if game.phase != "board" or not game.turn_order:
                    continue
                current = game.turn_order[game.turn_idx % len(game.turn_order)]
                if player.name != current:
                    await ws.send_json({"type": "error", "msg": "Not your turn"})
                    continue
                _advance_turn(game)
                state = game.public_state()
                state["board"] = game.board
                await game.broadcast({"type": "game_state", **state})

            # ── end_turn ──────────────────────────────────────────────────────
            elif kind == "end_turn":
                if not game or not player:
                    continue
                if game.phase != "board" or not game.turn_order:
                    continue
                current = game.turn_order[game.turn_idx % len(game.turn_order)]
                if player.name != current:
                    continue
                _advance_turn(game)
                state = game.public_state()
                state["board"] = game.board
                await game.broadcast({"type": "game_state", **state})

            # ── build_piece ───────────────────────────────────────────────────
            elif kind == "build_piece":
                if not game or not player:
                    continue
                if game.phase != "board" or not game.turn_order:
                    continue
                current = game.turn_order[game.turn_idx % len(game.turn_order)]
                if player.name != current:
                    await ws.send_json({"type": "error", "msg": "Not your turn"})
                    continue
                piece_type = raw.get("piece_type")
                hex_id     = raw.get("hex_id")
                COSTS = {
                    "cruise_ship":       10,
                    "frigate":           15,
                    "outpost":           30,
                    "super_ship":        60,
                    "battle_station":    75,
                    "death_star":       130,
                    "building_tool":      4,
                    "building_science":   4,
                    "building_money":     6,
                }
                cost = COSTS.get(piece_type)
                if cost is None:
                    await ws.send_json({"type": "error", "msg": "Unknown piece type"})
                    continue
                money = player.resources.get("money", 0)
                if money < cost:
                    await ws.send_json({"type": "error", "msg": f"Not enough money (need {cost}, have {money})"})
                    continue
                if not (0 <= hex_id < len(game.board)):
                    await ws.send_json({"type": "error", "msg": "Invalid hex"})
                    continue
                target_hex = game.board[hex_id]
                # Validate placement: must be a ring hex in the player's home cluster
                player_cluster = game.player_system.get(player.name)
                if target_hex["cluster"] != player_cluster or target_hex["local"] == 0:
                    await ws.send_json({"type": "error", "msg": "Must build in your home system"})
                    continue
                _building_types = set(_BUILDING_INCOME)
                if piece_type in _building_types:
                    if target_hex["type"] != "science":
                        await ws.send_json({"type": "error", "msg": "Buildings must be placed on science hexes (light purple)"})
                        continue
                    existing = [p for p in target_hex["pieces"] if p["type"] in _building_types]
                    if len(existing) >= 3:
                        await ws.send_json({"type": "error", "msg": "That hex already has 3 buildings (max)"})
                        continue
                elif piece_type == "battle_station":
                    if target_hex["type"] != "bs_slot":
                        await ws.send_json({"type": "error", "msg": "Battle stations must be placed on a battle station slot"})
                        continue
                else:
                    if target_hex["type"] != "orbital":
                        await ws.send_json({"type": "error", "msg": "That piece must be placed on an orbital hex"})
                        continue
                player.resources["money"] = money - cost
                target_hex["pieces"].append({"type": piece_type, "owner": player.name})
                _use_action(game)
                state = game.public_state()
                state["board"] = game.board
                await game.broadcast({"type": "game_state", **state})

            # ── play_card ─────────────────────────────────────────────────────
            elif kind == "play_card":
                if not game or not player:
                    continue
                if game.phase != "board" or not game.turn_order:
                    continue
                current = game.turn_order[game.turn_idx % len(game.turn_order)]
                if player.name != current:
                    await ws.send_json({"type": "error", "msg": "Not your turn"})
                    continue
                card = raw.get("card")
                if card == "flight":
                    player_clusters: set = set()
                    for h in game.board:
                        for p in h["pieces"]:
                            if p["type"] == "frigate" and p["owner"] == player.name:
                                player_clusters.add(h["cluster"])
                    reachable: set = set()
                    routes: dict = {}
                    for h in game.board:
                        if h["cluster"] not in player_clusters:
                            continue
                        if not h.get("wormhole"):
                            continue
                        partner_id = h.get("wormhole_partner")
                        if partner_id is None:
                            continue
                        partner = game.board[partner_id]
                        dest = partner["cluster"]
                        if dest in player_clusters:
                            continue
                        if dest not in routes:
                            routes[dest] = {
                                "from_wormhole": h["id"],
                                "to_wormhole": partner_id,
                                "dest_cluster": dest,
                            }
                        reachable.add(dest)
                    await ws.send_json({
                        "type": "flight_targets",
                        "reachable_clusters": list(reachable),
                        "routes": list(routes.values()),
                    })

            # ── flight_move ───────────────────────────────────────────────────
            elif kind == "flight_move":
                if not game or not player:
                    continue
                if game.phase != "board" or not game.turn_order:
                    continue
                current = game.turn_order[game.turn_idx % len(game.turn_order)]
                if player.name != current:
                    continue
                from_wh = raw.get("from_wormhole")
                to_wh   = raw.get("to_wormhole")
                if from_wh is None or to_wh is None:
                    continue
                if not (0 <= from_wh < len(game.board)) or not (0 <= to_wh < len(game.board)):
                    continue
                from_hex = game.board[from_wh]
                to_hex   = game.board[to_wh]
                if from_hex.get("wormhole_partner") != to_wh:
                    await ws.send_json({"type": "error", "msg": "Invalid wormhole route"})
                    continue
                from_cluster = from_hex["cluster"]
                dest_cluster = to_hex["cluster"]
                # Frigate must land on an orbital tile with fewer than 3 frigates
                landing_hex = next(
                    (h for h in game.board
                     if h["cluster"] == dest_cluster and h["type"] == "orbital"
                     and sum(1 for p in h["pieces"] if p["type"] == "frigate") < 3),
                    None)
                if landing_hex is None:
                    await ws.send_json({"type": "error", "msg": "No available frigate tiles in that system"})
                    continue
                moved_piece = None
                for h in game.board:
                    if h["cluster"] != from_cluster:
                        continue
                    for i, p in enumerate(h["pieces"]):
                        if p["type"] == "frigate" and p["owner"] == player.name:
                            moved_piece = h["pieces"].pop(i)
                            break
                    if moved_piece:
                        break
                if not moved_piece:
                    await ws.send_json({"type": "error", "msg": "No frigate to move"})
                    continue
                landing_hex["pieces"].append(moved_piece)
                enemy_frigates = []
                for h in game.board:
                    if h["cluster"] != dest_cluster:
                        continue
                    for p in h["pieces"]:
                        if p["type"] == "frigate" and p["owner"] != player.name:
                            enemy_frigates.append({"owner": p["owner"], "hex_id": h["id"]})
                state = game.public_state()
                state["board"] = game.board
                if enemy_frigates:
                    defender_name = enemy_frigates[0]["owner"]
                    game.pending_combat = {
                        "type": "combat",
                        "attacker": player.name,
                        "defender": defender_name,
                        "dest_cluster": dest_cluster,
                        "enemy_frigates": enemy_frigates,
                        "atk_rolled": False,
                        "def_rolled": False,
                        "atk_dice": [],
                        "def_dice": [],
                    }
                    await game.broadcast({"type": "game_state", **state}, exclude=ws)
                    await ws.send_json({"type": "combat_prompt", "dest_cluster": dest_cluster,
                                        "attacker": player.name, "tech_cards": player.tech_cards, **state})
                    def_p = game.players.get(defender_name)
                    if def_p and def_p.ws:
                        await def_p.ws.send_json({"type": "combat_defender_prompt",
                                                   "dest_cluster": dest_cluster,
                                                   "attacker": player.name, **state})
                else:
                    game.pending_combat = None
                    _use_action(game)
                    state = game.public_state()
                    state["board"] = game.board
                    await game.broadcast({"type": "game_state", **state})

            # ── attack_move ───────────────────────────────────────────────────
            elif kind == "attack_move":
                if not game or not player:
                    continue
                if game.phase != "board" or not game.turn_order:
                    continue
                current = game.turn_order[game.turn_idx % len(game.turn_order)]
                if current != player.name:
                    await ws.send_json({"type": "error", "msg": "Not your turn"})
                    continue
                from_cluster = raw.get("from_cluster")
                dest_cluster = raw.get("dest_cluster")
                if from_cluster is None or dest_cluster is None:
                    continue
                atk_frigates = [
                    p for h in game.board if h["cluster"] == from_cluster
                    for p in h.get("pieces", [])
                    if p["type"] == "frigate" and p["owner"] == player.name
                ]
                if not atk_frigates:
                    await ws.send_json({"type": "error", "msg": "No frigates in that system."})
                    continue
                connected = any(
                    game.board[h["wormhole_partner"]]["cluster"] == dest_cluster
                    for h in game.board
                    if h["cluster"] == from_cluster and h.get("wormhole") and h.get("wormhole_partner") is not None
                )
                if not connected:
                    await ws.send_json({"type": "error", "msg": "Systems not wormhole-connected."})
                    continue
                enemy_frigates = [
                    {"owner": p["owner"]}
                    for h in game.board if h["cluster"] == dest_cluster
                    for p in h.get("pieces", [])
                    if p["type"] == "frigate" and p["owner"] != player.name
                ]
                if not enemy_frigates:
                    await ws.send_json({"type": "error", "msg": "No enemy frigates in target system."})
                    continue
                defender_name = enemy_frigates[0]["owner"]
                game.pending_combat = {
                    "type": "attack",
                    "attacker": player.name,
                    "defender": defender_name,
                    "from_cluster": from_cluster,
                    "dest_cluster": dest_cluster,
                    "enemy_frigates": enemy_frigates,
                    "atk_rolled": False,
                    "def_rolled": False,
                    "atk_dice": [],
                    "def_dice": [],
                }
                state = game.public_state()
                state["board"] = game.board
                await game.broadcast({"type": "game_state", **state}, exclude=ws)
                await ws.send_json({"type": "combat_prompt", "dest_cluster": dest_cluster,
                                    "attacker": player.name, "tech_cards": player.tech_cards, **state})
                def_p = game.players.get(defender_name)
                if def_p and def_p.ws:
                    await def_p.ws.send_json({"type": "combat_defender_prompt",
                                               "dest_cluster": dest_cluster,
                                               "attacker": player.name, **state})

            # ── roll_combat_dice ──────────────────────────────────────────────
            elif kind == "roll_combat_dice":
                if not game or not player:
                    continue
                if game.phase != "board" or not game.pending_combat:
                    continue
                combat = game.pending_combat
                attacker_name = combat.get("attacker")
                defender_name = combat.get("defender")
                if player.name not in (attacker_name, defender_name):
                    continue
                dest_cluster = combat["dest_cluster"]
                is_attacker = player.name == attacker_name

                if is_attacker and not combat["atk_rolled"]:
                    tech_card = raw.get("tech_card")
                    atk_dice_count = 2 if tech_card == "nuclear_missile" else 1
                    atk_dice = [random.randint(1, 6) for _ in range(atk_dice_count)]
                    combat["atk_dice"]  = atk_dice
                    combat["atk_total"] = sum(atk_dice)
                    combat["atk_rolled"] = True
                    await game.broadcast({
                        "type": "combat_attacker_rolled",
                        "attacker": attacker_name,
                        "defender": defender_name,
                        "atk_dice": atk_dice,
                        "atk_total": combat["atk_total"],
                        "dest_cluster": dest_cluster,
                    })

                elif not is_attacker and player.name == defender_name and not combat["def_rolled"]:
                    def_dice = [random.randint(1, 6)]
                    combat["def_dice"]  = def_dice
                    combat["def_total"] = sum(def_dice)
                    combat["def_rolled"] = True

                if combat["atk_rolled"] and combat["def_rolled"]:
                    atk_total = combat["atk_total"]
                    def_total = combat["def_total"]
                    attacker_won = atk_total > def_total
                    if attacker_won:
                        # Destroy defender's frigates in the target cluster
                        for h in game.board:
                            if h["cluster"] != dest_cluster:
                                continue
                            h["pieces"] = [
                                p for p in h["pieces"]
                                if not (p["type"] == "frigate" and p["owner"] == defender_name)
                            ]
                    else:
                        # Destroy attacker's frigates in their source cluster
                        from_cluster = combat.get("from_cluster", dest_cluster)
                        for h in game.board:
                            if h["cluster"] != from_cluster:
                                continue
                            h["pieces"] = [
                                p for p in h["pieces"]
                                if not (p["type"] == "frigate" and p["owner"] == attacker_name)
                            ]
                    game.pending_combat = None
                    _use_action(game)
                    state = game.public_state()
                    state["board"] = game.board
                    await game.broadcast({
                        "type": "combat_result",
                        "attacker": attacker_name,
                        "defender": defender_name,
                        "attacker_won": attacker_won,
                        "winner": attacker_name if attacker_won else defender_name,
                        "atk_dice": combat["atk_dice"],
                        "def_dice": combat["def_dice"],
                        "atk_total": atk_total,
                        "def_total": def_total,
                        **state,
                    })

            # ── invasion_move ─────────────────────────────────────────────────
            elif kind == "invasion_move":
                if not game or not player:
                    continue
                if game.phase != "board" or not game.turn_order:
                    continue
                current = game.turn_order[game.turn_idx % len(game.turn_order)]
                if player.name != current:
                    continue
                from_wh = raw.get("from_wormhole")
                to_wh   = raw.get("to_wormhole")
                if from_wh is None or to_wh is None:
                    continue
                if not (0 <= from_wh < len(game.board)) or not (0 <= to_wh < len(game.board)):
                    continue
                from_hex = game.board[from_wh]
                to_hex   = game.board[to_wh]
                if from_hex.get("wormhole_partner") != to_wh:
                    await ws.send_json({"type": "error", "msg": "Invalid wormhole route"})
                    continue
                # Destination must have a planet
                dest_cluster = to_hex["cluster"]
                core_hex = next((h for h in game.board if h["cluster"] == dest_cluster and h["local"] == 0), None)
                if not core_hex or not core_hex.get("planet"):
                    await ws.send_json({"type": "error", "msg": "No planet to invade there"})
                    continue
                # Find and move a frigate from from_hex's cluster
                from_cluster = from_hex["cluster"]
                landing_hex = next(
                    (h for h in game.board
                     if h["cluster"] == dest_cluster and h["type"] == "orbital"
                     and sum(1 for p in h["pieces"] if p["type"] == "frigate") < 3),
                    None)
                if landing_hex is None:
                    await ws.send_json({"type": "error", "msg": "No available frigate tiles in that system"})
                    continue
                moved_piece = None
                for h in game.board:
                    if h["cluster"] != from_cluster:
                        continue
                    for i, p in enumerate(h["pieces"]):
                        if p["type"] == "frigate" and p["owner"] == player.name:
                            moved_piece = h["pieces"].pop(i)
                            break
                    if moved_piece:
                        break
                if not moved_piece:
                    await ws.send_json({"type": "error", "msg": "No frigate to move"})
                    continue
                landing_hex["pieces"].append(moved_piece)
                game.pending_combat = {
                    "type": "invasion",
                    "attacker": player.name,
                    "dest_cluster": dest_cluster,
                    "planet": core_hex["planet"],
                }
                state = game.public_state()
                state["board"] = game.board
                await game.broadcast({"type": "game_state", **state}, exclude=ws)
                await ws.send_json({
                    "type": "invasion_prompt",
                    "dest_cluster": dest_cluster,
                    "planet": core_hex["planet"],
                    "tech_cards": player.tech_cards,
                    **state,
                })

            # ── invasion_attack ───────────────────────────────────────────────
            elif kind == "invasion_attack":
                if not game or not player:
                    continue
                if game.phase != "board" or not game.turn_order:
                    continue
                current = game.turn_order[game.turn_idx % len(game.turn_order)]
                if player.name != current:
                    await ws.send_json({"type": "error", "msg": "Not your turn"})
                    continue
                cluster = raw.get("cluster")
                if cluster is None:
                    continue
                core_hex = next(
                    (h for h in game.board if h["cluster"] == cluster and h["local"] == 0), None
                )
                if not core_hex or not core_hex.get("planet"):
                    await ws.send_json({"type": "error", "msg": "No planet at that cluster"})
                    continue
                # Verify player has frigates there
                player_frigates = [
                    p for h in game.board if h["cluster"] == cluster
                    for p in h["pieces"] if p["type"] == "frigate" and p["owner"] == player.name
                ]
                if not player_frigates:
                    await ws.send_json({"type": "error", "msg": "No frigates in that cluster"})
                    continue
                # Verify player doesn't own it
                already_owns = (
                    game.player_system.get(player.name) == cluster
                    or any(p["type"] == "empire_flag" and p["owner"] == player.name
                           for p in core_hex.get("pieces", []))
                )
                if already_owns:
                    await ws.send_json({"type": "error", "msg": "You already own this cluster"})
                    continue
                planet = core_hex["planet"]
                # Roll: 1d6 per frigate (up to 3) vs planet 3d6
                num_dice = min(len(player_frigates), 3)
                atk_dice = [random.randint(1, 6) for _ in range(num_dice)]
                atk_total = sum(atk_dice)
                planet_dice = [random.randint(1, 6) for _ in range(3)]
                planet_total = sum(planet_dice)
                won = atk_total > planet_total  # planet wins ties
                if won:
                    # Note previous owner before modifying
                    prev_owner = next(
                        (p["owner"] for p in core_hex.get("pieces", []) if p["type"] == "empire_flag"),
                        None,
                    )
                    # Plant flag
                    core_hex["pieces"] = [p for p in core_hex.get("pieces", []) if p["type"] != "empire_flag"]
                    core_hex["pieces"].append({"type": "empire_flag", "owner": player.name})
                    # Remove income from previous owner
                    if prev_owner and prev_owner != player.name:
                        prev_p = game.players.get(prev_owner)
                        if prev_p:
                            prev_p.income["food"]    = max(0, prev_p.income.get("food",    0) - planet.get("food",    0))
                            prev_p.income["science"] = max(0, prev_p.income.get("science", 0) - planet.get("science", 0))
                            prev_p.income["tool"]    = max(0, prev_p.income.get("tool",    0) - planet.get("tool",    0))
                    # Grant income to attacker
                    player.income["food"]    = player.income.get("food",    0) + planet.get("food",    0)
                    player.income["science"] = player.income.get("science", 0) + planet.get("science", 0)
                    player.income["tool"]    = player.income.get("tool",    0) + planet.get("tool",    0)
                else:
                    # Remove ALL attacker frigates from the cluster
                    for h in game.board:
                        if h["cluster"] != cluster:
                            continue
                        h["pieces"] = [
                            p for p in h["pieces"]
                            if not (p["type"] == "frigate" and p["owner"] == player.name)
                        ]
                _use_action(game)
                state = game.public_state()
                state["board"] = game.board
                await game.broadcast({
                    "type": "invasion_result",
                    "attacker": player.name,
                    "cluster": cluster,
                    "atk_dice": atk_dice,
                    "planet_dice": planet_dice,
                    "atk_total": atk_total,
                    "planet_total": planet_total,
                    "won": won,
                    **state,
                })

            # ── start_invasion ────────────────────────────────────────────────
            elif kind == "start_invasion":
                if not game or not player:
                    continue
                if game.phase != "board" or not game.pending_combat:
                    continue
                if game.pending_combat.get("type") != "invasion":
                    continue
                if player.name != game.pending_combat["attacker"]:
                    continue
                tech_card = raw.get("tech_card")
                combat = game.pending_combat
                dest_cluster = combat["dest_cluster"]
                planet = combat["planet"]
                # Attacker dice
                atk_dice = [random.randint(1, 6), random.randint(1, 6)]
                if tech_card == "nuclear_missile":
                    atk_dice.append(random.randint(1, 6))
                atk_total = sum(atk_dice)
                # Planet defense: 3 dice
                planet_dice  = [random.randint(1, 6) for _ in range(3)]
                planet_total = sum(planet_dice)
                if atk_total > planet_total:
                    winner = "player"
                    # Grant planet income to attacker
                    player.income["food"]    = player.income.get("food",    0) + planet.get("food",    0)
                    player.income["science"] = player.income.get("science", 0) + planet.get("science", 0)
                    player.income["tool"]    = player.income.get("tool",    0) + planet.get("tool",    0)
                    # Remove previous owner's income if applicable
                    for pname, cluster in game.player_system.items():
                        if cluster == dest_cluster and pname != player.name:
                            other = game.players.get(pname)
                            if other:
                                other.income["food"]    = max(0, other.income.get("food",    0) - planet.get("food",    0))
                                other.income["science"] = max(0, other.income.get("science", 0) - planet.get("science", 0))
                                other.income["tool"]    = max(0, other.income.get("tool",    0) - planet.get("tool",    0))
                            break
                else:
                    winner = "planet"
                    # Remove attacker's frigate from dest cluster
                    for h in game.board:
                        if h["cluster"] != dest_cluster:
                            continue
                        for i, p in enumerate(h["pieces"]):
                            if p["type"] == "frigate" and p["owner"] == player.name:
                                h["pieces"].pop(i)
                                break
                game.pending_combat = None
                _use_action(game)
                state = game.public_state()
                state["board"] = game.board
                await game.broadcast({
                    "type": "invasion_result",
                    "attacker": player.name,
                    "atk_dice": atk_dice,
                    "planet_dice": planet_dice,
                    "atk_total": atk_total,
                    "planet_total": planet_total,
                    "winner": winner,
                    **state,
                })

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
    except Exception as _e:
        import traceback
        traceback.print_exc()
        print(f"[sss_ws unhandled] {type(_e).__name__}: {_e}")
    finally:
        if game and player:
            if player.role == "watcher":
                try:
                    game.watchers.remove(player)
                except ValueError:
                    pass
            elif player.ws is ws:
                # Mark disconnected but keep slot alive for rejoin
                player.connected = False
                player.ws = None
                connected = [p for p in game.players.values() if p.connected]
                if connected:
                    # Promote a connected player to host if needed
                    if not any(p.role == "host" for p in connected):
                        connected[0].role = "host"
                        game.host_name = connected[0].name
                    await game.broadcast(
                        {"type": "player_disconnected", "name": player.name, **game.public_state()}
                    )
                elif game.phase == "lobby":
                    # Nobody connected in lobby — no reason to keep the game
                    _games.pop(game.code, None)
