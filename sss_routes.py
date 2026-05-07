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
    "vorrkai":        {"name": "Vorrkai",        "color": "#ff2020"},
    "nexari":         {"name": "Nexari",          "color": "#00aaff"},
    "luminae":        {"name": "Luminae",         "color": "#ff2aff"},
    "thornveld":      {"name": "Thornveld",       "color": "#00ff66"},
    "obsidian_pact":  {"name": "Obsidian Pact",   "color": "#e8ff00"},
    "dust_runners":   {"name": "Dust Runners",    "color": "#ff8800"},
}

_AI_NAMES = ["Nova", "Orion", "Lyra", "Zeta", "Vega"]

# ── Fog of war toggle ─────────────────────────────────────────────────────────
# Set to True for real games; False keeps fog disabled (all board visible) for testing.
FOG_OF_WAR = False

# Ship types that can fly (cruise_ship included — 2-jump repositioning)
_MOBILE_SHIPS = frozenset({"scout", "cruise_ship", "super_ship", "death_star"})
# Ships that can initiate attacks and invasions (cruise_ship is defense-only)
_ATTACK_SHIPS = frozenset({"scout", "super_ship", "death_star"})

_PLAYER_COLORS = [
    "#e74c3c",  # Red
    "#3b82f6",  # Blue
    "#22c55e",  # Green
    "#f59e0b",  # Amber
    "#e8ff00",  # Neon Yellow
    "#f97316",  # Orange
]

PIECE_SET = {
    "death": 1, "super_ship": 3, "cruise_ship": 6,
    "scout": 9, "outpost": 3, "battle_station": 4,
    "empire_flag": 6, "unrest": 1,
}

# Pieces each player places at game start (empire_flag is auto-placed on core)
START_PIECES = ["battle_station", "scout", "scout"]

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
    {
        "id": "invasion_dice",
        "name": "Orbital Bombardment",
        "timing": "Invasion — Start",
        "effect": "+1 attack die when invading a planet.",
    },
    {
        "id": "command_surge",
        "name": "Command Surge",
        "timing": "Any Time (Your Turn)",
        "effect": "Discard to gain 1 extra action this turn.",
    },
    {
        "id": "plasma_forge",
        "name": "Plasma Forge",
        "timing": "Passive — Rare",
        "effect": "All your d6 attack dice are upgraded to d15.",
        "rare": True,
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

VP_TARGET = 9


def _count_vp(game, player_name: str) -> int:
    planet_vp = sum(
        1 for h in game.board
        if h["local"] == 0
        and h.get("planet") is not None
        and any(p["type"] == "empire_flag" and p["owner"] == player_name for p in h["pieces"])
    )
    p = game.players.get(player_name)
    tech_vp = p.pieces.get("vp", 0) if p else 0
    return planet_vp + tech_vp


def _check_vp_winner(game) -> str | None:
    for n in game.players:
        if _count_vp(game, n) >= VP_TARGET:
            return n
    return None


_SHIP_TYPES     = {"scout", "cruise_ship", "outpost", "super_ship", "battle_station", "death_star"}
_BUILDING_TYPES = {"building_tool", "building_science", "building_money", "farmer_upgrade"}

def _build_endgame_stats(game) -> dict:
    """Return a dict with winner name + per-player summary for the end-game report."""
    winner = game.ancient_winner or _check_vp_winner(game) or next(
        (n for n, p in game.players.items() if n in game.turn_order and p.connected), None
    )

    # Index board: cluster label map and per-player piece counts
    cluster_label = {h["cluster"]: h["label"] for h in game.board if h["local"] == 0}

    stats: dict[str, dict] = {}
    for name, p in game.players.items():
        if p.role == "watcher":
            continue

        # Planets currently owned
        owned_clusters = [
            h["cluster"] for h in game.board
            if h["local"] == 0 and any(pc["type"] == "empire_flag" and pc["owner"] == name for pc in h["pieces"])
        ]
        planets = [cluster_label.get(c, str(c)) for c in owned_clusters]

        # Ships and buildings currently on board
        ships_on_board: dict[str, int] = {}
        buildings_on_board: dict[str, int] = {}
        for h in game.board:
            for pc in h["pieces"]:
                if pc.get("owner") != name:
                    continue
                t = pc["type"]
                if t in _SHIP_TYPES:
                    ships_on_board[t] = ships_on_board.get(t, 0) + 1
                elif t in _BUILDING_TYPES:
                    buildings_on_board[t] = buildings_on_board.get(t, 0) + 1

        # Tech upgrades (count of True across all columns)
        tech_total = sum(1 for levels in p.tech.values() for unlocked in levels if unlocked)
        tech_by_col = {col: sum(1 for u in levels if u) for col, levels in p.tech.items() if any(levels)}

        stats[name] = {
            "vp":              len(planets),
            "planets":         planets,
            "ships_on_board":  ships_on_board,
            "ships_built":     dict(p.ships_built),
            "buildings":       buildings_on_board,
            "tech_upgrades":   tech_total,
            "tech_by_col":     tech_by_col,
            "invasions_won":   p.invasions_won,
            "color":           RACES[p.race]["color"] if p.race else None,
            "race":            p.race,
        }

    return {"winner": winner, "stats": stats}


def _assign_wormholes(hexes: list, positions: list, adj: list) -> None:
    by_cluster: dict = {}
    for h in hexes:
        if h["local"] > 0:
            by_cluster.setdefault(h["cluster"], []).append(h)

    def _facing(ci_xy, hx, hy, cj_xy):
        return (hx - ci_xy[0]) * (cj_xy[0] - ci_xy[0]) \
             + (hy - ci_xy[1]) * (cj_xy[1] - ci_xy[1]) > 0

    all_candidates: dict = {}
    for ci, cj in adj:
        ci_xy = positions[ci]; cj_xy = positions[cj]
        pairs = []
        for hi in by_cluster.get(ci, []):
            if not _facing(ci_xy, hi["x"], hi["y"], cj_xy): continue
            for hj in by_cluster.get(cj, []):
                if not _facing(cj_xy, hj["x"], hj["y"], ci_xy): continue
                d = math.sqrt((hi["x"]-hj["x"])**2 + (hi["y"]-hj["y"])**2)
                pairs.append((d, hi["id"], hj["id"]))
        all_candidates[(ci, cj)] = sorted(pairs)

    def _aug_match(pairs, candidates):
        match_l, match_r = {}, {}
        def _augment(u, seen):
            for v in candidates.get(u, []):
                if v in seen: continue
                seen.add(v)
                if v not in match_r or _augment(match_r[v], seen):
                    match_l[u] = v; match_r[v] = u; return True
            return False
        for u in pairs: _augment(u, set())
        return match_l

    cluster_facing: dict = {}
    for ci, cj in adj:
        ci_hexes = list(dict.fromkeys(ha for _d,ha,hb in all_candidates.get((ci,cj),[])))
        cj_hexes = list(dict.fromkeys(hb for _d,ha,hb in all_candidates.get((ci,cj),[])))
        cluster_facing.setdefault(ci, {})[(ci,cj)] = ci_hexes
        cluster_facing.setdefault(cj, {})[(ci,cj)] = cj_hexes

    assign: dict = {}
    for cluster_idx, pair_cands in cluster_facing.items():
        assign[cluster_idx] = _aug_match(list(pair_cands.keys()), pair_cands)

    for ci, cj in adj:
        ha = assign.get(ci, {}).get((ci, cj))
        hb = assign.get(cj, {}).get((ci, cj))
        if ha is not None and hb is not None:
            hexes[ha]["wormhole"] = True; hexes[ha]["wormhole_partner"] = hb
            hexes[hb]["wormhole"] = True; hexes[hb]["wormhole_partner"] = ha


def _build_wheel_board() -> list[dict]:
    """19-cluster wheel map for 5-6 player games."""
    positions = [
        (_CX,                      _CY),           # 0  center (black_hole)
        (_CX + _DX,                _CY),           # 1  inner-E
        (_CX + _DX//2,             _CY + _DY),     # 2  inner-SE
        (_CX - _DX//2,             _CY + _DY),     # 3  inner-SW
        (_CX - _DX,                _CY),           # 4  inner-W
        (_CX - _DX//2,             _CY - _DY),     # 5  inner-NW
        (_CX + _DX//2,             _CY - _DY),     # 6  inner-NE
        (_CX + 2*_DX,              _CY),           # 7  home-E
        (_CX + _DX,                _CY + 2*_DY),   # 8  home-SE
        (_CX - _DX,                _CY + 2*_DY),   # 9  home-SW
        (_CX - 2*_DX,              _CY),           # 10 home-W
        (_CX - _DX,                _CY - 2*_DY),   # 11 home-NW
        (_CX + _DX,                _CY - 2*_DY),   # 12 home-NE
        (_CX + _DX + _DX//2,       _CY + _DY),     # 13 mid-E-SE
        (_CX,                      _CY + 2*_DY),   # 14 mid-SE-SW
        (_CX - _DX - _DX//2,       _CY + _DY),     # 15 mid-SW-W
        (_CX - _DX - _DX//2,       _CY - _DY),     # 16 mid-W-NW
        (_CX,                      _CY - 2*_DY),   # 17 mid-NW-NE
        (_CX + _DX + _DX//2,       _CY - _DY),     # 18 mid-NE-E
    ]
    colors = [
        "black_hole",
        "red", "blue", "yellow", "red", "blue", "yellow",
        "white", "white", "white", "white", "white", "white",
        "blue", "red", "yellow", "blue", "red", "yellow",
    ]
    labels = [
        "HUB",
        "I-E", "I-SE", "I-SW", "I-W", "I-NW", "I-NE",
        "H-E", "H-SE", "H-SW", "H-W", "H-NW", "H-NE",
        "M-ES", "M-SS", "M-SW", "M-WN", "M-NN", "M-NE",
    ]
    adj = [
        (0, 1), (0, 2), (0, 3), (0, 4), (0, 5), (0, 6),
        (1, 2), (2, 3), (3, 4), (4, 5), (5, 6), (6, 1),
        (1, 7), (2, 8), (3, 9), (4, 10), (5, 11), (6, 12),
        (7, 13), (8, 13),
        (8, 14), (9, 14),
        (9, 15), (10, 15),
        (10, 16), (11, 16),
        (11, 17), (12, 17),
        (12, 18), (7, 18),
    ]

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
                rel = (local_idx - start) % 6
                hex_type = roles[rel]
            is_tri = local_idx == tri_local
            hexes.append({
                "id": hex_id,
                "cluster": cluster_idx,
                "local": local_idx,
                "label": label if local_idx == 0 else "",
                "tri": is_tri,
                "tri_color": center_color if is_tri else "",
                "tri_counts": [random.randint(1, 2), random.randint(2, 4), random.randint(1, 2)] if is_tri else [],
                "tri_farmer_green": False,
                "x": round(cx + ox, 1),
                "y": round(cy + oy, 1),
                "type": hex_type,
                "pieces": [],
                "wormhole": False,
                "wormhole_partner": None,
            })
            hex_id += 1

    _assign_wormholes(hexes, positions, adj)
    return hexes


def _build_board(player_count: int = 2) -> list[dict]:
    if player_count >= 5:
        return _build_wheel_board()
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
        colors += ["yellow", "blue", "red", "yellow"]
        labels += ["020", "021", "022", "023"]
        if player_count == 3:
            # "Weird diamond" — BL bottom-left, BL2 left-mid, UR top-right, TR2 right-upper
            # Layout rows: [N,UR] [NW,NE,TR2] [W,CTR,E] [BL2,SW,SE] [BL,S]
            positions += [
                (_CX - _DX,             _CY + 2*_DY),  # 9  BL  — bottom-left (below S-left)
                (_CX - _DX - _DX//2,    _CY + _DY),    # 10 BL2 — left of SW (unchanged)
                (_CX + _DX,             _CY - 2*_DY),  # 11 UR  — top-right (above N-right)
                (_CX + _DX + _DX//2,    _CY - _DY),    # 12 TR2 — right of NE (unchanged)
            ]
            adj += [
                (6, 9), (8, 9), (9, 10),            # BL — SW, S, BL2
                (3, 10), (6, 10),                    # BL2 — W, SW
                (0, 11), (2, 11), (11, 12),          # UR — N, NE, TR2
                (2, 12), (5, 12),                    # TR2 — NE, E
            ]
        else:
            # Original 3P wing positions — kept intact for 4P build-on
            positions += [
                (_CX - 2*_DX,           _CY),          # 9  BL1 — left of W
                (_CX - _DX - _DX//2,    _CY + _DY),    # 10 BL2 — left of SW
                (_CX + 2*_DX,           _CY),          # 11 TR1 — right of E
                (_CX + _DX + _DX//2,    _CY - _DY),    # 12 TR2 — right of NE
            ]
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
            (_CX + _DX,             _CY - 2*_DY),  # 17 UR  — right of N (top row)
            (_CX - _DX,             _CY + 2*_DY),  # 18 LL  — left of S (bottom row)
        ]
        colors += ["blue", "yellow", "red", "blue", "red", "yellow"]
        labels += ["024", "025", "026", "027", "028", "029"]
        adj += [
            (1, 13), (3, 13), (13, 14), (0, 14), (1, 14),
            (7, 15), (5, 15), (15, 16), (8, 16), (7, 16),
            (0, 17), (2, 17), (12, 17),   # UR — adjacent to N, NE, TR2
            (8, 18), (6, 18), (10, 18),   # LL — adjacent to S, SW, BL2
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
                "tri_counts": [random.randint(1, 2), random.randint(2, 4), random.randint(1, 2)] if is_tri else [],
                "tri_farmer_green": False,
                "x": round(cx + ox, 1),
                "y": round(cy + oy, 1),
                "type": hex_type,
                "pieces": [],
                "wormhole": False,
                "wormhole_partner": None,
            })
            hex_id += 1

    _assign_wormholes(hexes, positions, adj)
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
    "building_money":   {"money": 3},
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
            upkeep["tool"]    += counts[0]
            food = max(1, counts[1] - 1) if h.get("tri_farmer_green") else counts[1]
            upkeep["food"]    += food
            upkeep["science"] += counts[2]
    player.upkeep = dict(upkeep)
    # Apply: resources += income − upkeep.
    # Any negative resource at end of turn adds exactly 1 unrest (regardless of how many are negative).
    any_negative = False
    for key in ("food", "science", "tool", "money"):
        net = player.income.get(key, 0) - upkeep.get(key, 0)
        new_val = player.resources.get(key, 0) + net
        player.resources[key] = new_val
        if new_val < 0:
            any_negative = True
    if any_negative:
        player.resources["unrest"] = player.resources.get("unrest", 0) + 1


def _strip_buildings_from_cluster(game, cluster: int, owner: str) -> dict:
    """Remove all buildings owned by `owner` from `cluster`. Returns dict of income lost."""
    lost: dict[str, int] = {}
    for h in game.board:
        if h["cluster"] != cluster:
            continue
        kept = []
        for p in h.get("pieces", []):
            if p.get("owner") == owner and p.get("type") in _BUILDING_INCOME:
                for res, amt in _BUILDING_INCOME[p["type"]].items():
                    lost[res] = lost.get(res, 0) + amt
            else:
                kept.append(p)
        h["pieces"] = kept
        # Reset farmer upgrade on tri hexes — belongs to the departed owner
        if h.get("tri") and h.get("tri_farmer_green"):
            h["tri_farmer_green"] = False
    return lost


_SKILL_EFFECTS: dict[str, list[dict]] = {
    "biology": [
        {"science": 2, "vp": 0, "income": {"food": 1},    "name": "Hydroponics"},
        {"science": 3, "vp": 0, "income": {"science": 1}, "name": "Chemical Synthesis"},
        {"science": 4, "vp": 1, "income": {"food": 2},    "name": "Soil Enrichment"},
        {"science": 5, "vp": 0, "income": {"tool": 1},    "name": "Organic Chemistry"},
        {"science": 6, "vp": 2, "income": {"science": 2}, "name": "Genetic Mastery"},
    ],
    "physics": [
        {"science": 2, "vp": 0, "income": {}, "name": "Ballistics"},
        {"science": 3, "vp": 0, "income": {}, "name": "Deflector Fields"},
        {"science": 4, "vp": 1, "income": {}, "name": "Plasma Cannons"},
        {"science": 5, "vp": 0, "income": {}, "name": "Quantum Shields"},
        {"science": 6, "vp": 2, "income": {}, "name": "Antimatter Weapons"},
    ],
    "government": [
        {"science": 2, "vp": 0, "income": {}, "name": "Civil Order"},
        {"science": 3, "vp": 0, "income": {}, "name": "Expanded Senate"},
        {"science": 4, "vp": 1, "income": {}, "name": "Martial Command"},
        {"science": 5, "vp": 0, "income": {}, "name": "Pacification Bureau"},
        {"science": 6, "vp": 2, "income": {}, "name": "Imperial Authority"},
    ],
    "engineering": [
        {"science": 2, "vp": 0, "income": {}, "name": "Workshop Efficiency"},
        {"science": 3, "vp": 0, "income": {}, "name": "Shipyard Optimization"},
        {"science": 4, "vp": 1, "income": {}, "name": "Advanced Metallurgy"},
        {"science": 5, "vp": 0, "income": {}, "name": "Modular Construction"},
        {"science": 6, "vp": 2, "income": {}, "name": "Orbital Expansion"},
    ],
}


def _do_elimination(game, name: str) -> None:
    """Strip all pieces belonging to the eliminated player from the board and turn order."""
    for h in game.board:
        h["pieces"] = [p for p in h["pieces"] if p.get("owner") != name]
    if name in game.turn_order:
        game.turn_order.remove(name)


def _advance_turn(game) -> None:
    """Apply income for the current player then advance the turn index."""
    if game.turn_order:
        name = game.turn_order[game.turn_idx % len(game.turn_order)]
        game.explorations.pop(name, None)  # clear exploration reveals when turn ends
        p = game.players.get(name)
        if p:
            _apply_turn_income(game, p)
            if p.resources.get("unrest", 0) >= 20:
                game.eliminated.append(name)
                _do_elimination(game, name)
                # Don't increment turn_idx — removing current player already shifts pointer
                game.turn_actions_remaining = 2 if len(game.turn_order) >= 5 else 3
                return
    game.turn_idx += 1
    _base_actions = 2 if len(game.turn_order) >= 5 else 3
    if game.turn_order:
        _next_name = game.turn_order[game.turn_idx % len(game.turn_order)]
        _next_p = game.players.get(_next_name)
        if _next_p:
            _gov = _next_p.tech.get("government", [])
            if len(_gov) > 1 and _gov[1]: _base_actions += 1  # Lv2 Expanded Senate
            if len(_gov) > 4 and _gov[4]: _base_actions += 1  # Lv5 Imperial Authority
    game.turn_actions_remaining = _base_actions


def _player_planet_count(game, name: str) -> int:
    return sum(
        1 for h in game.board
        if h.get("local") == 0 and h.get("planet")
        and any(p.get("type") == "empire_flag" and p.get("owner") == name
                for p in h.get("pieces", []))
    )


def _planet_def_dice(game, attacker_name: str, planet: dict, gov_tech=None) -> list:
    """Return planet defense dice based on attacker empire size."""
    if planet.get("ancient"):
        return [random.randint(1, 50) for _ in range(3)]
    owned = _player_planet_count(game, attacker_name)
    if gov_tech and len(gov_tech) > 2 and gov_tech[2]:
        # Government Lv3 Martial Command reduces defense by 1 die (min 1)
        reduction = 1
    else:
        reduction = 0
    if owned <= 1:
        n_dice = 2
    elif owned <= 3:
        n_dice = 3
    elif owned <= 5:
        n_dice = 5
    else:
        n_dice = 7
    n_dice = max(1, n_dice - reduction)
    return [random.randint(1, 6) for _ in range(n_dice)]


async def _flush_eliminations(game) -> None:
    """Send personal elimination message to any newly eliminated players."""
    # Eliminate players who once owned a planet but now own none
    for name in list(game.turn_order):
        if name in game.ever_owned_planet and name not in game.eliminated:
            if _player_planet_count(game, name) == 0:
                game.eliminated.append(name)
                _do_elimination(game, name)

    if not game.eliminated:
        return
    for name in list(game.eliminated):
        p = game.players.get(name)
        if p and p.ws:
            try:
                await p.ws.send_json({
                    "type": "eliminated",
                    "msg": "Your inability to govern has made you a failure.",
                })
            except Exception:
                pass
    game.eliminated.clear()
    # If only one player remains, declare them the winner
    remaining = [n for n, p in game.players.items()
                 if n in game.turn_order and p.connected]
    if len(remaining) == 1:
        game.phase = "ended"


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
    role: str        # "host" | "player" | "watcher" | "ai"
    race: str | None = None
    color: str | None = None
    pieces: dict = field(default_factory=dict)
    dice_roll: int = 0
    resources: dict = field(default_factory=dict)   # food, science, tool, money
    income: dict = field(default_factory=dict)       # per-turn gross income per resource
    upkeep: dict = field(default_factory=dict)       # per-turn upkeep (tri hexes)
    tech: dict = field(default_factory=dict)         # column → [bool×5]
    tech_cards: list = field(default_factory=list)   # list of card ids
    action_cards: list = field(default_factory=list) # list of action card ids
    connected: bool = True                           # False when WS is closed but slot is held for rejoin
    ships_built: dict = field(default_factory=dict)  # piece_type → lifetime count built
    invasions_won: int = 0


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
    deferred_groups: list = field(default_factory=list)
    eliminated: list = field(default_factory=list)
    ever_owned_planet: set = field(default_factory=set)
    last_chance: set = field(default_factory=set)  # players who lost their last planet; eliminated at end of next turn if still 0
    ancient_winner: str | None = None
    ai_task: Any = None
    explorations: dict = field(default_factory=dict)  # player_name → set of cluster IDs revealed this turn
    ai_invasion_failures: dict = field(default_factory=dict)  # ai_name → set of clusters that repelled invasion

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
                    "upkeep":     dict(p.upkeep)     if in_board else {},
                    "vp":         _count_vp(self, n) if in_board else 0,
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

    def _visible_clusters(self, player_name: str) -> set:
        """Clusters fully visible to player: own systems + explorations + wormhole-adjacent."""
        visible: set = set()
        home = self.player_system.get(player_name)
        if home is not None:
            visible.add(home)
        for h in self.board:
            if h.get("local") == 0 and any(
                p["type"] == "empire_flag" and p["owner"] == player_name
                for p in h.get("pieces", [])
            ):
                visible.add(h["cluster"])
        visible.update(self.explorations.get(player_name, set()))
        # Wormhole-adjacent clusters are also revealed (terrain + ships)
        adj: set = set()
        for h in self.board:
            if h.get("wormhole") and h["cluster"] in visible:
                pid = h.get("wormhole_partner")
                if pid is not None:
                    adj.add(self.board[pid]["cluster"])
        visible.update(adj)
        return visible

    def _fog_board(self, player_name: str) -> list:
        """Return board filtered for this player; non-visible clusters are fogged."""
        if not FOG_OF_WAR:
            return self.board
        visible = self._visible_clusters(player_name)
        result = []
        for h in self.board:
            if h["cluster"] in visible:
                result.append(h)
            else:
                result.append({
                    "id": h["id"], "cluster": h["cluster"], "local": h["local"],
                    "type": h["type"], "x": h["x"], "y": h["y"],
                    "label": h.get("label"), "tri": h.get("tri", False),
                    "wormhole": h.get("wormhole", False),
                    "wormhole_partner": h.get("wormhole_partner"),
                    "pieces": [], "fog": True,
                })
        return result

    async def broadcast(self, msg: dict, exclude: WebSocket | None = None) -> None:
        self._seq += 1
        msg = {**msg, "seq": self._seq}
        if not FOG_OF_WAR or "board" not in msg:
            targets = list(self.players.values()) + self.watchers
            await asyncio.gather(
                *(p.ws.send_json(msg) for p in targets if p.ws is not None and p.ws is not exclude),
                return_exceptions=True,
            )
            return
        # Personalized board per player; watchers see everything
        tasks = []
        for p in self.players.values():
            if p.ws is None or p.ws is exclude:
                continue
            tasks.append(p.ws.send_json({**msg, "board": self._fog_board(p.name)}))
        for w in self.watchers:
            if w.ws is None or w.ws is exclude:
                continue
            tasks.append(w.ws.send_json(msg))
        await asyncio.gather(*tasks, return_exceptions=True)

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


# ── Dice-round resolution helper ─────────────────────────────────────────────

async def _resolve_dice_round(game: Game) -> None:
    """Resolve a completed dice round. Called after all players in dice_round have rolled."""
    from itertools import groupby

    dice_round = game.dice_round
    rolls = {n: game.players[n].dice_roll for n in dice_round}
    max_roll = max(rolls.values())
    winners = [n for n, r in rolls.items() if r == max_roll]
    losers = sorted(
        [n for n, r in rolls.items() if r != max_roll],
        key=lambda n: rolls[n], reverse=True
    )

    if len(winners) == 1:
        game.turn_order.append(winners[0])
        loser_sorted = sorted(losers, key=lambda n: rolls[n], reverse=True)
        loser_groups = [list(g) for _, g in groupby(loser_sorted, key=lambda n: rolls[n])]
        next_tied: list[str] = []
        found_tie = False
        for group in loser_groups:
            if found_tie:
                game.deferred_groups.append(group)
            elif len(group) == 1:
                game.turn_order.append(group[0])
            else:
                next_tied = group
                found_tie = True
        if next_tied:
            await game.broadcast({"type": "game_state", **game.public_state()})
            await asyncio.sleep(1.5)
            for n in next_tied:
                game.players[n].dice_roll = 0
            game.dice_round = next_tied
            await game.broadcast({"type": "game_state", **game.public_state()})
            return
    else:
        loser_sorted = sorted(losers, key=lambda n: rolls[n], reverse=True)
        loser_groups = [list(g) for _, g in groupby(loser_sorted, key=lambda n: rolls[n])]
        game.deferred_groups = loser_groups + game.deferred_groups
        await game.broadcast({"type": "game_state", **game.public_state()})
        await asyncio.sleep(1.5)
        for n in winners:
            game.players[n].dice_roll = 0
        game.dice_round = winners
        await game.broadcast({"type": "game_state", **game.public_state()})
        return

    # Drain deferred groups
    while game.deferred_groups and len(game.deferred_groups[0]) == 1:
        game.turn_order.append(game.deferred_groups.pop(0)[0])
    if game.deferred_groups:
        next_group = game.deferred_groups.pop(0)
        await game.broadcast({"type": "game_state", **game.public_state()})
        await asyncio.sleep(1.5)
        for n in next_group:
            game.players[n].dice_roll = 0
        game.dice_round = next_group
        await game.broadcast({"type": "game_state", **game.public_state()})
        return

    # All players ordered — transition to place_pieces
    if len(game.turn_order) == len(game.players):
        await game.broadcast({"type": "game_state", **game.public_state()})
        await asyncio.sleep(0.4)
        for p in game.players.values():
            p.pieces = dict(PIECE_SET)
            food = random.randint(4, 10)
            rem = 10 - food
            sci = random.randint(0, rem)
            p.resources = {
                "food": food, "science": sci, "tool": rem - sci,
                "money": random.randint(5, 10),
            }
            p.income = {
                "food": random.randint(0, 2), "science": random.randint(0, 1),
                "tool": random.randint(0, 1), "money": random.randint(1, 3),
            }
            p.tech = {col: [False] * 5 for col in ["biology", "physics", "engineering", "government"]}
            p.action_cards = []
            p.tech_cards = []
        game.board = _build_board(len(game.players))
        bh_cluster = next(
            (h["cluster"] for h in game.board if h["local"] == 0 and h["type"] == "black_hole"), 4
        )
        game.board[bh_cluster * 7 + 1]["pieces"].append({"type": "pirate_base", "owner": "neutral"})
        for name in game.turn_order:
            game.player_placement[name] = list(START_PIECES)
        game.placement_idx = 0
        game.phase = "place_pieces"
        state = game.public_state()
        state["board"] = game.board
        await game.broadcast({"type": "place_pieces_start", **state})


# ── Placement advance helper ──────────────────────────────────────────────────

_NO_TRI_TYPES = {"white", "green"}  # cluster types without a tri hex → dwarf planets

def _add_dwarf_planets(game: Game) -> None:
    """Assign planet data to all unclaimed non-home cluster cores."""
    claimed = set(game.player_system.values())
    for h in game.board:
        if h.get("local") != 0:
            continue
        if h["cluster"] in claimed:
            continue
        t = h["type"]
        if t in _NO_TRI_TYPES:
            h["planet"] = {
                "vp": 0, "unrest": 0,
                "food": 0, "science": 0, "tool": 0, "money": 0,
                "dwarf": True,
            }
        elif t == "black_hole":
            h["planet"] = {
                "vp": 0, "unrest": 0,
                "food": 3, "science": 3, "tool": 3, "money": 3,
                "ancient": True,
            }
        elif t in _TRI_TYPES:
            h["planet"] = {
                "vp": 1, "unrest": random.randint(0, 2),
                "food": random.randint(1, 4),
                "science": random.randint(0, 1),
                "tool": random.randint(0, 2),
                "money": random.randint(1, 3),
            }


def _reveal_dwarf_planet(planet: dict) -> None:
    """Assign a random resource to a dwarf planet on first capture; no-op if already revealed."""
    if not planet.get("dwarf"):
        return
    if any(planet.get(r, 0) > 0 for r in ("food", "science", "tool", "money")):
        return
    res = random.choice(["food", "science", "tool", "money"])
    planet[res] = random.randint(1, 2)


async def _advance_placement(game: Game) -> None:
    """Advance placement_idx; transition to draft if all players placed."""
    game.placement_idx += 1
    if game.placement_idx >= len(game.turn_order):
        _add_dwarf_planets(game)
        _deal_draft(game)
        state = game.public_state()
        state["board"] = game.board
        await game.broadcast({"type": "draft_start", **state})
    else:
        state = game.public_state()
        state["board"] = game.board
        await game.broadcast({"type": "game_state", **state})


# ── AI player helpers ─────────────────────────────────────────────────────────

def _ai_pick_races(game: Game) -> bool:
    """Pick races for any AI players that haven't chosen. Returns True if any changed."""
    changed = False
    for p in game.players.values():
        if p.role != "ai" or p.race:
            continue
        available = [r for r in RACES if r not in game.races_taken]
        if not available:
            continue
        race = random.choice(available)
        p.race = race
        game.races_taken[race] = p.name
        changed = True
    return changed


async def _ai_place_pieces_turn(game: Game) -> None:
    """Place all pieces for the current AI player then advance placement."""
    if game.phase != "place_pieces" or game.placement_idx >= len(game.turn_order):
        return
    current_name = game.turn_order[game.placement_idx]
    p = game.players.get(current_name)
    if not p or p.role != "ai":
        return

    remaining = game.player_placement.get(current_name, [])
    while remaining:
        next_piece = remaining[0]
        if next_piece == "battle_station":
            claimed = set(game.player_system.values())
            n_players = len(game.players)
            if n_players >= 5:
                valid_clusters = list(range(13, 19))
            else:
                valid_clusters = list(range(len(game.board) // 7))
            eligible = []
            for cluster in valid_clusters:
                if cluster in claimed:
                    continue
                if game.board[cluster * 7]["type"] == "black_hole":
                    continue
                if not any(h["tri"] for h in game.board if h["cluster"] == cluster):
                    continue
                orb = next((h for h in game.board if h["cluster"] == cluster and h["type"] == "orbital"), None)
                if orb:
                    eligible.append(orb)
            if not eligible:
                # fallback: any unclaimed orbital
                for h in game.board:
                    if h["type"] == "orbital" and h["cluster"] not in claimed:
                        eligible.append(h)
            if not eligible:
                break
            chosen = random.choice(eligible)
            h = chosen
            h["pieces"].append({"type": "battle_station", "owner": current_name})
            game.player_system[current_name] = h["cluster"]
            core_id = h["cluster"] * 7
            game.board[core_id]["pieces"].append({"type": "empire_flag", "owner": current_name})
            planet = {"vp": 1, "unrest": 0, "food": 2, "science": 1, "tool": 1, "money": 2}
            game.board[core_id]["planet"] = planet
            p.income["food"]    = p.income.get("food",    0) + planet["food"]
            p.income["science"] = p.income.get("science", 0) + planet["science"]
            p.income["tool"]    = p.income.get("tool",    0) + planet["tool"]
            p.income["money"]   = p.income.get("money",   0) + planet["money"]
            # Guarantee first turn isn't negative: bump income to cover tri upkeep
            _tri_h = next((th for th in game.board if th["cluster"] == h["cluster"] and th.get("tri")), None)
            if _tri_h:
                tc = _tri_h.get("tri_counts", [])
                if len(tc) >= 3:
                    for _key, _upkeep in [("tool", tc[0]), ("food", tc[1]), ("science", tc[2])]:
                        if p.income.get(_key, 0) < _upkeep:
                            _delta = _upkeep - p.income.get(_key, 0)
                            p.income[_key] = _upkeep
                            planet[_key] = planet.get(_key, 0) + _delta
                            game.board[core_id]["planet"][_key] = planet[_key]
            p.pieces["battle_station"] = p.pieces.get("battle_station", 1) - 1
            p.pieces["empire_flag"] = p.pieces.get("empire_flag", 1) - 1
            remaining.pop(0)
        elif next_piece == "scout":
            sys_cluster = game.player_system.get(current_name)
            if sys_cluster is None:
                break
            orbitals = [
                h for h in game.board
                if h["cluster"] == sys_cluster and h["type"] == "orbital"
                and sum(1 for pc in h["pieces"] if pc["type"] == "scout") < 3
            ]
            if not orbitals:
                break
            chosen = random.choice(orbitals)
            chosen["pieces"].append({"type": "scout", "owner": current_name})
            p.pieces["scout"] = p.pieces.get("scout", 1) - 1
            remaining.pop(0)
        else:
            break

    game.player_placement[current_name] = remaining
    if not remaining:
        await _advance_placement(game)
    else:
        state = game.public_state()
        state["board"] = game.board
        await game.broadcast({"type": "game_state", **state})


async def _ai_board_action(game: Game, ai_name: str) -> None:
    """Execute one board action for an AI player."""
    ai_p = game.players.get(ai_name)
    if not ai_p:
        return

    # Last-chance check: AI never sends end_turn so the normal handler never runs it.
    # Replicate the same logic here before the AI acts.
    if ai_name in game.last_chance:
        game.last_chance.discard(ai_name)
        if _count_vp(game, ai_name) == 0:
            _do_elimination(game, ai_name)
            game.turn_actions_remaining = 2 if len(game.turn_order) >= 5 else 3
            state = game.public_state()
            state["board"] = game.board
            await game.broadcast({"type": "game_state", **state})
            return

    # Build sets of clusters the AI occupies
    my_clusters: set[int] = set()
    for h in game.board:
        for pc in h["pieces"]:
            if pc.get("owner") == ai_name and pc["type"] in ("empire_flag", "battle_station", "scout"):
                my_clusters.add(h["cluster"])

    # Clusters the AI has at least one scout in
    clusters_with_scouts: set[int] = {
        h["cluster"]
        for h in game.board
        for pc in h["pieces"]
        if pc["type"] == "scout" and pc["owner"] == ai_name
    }

    # Find wormhole routes from AI clusters where AI has a scout anywhere in the cluster
    expand_routes = []
    seen_dest: set[int] = set()
    for h in game.board:
        if h.get("wormhole_partner") is None:
            continue
        if h["cluster"] not in my_clusters:
            continue
        if h["cluster"] not in clusters_with_scouts:
            continue
        dest_h = game.board[h["wormhole_partner"]]
        dest_cluster = dest_h["cluster"]
        if dest_cluster in seen_dest:
            continue
        landing = next(
            (dh for dh in game.board
             if dh["cluster"] == dest_cluster and dh["type"] == "orbital"
             and sum(1 for pc in dh["pieces"] if pc["type"] == "scout") < 3),
            None
        )
        if landing:
            expand_routes.append({"from_wh": h["id"], "to_wh": h["wormhole_partner"], "dest_cluster": dest_cluster})
            seen_dest.add(dest_cluster)

    # Split into attack vs unclaimed expand
    def has_enemy_frigates(cluster: int) -> bool:
        return any(
            pc["type"] == "scout" and pc["owner"] != ai_name
            for dh in game.board if dh["cluster"] == cluster
            for pc in dh["pieces"]
        )

    attack_routes = [r for r in expand_routes if has_enemy_frigates(r["dest_cluster"])]
    plain_expand = [r for r in expand_routes if not has_enemy_frigates(r["dest_cluster"]) and r["dest_cluster"] not in my_clusters]

    failed_clusters = game.ai_invasion_failures.get(ai_name, set())

    # 1. Try invasion_attack in a cluster AI already has frigates and planet is not owned
    for h in game.board:
        if h.get("local") != 0 or h["cluster"] not in my_clusters:
            continue
        planet = h.get("planet")
        if not planet:
            continue
        already_mine = any(pc["type"] == "empire_flag" and pc["owner"] == ai_name for pc in h["pieces"])
        if already_mine:
            continue
        if h["cluster"] in failed_clusters:
            continue
        enemy_ships = has_enemy_frigates(h["cluster"])
        if enemy_ships:
            continue
        my_frigates = [
            pc for dh in game.board if dh["cluster"] == h["cluster"]
            for pc in dh["pieces"] if pc["type"] == "scout" and pc["owner"] == ai_name
        ]
        if not my_frigates:
            continue
        # Perform invasion_attack directly
        cluster = h["cluster"]
        num_dice = min(len(my_frigates), 3)
        atk_dice = [random.randint(1, 6) for _ in range(num_dice)]
        atk_total = sum(atk_dice)
        planet_dice = _planet_def_dice(game, ai_name, planet)
        planet_total = sum(planet_dice)
        won = atk_total > planet_total
        if won:
            prev_owner = next(
                (pc["owner"] for pc in h.get("pieces", []) if pc["type"] == "empire_flag"), None
            )
            h["pieces"] = [pc for pc in h.get("pieces", []) if pc["type"] != "empire_flag"]
            h["pieces"].append({"type": "empire_flag", "owner": ai_name})
            game.ever_owned_planet.add(ai_name)
            if prev_owner and prev_owner != ai_name:
                prev_p = game.players.get(prev_owner)
                if prev_p:
                    for _k in ("food", "science", "tool", "money"):
                        prev_p.income[_k] = max(0, prev_p.income.get(_k, 0) - planet.get(_k, 0))
                    lost = _strip_buildings_from_cluster(game, cluster, prev_owner)
                    for _k, _amt in lost.items():
                        prev_p.income[_k] = max(0, prev_p.income.get(_k, 0) - _amt)
                    if _count_vp(game, prev_owner) == 0:
                        game.last_chance.add(prev_owner)
            _reveal_dwarf_planet(planet)
            for _k in ("food", "science", "tool", "money"):
                ai_p.income[_k] = ai_p.income.get(_k, 0) + planet.get(_k, 0)
        else:
            for dh in game.board:
                if dh["cluster"] == cluster:
                    dh["pieces"] = [pc for pc in dh["pieces"] if not (pc["type"] == "scout" and pc["owner"] == ai_name)]
            game.ai_invasion_failures.setdefault(ai_name, set()).add(cluster)
        if won:
            ai_p.invasions_won += 1
        _use_action(game)
        await _flush_eliminations(game)
        if won and _check_vp_winner(game):
            game.phase = "ended"
        state = game.public_state()
        state["board"] = game.board
        await game.broadcast({
            "type": "invasion_result",
            "attacker": ai_name,
            "cluster": cluster,
            "atk_dice": atk_dice,
            "planet_dice": planet_dice,
            "atk_total": atk_total,
            "planet_total": planet_total,
            "won": won,
            "planet": planet,
            **({"game_over": _build_endgame_stats(game)} if game.phase == "ended" else {}),
            **state,
        })
        return

    # 2. Expand to unclaimed cluster
    if plain_expand:
        r = random.choice(plain_expand)
        _ai_do_flight(game, ai_name, r["from_wh"], r["to_wh"])
        _use_action(game)
        await _flush_eliminations(game)
        state = game.public_state()
        state["board"] = game.board
        await game.broadcast({"type": "game_state", **state})
        return

    # 3. Attack enemy cluster
    if attack_routes:
        r = random.choice(attack_routes)
        moved = _ai_do_flight(game, ai_name, r["from_wh"], r["to_wh"])
        if moved:
            dest_cluster = r["dest_cluster"]
            enemy_frigates = [
                {"owner": pc["owner"], "hex_id": dh["id"]}
                for dh in game.board if dh["cluster"] == dest_cluster
                for pc in dh["pieces"] if pc["type"] == "scout" and pc["owner"] != ai_name
            ]
            if enemy_frigates:
                defender_name = enemy_frigates[0]["owner"]
                atk_count = sum(
                    1 for dh in game.board if dh["cluster"] == dest_cluster
                    for pc in dh["pieces"] if pc["type"] == "scout" and pc["owner"] == ai_name
                )
                def_count = sum(1 for ef in enemy_frigates if ef["owner"] == defender_name)
                atk_dice = [random.randint(1, 6) for _ in range(max(1, atk_count))]
                def_dice = [random.randint(1, 6) for _ in range(max(1, def_count))]
                atk_total = sum(atk_dice)
                def_total = sum(def_dice)
                attacker_won = atk_total > def_total
                target_hex_id = enemy_frigates[0]["hex_id"]
                if attacker_won:
                    t_hex = game.board[target_hex_id]
                    for i, pc in enumerate(t_hex["pieces"]):
                        if pc["type"] == "scout" and pc["owner"] == defender_name:
                            t_hex["pieces"].pop(i)
                            break
                else:
                    for dh in game.board:
                        if dh["cluster"] != dest_cluster:
                            continue
                        for i, pc in enumerate(dh["pieces"]):
                            if pc["type"] == "scout" and pc["owner"] == ai_name:
                                dh["pieces"].pop(i)
                                break
                        else:
                            continue
                        break
                _use_action(game)
                await _flush_eliminations(game)
                state = game.public_state()
                state["board"] = game.board
                await game.broadcast({
                    "type": "combat_result",
                    "attacker": ai_name,
                    "defender": defender_name,
                    "attacker_won": attacker_won,
                    "winner": ai_name if attacker_won else defender_name,
                    "atk_dice": atk_dice,
                    "def_dice": def_dice,
                    "atk_total": atk_total,
                    "def_total": def_total,
                    **state,
                })
                return
        _use_action(game)
        await _flush_eliminations(game)
        state = game.public_state()
        state["board"] = game.board
        await game.broadcast({"type": "game_state", **state})
        return

    # 4. Build frigate if affordable
    sys_cluster = game.player_system.get(ai_name)
    if sys_cluster is not None:
        cost = {"food": 2, "tool": 1}
        can_afford = all(ai_p.resources.get(r, 0) >= v for r, v in cost.items())
        avail_orbs = [
            h for h in game.board
            if h["cluster"] == sys_cluster and h["type"] == "orbital"
            and sum(1 for pc in h["pieces"] if pc["type"] == "scout") < 3
        ]
        if can_afford and avail_orbs and ai_p.pieces.get("scout", 0) > 0 and _player_planet_count(game, ai_name) > 0:
            chosen = random.choice(avail_orbs)
            chosen["pieces"].append({"type": "scout", "owner": ai_name})
            ai_p.pieces["scout"] = ai_p.pieces.get("scout", 1) - 1
            for r, v in cost.items():
                ai_p.resources[r] = ai_p.resources.get(r, 0) - v
            _use_action(game)
            await _flush_eliminations(game)
            state = game.public_state()
            state["board"] = game.board
            await game.broadcast({"type": "game_state", **state})
            return

    # 5. No action found — reset invasion failure memory so the AI can retry next turn
    if game.ai_invasion_failures.get(ai_name):
        game.ai_invasion_failures[ai_name] = set()
    _use_action(game)
    await _flush_eliminations(game)
    state = game.public_state()
    state["board"] = game.board
    await game.broadcast({"type": "game_state", **state})


def _ai_do_flight(game: Game, ai_name: str, from_wh: int, to_wh: int) -> bool:
    """Move all available AI frigates via wormhole (up to landing cap). Returns True if at least one moved."""
    from_hex = game.board[from_wh]
    to_hex = game.board[to_wh]
    from_cluster = from_hex["cluster"]
    dest_cluster = to_hex["cluster"]
    moved = False
    for _ in range(3):  # landing orbitals cap at 3 scouts each
        landing = next(
            (h for h in game.board
             if h["cluster"] == dest_cluster and h["type"] == "orbital"
             and sum(1 for pc in h["pieces"] if pc["type"] == "scout") < 3),
            None
        )
        if not landing:
            break
        moved_piece = None
        for h in game.board:
            if h["cluster"] != from_cluster:
                continue
            for i, pc in enumerate(h["pieces"]):
                if pc["type"] == "scout" and pc["owner"] == ai_name:
                    moved_piece = h["pieces"].pop(i)
                    break
            if moved_piece:
                break
        if not moved_piece:
            break
        landing["pieces"].append(moved_piece)
        moved = True
    return moved


async def _ai_loop(game: Game) -> None:
    """Background coroutine that drives all AI players through the full game lifecycle."""
    await asyncio.sleep(1.5)
    while game.phase not in ("ended", "lobby"):
        try:
            if game.phase == "dice_roll":
                changed = False
                for name in list(game.dice_round):
                    p = game.players.get(name)
                    if p and p.role == "ai" and p.dice_roll == 0:
                        p.dice_roll = random.randint(1, 6) + random.randint(1, 6)
                        changed = True
                if changed:
                    all_rolled = all(game.players[n].dice_roll != 0 for n in game.dice_round)
                    if all_rolled:
                        await _resolve_dice_round(game)
                    else:
                        await game.broadcast({"type": "game_state", **game.public_state()})

            elif game.phase == "place_pieces":
                await _ai_place_pieces_turn(game)

            elif game.phase == "board" and not game.pending_combat:
                if game.turn_order:
                    current = game.turn_order[game.turn_idx % len(game.turn_order)]
                    p = game.players.get(current)
                    if p and p.role == "ai":
                        await _ai_board_action(game, current)

        except Exception:
            pass
        await asyncio.sleep(2.0)


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
                if len(g.players) >= 6:
                    await ws.send_json({"type": "error", "msg": "Game is full (max 6)"})
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
                if any(p.role == "ai" for p in game.players.values()):
                    game.ai_task = asyncio.create_task(_ai_loop(game))

            # ── pick_color ────────────────────────────────────────────────────
            elif kind == "pick_color":
                if not game or not player:
                    continue
                if game.phase != "lobby":
                    continue
                color = raw.get("color")
                if color not in _PLAYER_COLORS:
                    await ws.send_json({"type": "error", "msg": "Invalid color"})
                    continue
                if any(p.color == color and p.name != player.name for p in game.players.values()):
                    await ws.send_json({"type": "error", "msg": "Color already taken"})
                    continue
                player.color = color
                await game.broadcast({"type": "game_state", **game.public_state()})

            # ── add_ai ────────────────────────────────────────────────────────
            elif kind == "add_ai":
                if not game or not player:
                    continue
                if player.role != "host" or game.phase != "lobby":
                    await ws.send_json({"type": "error", "msg": "Only host can add AI in lobby"})
                    continue
                ai_count = sum(1 for p in game.players.values() if p.role == "ai")
                if len(game.players) >= 6:
                    await ws.send_json({"type": "error", "msg": "Game is full (max 6)"})
                    continue
                if ai_count >= 5:
                    await ws.send_json({"type": "error", "msg": "Max 5 AI players"})
                    continue
                used_names = {p.name for p in game.players.values()}
                ai_name = next((n for n in _AI_NAMES if n not in used_names), None)
                if ai_name is None:
                    await ws.send_json({"type": "error", "msg": "No AI names available"})
                    continue
                ai_player = Player(ws=None, name=ai_name, role="ai", connected=True)
                game.players[ai_name] = ai_player
                await game.broadcast({"type": "game_state", **game.public_state()})

            # ── remove_ai ─────────────────────────────────────────────────────
            elif kind == "remove_ai":
                if not game or not player:
                    continue
                if player.role != "host" or game.phase != "lobby":
                    await ws.send_json({"type": "error", "msg": "Only host can remove AI in lobby"})
                    continue
                name = raw.get("name")
                ai_p = game.players.get(name)
                if not ai_p or ai_p.role != "ai":
                    await ws.send_json({"type": "error", "msg": "No such AI player"})
                    continue
                del game.players[name]
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
                    # Assign races to AI players now (on Launch Game click, not before)
                    _ai_pick_races(game)
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
                    await game.broadcast({"type": "game_state", **game.public_state()})
                    continue
                await _resolve_dice_round(game)

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
                    if h["type"] != "orbital":
                        await ws.send_json({"type": "error", "msg": "Battle station must be placed on an orbital hex"})
                        continue
                    # Must be a system that contains a triangle tile
                    has_tri = any(h2["tri"] for h2 in game.board if h2["cluster"] == h["cluster"])
                    if not has_tri:
                        await ws.send_json({"type": "error", "msg": "Battle station may only be placed in systems with a triangle tile"})
                        continue
                    # 5-6P wheel map: home cluster must be one of the 6 outer mid-clusters (13-18)
                    if len(game.players) >= 5 and h["cluster"] not in range(13, 19):
                        await ws.send_json({"type": "error", "msg": "In 5-6P games, your home system must be one of the 6 outer mid-clusters"})
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
                    planet = {"vp": 1, "unrest": 0, "food": 2, "science": 1, "tool": 1, "money": 2}
                    game.board[core_id]["planet"] = planet
                    player.income["food"]    = player.income.get("food",    0) + planet["food"]
                    player.income["science"] = player.income.get("science", 0) + planet["science"]
                    player.income["tool"]    = player.income.get("tool",    0) + planet["tool"]
                    player.income["money"]   = player.income.get("money",   0) + planet["money"]
                    # Guarantee first turn isn't negative: bump income to cover tri upkeep
                    _tri_h = next((th for th in game.board if th["cluster"] == h["cluster"] and th.get("tri")), None)
                    if _tri_h:
                        tc = _tri_h.get("tri_counts", [])
                        if len(tc) >= 3:
                            for _key, _upkeep in [("tool", tc[0]), ("food", tc[1]), ("science", tc[2])]:
                                if player.income.get(_key, 0) < _upkeep:
                                    _delta = _upkeep - player.income.get(_key, 0)
                                    player.income[_key] = _upkeep
                                    planet[_key] = planet.get(_key, 0) + _delta
                                    game.board[core_id]["planet"][_key] = planet[_key]
                    player.pieces["battle_station"] = player.pieces.get("battle_station", 1) - 1
                    player.pieces["empire_flag"] = player.pieces.get("empire_flag", 1) - 1
                elif next_piece == "scout":
                    sys_cluster = game.player_system.get(player.name)
                    if sys_cluster is None:
                        await ws.send_json({"type": "error", "msg": "Place battle station first"})
                        continue
                    if h["cluster"] != sys_cluster:
                        await ws.send_json({"type": "error", "msg": "Must place within your system"})
                        continue
                    if h["type"] != "orbital":
                        await ws.send_json({"type": "error", "msg": "Scouts must be placed on scout tiles (orbital hexes)"})
                        continue
                    if sum(1 for p in h["pieces"] if p["type"] in _MOBILE_SHIPS) >= 3:
                        await ws.send_json({"type": "error", "msg": "That tile is full (max 3 ships)"})
                        continue
                    h["pieces"].append({"type": "scout", "owner": player.name})
                    player.pieces["scout"] = player.pieces.get("scout", 1) - 1
                else:
                    await ws.send_json({"type": "error", "msg": "Unknown piece type"})
                    continue
                game.player_placement[player.name].pop(0)

                # Auto-advance when this player's queue is empty
                if not game.player_placement.get(player.name):
                    await _advance_placement(game)
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
                await _advance_placement(game)

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
                # Last-chance check: player had their last planet taken — if still at 0, eliminate
                if player.name in game.last_chance:
                    game.last_chance.discard(player.name)
                    if _count_vp(game, player.name) == 0:
                        game.eliminated.append(player.name)
                        _do_elimination(game, player.name)
                        game.turn_actions_remaining = 2 if len(game.turn_order) >= 5 else 3
                        state = game.public_state()
                        state["board"] = game.board
                        await game.broadcast({"type": "game_state", **state})
                        continue
                # Spend unused actions drawing tech cards
                drawn: list[dict] = []
                for _ in range(game.turn_actions_remaining):
                    card = random.choice(TECH_CARDS)
                    player.tech_cards.append(card["id"])
                    drawn.append({"id": card["id"], "name": card["name"]})
                _advance_turn(game)
                state = game.public_state()
                state["board"] = game.board
                if drawn:
                    await game.send_to(player.name, {"type": "bonus_tech_drawn", "cards": drawn})
                await game.broadcast({"type": "game_state", **state})

            # ── exploration ───────────────────────────────────────────────────
            elif kind == "exploration":
                if not game or not player:
                    continue
                if game.phase != "board" or not game.turn_order:
                    continue
                current = game.turn_order[game.turn_idx % len(game.turn_order)]
                if player.name != current:
                    continue
                if not FOG_OF_WAR:
                    await ws.send_json({"type": "error", "msg": "Fog of war is disabled"})
                    continue
                target_cluster = raw.get("cluster")
                if target_cluster is None:
                    continue
                visible = game._visible_clusters(player.name)
                # Must be wormhole-adjacent to a visible cluster but not already visible
                reachable = set()
                for h in game.board:
                    if h.get("wormhole") and h["cluster"] in visible:
                        pid = h.get("wormhole_partner")
                        if pid is not None:
                            adj = game.board[pid]["cluster"]
                            if adj not in visible:
                                reachable.add(adj)
                if target_cluster not in reachable:
                    await ws.send_json({"type": "error", "msg": "Cannot explore that system"})
                    continue
                game.explorations.setdefault(player.name, set()).add(target_cluster)
                _use_action(game)
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
                if _player_planet_count(game, player.name) == 0:
                    await ws.send_json({"type": "error", "msg": "You need at least one planet to build"})
                    continue
                piece_type = raw.get("piece_type")
                hex_id     = raw.get("hex_id")
                COSTS = {
                    "cruise_ship":      {"money": 10},
                    "scout":          {"money": 10, "tool": 2},
                    "outpost":          {"money": 25, "tool": 4},
                    "super_ship":       {"money": 50, "tool": 8},
                    "battle_station":   {"money": 60, "tool": 12},
                    "death_star":       {"money": 100, "tool": 20},
                    "building_tool":    {"money": 4},
                    "building_science": {"money": 4},
                    "building_money":   {"money": 6},
                    "farmer_upgrade":   {"tool": 3},
                }
                cost = COSTS.get(piece_type)
                if cost is None:
                    await ws.send_json({"type": "error", "msg": "Unknown piece type"})
                    continue
                money_cost = cost.get("money", 0)
                tool_cost  = cost.get("tool", 0)
                # Engineering discounts
                _eng = player.tech.get("engineering", [])
                _building_types_set = set(_BUILDING_INCOME)
                _spacecraft_types_set = {"cruise_ship", "scout", "outpost", "super_ship", "battle_station", "death_star"}
                if piece_type in _building_types_set:
                    if len(_eng) > 0 and _eng[0]: money_cost = max(1, money_cost - 1)  # Lv1
                    # Scale cost by empire size: base × max(1, planets_owned)
                    money_cost *= max(1, _player_planet_count(game, player.name))
                elif piece_type in _spacecraft_types_set:
                    if len(_eng) > 1 and _eng[1]: money_cost = max(1, money_cost - 2)  # Lv2
                    if len(_eng) > 2 and _eng[2]: tool_cost  = max(0, tool_cost  - 1)  # Lv3
                money = player.resources.get("money", 0)
                tools = player.resources.get("tool", 0)
                if money < money_cost:
                    await ws.send_json({"type": "error", "msg": f"Not enough money (need {money_cost}, have {money})"})
                    continue
                if tools < tool_cost:
                    await ws.send_json({"type": "error", "msg": f"Not enough tools (need {tool_cost}, have {tools})"})
                    continue
                player_cluster = game.player_system.get(player.name)
                if piece_type == "farmer_upgrade":
                    player_owned_clusters_fu = {player_cluster} | {
                        h["cluster"] for h in game.board
                        for p in h.get("pieces", [])
                        if p["type"] == "empire_flag" and p["owner"] == player.name
                    }
                    if hex_id is not None and 0 <= hex_id < len(game.board):
                        tri_hex = game.board[hex_id]
                        if not tri_hex.get("tri"):
                            await ws.send_json({"type": "error", "msg": "Must place Farmer Upgrade on a farm triangle hex"})
                            continue
                        if tri_hex["cluster"] not in player_owned_clusters_fu:
                            await ws.send_json({"type": "error", "msg": "Must build in a system you own"})
                            continue
                    else:
                        tri_hex = next(
                            (h for h in game.board if h.get("tri") and h["cluster"] == player_cluster),
                            None
                        )
                    if tri_hex is None:
                        await ws.send_json({"type": "error", "msg": "No triangle hex in your system"})
                        continue
                    if tri_hex.get("tri_farmer_green"):
                        await ws.send_json({"type": "error", "msg": "Farmer upgrade already applied"})
                        continue
                    tri_hex["tri_farmer_green"] = True
                    player.resources["tool"] = tools - tool_cost
                    _use_action(game)
                    await _flush_eliminations(game)
                    state = game.public_state()
                    state["board"] = game.board
                    await game.broadcast({"type": "game_state", **state})
                    continue
                if not (0 <= hex_id < len(game.board)):
                    await ws.send_json({"type": "error", "msg": "Invalid hex"})
                    continue
                target_hex = game.board[hex_id]
                player_owned_clusters = {player_cluster} | {
                    h["cluster"] for h in game.board
                    for p in h.get("pieces", [])
                    if p["type"] == "empire_flag" and p["owner"] == player.name
                }
                if target_hex["cluster"] not in player_owned_clusters or target_hex["local"] == 0:
                    await ws.send_json({"type": "error", "msg": "Must build in a system you own"})
                    continue
                _building_types = set(_BUILDING_INCOME)
                _spacecraft_types = {"cruise_ship", "scout", "outpost", "super_ship", "battle_station", "death_star"}
                if piece_type in _building_types:
                    if target_hex["type"] != "bs_slot":
                        await ws.send_json({"type": "error", "msg": "Buildings must be placed on the light blue hex"})
                        continue
                    existing = [p for p in target_hex["pieces"] if p["type"] in _building_types]
                    _bld_cap = 4 if (len(_eng) > 3 and _eng[3]) else 3  # Lv4 Modular Construction
                    if len(existing) >= _bld_cap:
                        await ws.send_json({"type": "error", "msg": f"That tile already has {_bld_cap} buildings (max)"})
                        continue
                else:
                    if target_hex["type"] != "orbital":
                        await ws.send_json({"type": "error", "msg": "Spacecraft must be placed on an orbital hex"})
                        continue
                    spacecraft_count = sum(1 for p in target_hex["pieces"] if p["type"] in _spacecraft_types)
                    _orb_cap = 4 if (len(_eng) > 4 and _eng[4]) else 3  # Lv5 Orbital Expansion
                    if spacecraft_count >= _orb_cap:
                        await ws.send_json({"type": "error", "msg": f"That orbital tile is full (max {_orb_cap} spacecraft)"})
                        continue
                player.resources["money"] = money - money_cost
                if tool_cost:
                    player.resources["tool"] = tools - tool_cost
                target_hex["pieces"].append({"type": piece_type, "owner": player.name})
                player.ships_built[piece_type] = player.ships_built.get(piece_type, 0) + 1
                # Buildings add to permanent income so the display is correct immediately
                for _bkey, _bamt in _BUILDING_INCOME.get(piece_type, {}).items():
                    player.income[_bkey] = player.income.get(_bkey, 0) + _bamt
                _use_action(game)
                await _flush_eliminations(game)
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
                            if p["type"] in _MOBILE_SHIPS and p["owner"] == player.name:
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
                # Prefer the specific orbital the player clicked, fall back to first available
                req_id = raw.get("target_hex_id")
                landing_hex = None
                if req_id is not None and 0 <= req_id < len(game.board):
                    rh = game.board[req_id]
                    if (rh["cluster"] == dest_cluster and rh["type"] == "orbital"
                            and sum(1 for p in rh["pieces"] if p["type"] in _MOBILE_SHIPS) < 3):
                        landing_hex = rh
                if landing_hex is None:
                    landing_hex = next(
                        (h for h in game.board
                         if h["cluster"] == dest_cluster and h["type"] == "orbital"
                         and sum(1 for p in h["pieces"] if p["type"] in _MOBILE_SHIPS) < 3),
                        None)
                if landing_hex is None:
                    await ws.send_json({"type": "error", "msg": "No available ship tiles in that system"})
                    continue
                moved_piece = None
                for h in game.board:
                    if h["cluster"] != from_cluster:
                        continue
                    for i, p in enumerate(h["pieces"]):
                        if p["type"] in _MOBILE_SHIPS and p["owner"] == player.name:
                            moved_piece = h["pieces"].pop(i)
                            break
                    if moved_piece:
                        break
                if not moved_piece:
                    await ws.send_json({"type": "error", "msg": "No ship to move"})
                    continue
                landing_hex["pieces"].append(moved_piece)
                game.pending_combat = None
                _use_action(game)
                await _flush_eliminations(game)
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
                target_hex_id = raw.get("target_hex_id")
                if from_cluster is None or target_hex_id is None:
                    continue
                if not (0 <= target_hex_id < len(game.board)):
                    await ws.send_json({"type": "error", "msg": "Invalid target hex."})
                    continue
                dest_cluster = game.board[target_hex_id]["cluster"]
                atk_frigates = [
                    p for h in game.board if h["cluster"] == from_cluster
                    for p in h.get("pieces", [])
                    if p["type"] in _ATTACK_SHIPS and p["owner"] == player.name
                ]
                if not atk_frigates:
                    await ws.send_json({"type": "error", "msg": "No attack-capable ships in that system."})
                    continue
                atk_frigate_count = len(atk_frigates)
                connected = from_cluster == dest_cluster or any(
                    game.board[h["wormhole_partner"]]["cluster"] == dest_cluster
                    for h in game.board
                    if h["cluster"] == from_cluster and h.get("wormhole") and h.get("wormhole_partner") is not None
                )
                if not connected:
                    await ws.send_json({"type": "error", "msg": "Systems not wormhole-connected."})
                    continue
                target_hex = game.board[target_hex_id]
                def_frigates_on_hex = [
                    p for p in target_hex.get("pieces", [])
                    if p["type"] in _MOBILE_SHIPS and p["owner"] != player.name
                ]
                if not def_frigates_on_hex:
                    await ws.send_json({"type": "error", "msg": "No enemy ships on that hex."})
                    continue
                def_frigate_count = len([p for p in def_frigates_on_hex if p["type"] != "cruise_ship"])
                def_cruise_count  = len([p for p in def_frigates_on_hex if p["type"] == "cruise_ship"])
                defender_name = def_frigates_on_hex[0]["owner"]
                game.pending_combat = {
                    "type": "attack",
                    "attacker": player.name,
                    "defender": defender_name,
                    "from_cluster": from_cluster,
                    "dest_cluster": dest_cluster,
                    "target_hex_id": target_hex_id,
                    "atk_frigate_count": atk_frigate_count,
                    "def_frigate_count": def_frigate_count,
                    "def_cruise_count": def_cruise_count,
                    "atk_rolled": False,
                    "def_rolled": False,
                    "atk_dice": [],
                    "def_dice": [],
                }
                state = game.public_state()
                state["board"] = game.board
                await game.broadcast({"type": "game_state", **state}, exclude=ws)
                await ws.send_json({"type": "combat_prompt", "dest_cluster": dest_cluster,
                                    "attacker": player.name, "tech_cards": player.tech_cards,
                                    "atk_frigate_count": atk_frigate_count,
                                    "def_frigate_count": def_frigate_count, **state})
                def_p = game.players.get(defender_name)
                if def_p and def_p.ws:
                    await def_p.ws.send_json({"type": "combat_defender_prompt",
                                               "dest_cluster": dest_cluster,
                                               "attacker": player.name,
                                               "atk_frigate_count": atk_frigate_count,
                                               "def_frigate_count": def_frigate_count, **state})

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
                    atk_dice_count = combat["atk_frigate_count"]
                    if tech_card == "nuclear_missile": atk_dice_count += 1
                    _atk_phys = game.players.get(attacker_name)
                    _atk_phys = (_atk_phys.tech.get("physics", []) if _atk_phys else [])
                    if len(_atk_phys) > 0 and _atk_phys[0]: atk_dice_count += 1  # Lv1 Ballistics
                    if len(_atk_phys) > 2 and _atk_phys[2]: atk_dice_count += 1  # Lv3 Plasma Cannons
                    if len(_atk_phys) > 4 and _atk_phys[4]: atk_dice_count += 1  # Lv5 Antimatter Weapons
                    atk_dice = [random.randint(1, 6) for _ in range(atk_dice_count)]
                    combat["atk_dice"]  = atk_dice
                    combat["atk_total"] = sum(atk_dice)
                    combat["atk_rolled"] = True
                    # Auto-roll defense for AI defender so combat doesn't freeze
                    def_p = game.players.get(defender_name)
                    if def_p and def_p.role == "ai" and not combat["def_rolled"]:
                        _def_phys = def_p.tech.get("physics", [])
                        def_dice_count = combat["def_frigate_count"]
                        if len(_def_phys) > 1 and _def_phys[1]: def_dice_count += 1
                        if len(_def_phys) > 3 and _def_phys[3]: def_dice_count += 1
                        def_dice = (
                            [random.randint(1, 6)  for _ in range(max(1, def_dice_count))] +
                            [random.randint(1, 12) for _ in range(combat.get("def_cruise_count", 0))]
                        )
                        combat["def_dice"]  = def_dice
                        combat["def_total"] = sum(def_dice)
                        combat["def_rolled"] = True
                    await game.broadcast({
                        "type": "combat_attacker_rolled",
                        "attacker": attacker_name,
                        "defender": defender_name,
                        "atk_dice": atk_dice,
                        "atk_total": combat["atk_total"],
                        "dest_cluster": dest_cluster,
                    })

                elif not is_attacker and player.name == defender_name and not combat["def_rolled"]:
                    _def_phys = player.tech.get("physics", [])
                    def_dice_count = combat["def_frigate_count"]
                    if len(_def_phys) > 1 and _def_phys[1]: def_dice_count += 1
                    if len(_def_phys) > 3 and _def_phys[3]: def_dice_count += 1
                    def_dice = (
                        [random.randint(1, 6)  for _ in range(max(0, def_dice_count))] +
                        [random.randint(1, 12) for _ in range(combat.get("def_cruise_count", 0))]
                    )
                    combat["def_dice"]  = def_dice
                    combat["def_total"] = sum(def_dice)
                    combat["def_rolled"] = True

                if combat["atk_rolled"] and combat["def_rolled"]:
                    atk_total = combat["atk_total"]
                    def_total = combat["def_total"]
                    attacker_won = atk_total > def_total
                    from_cluster = combat.get("from_cluster", dest_cluster)
                    if attacker_won:
                        t_hex = game.board[combat["target_hex_id"]]
                        for i, p in enumerate(t_hex["pieces"]):
                            if p["type"] in _MOBILE_SHIPS and p["owner"] == defender_name:
                                t_hex["pieces"].pop(i)
                                break
                    else:
                        for h in game.board:
                            if h["cluster"] != from_cluster:
                                continue
                            for i, p in enumerate(h["pieces"]):
                                if p["type"] in _MOBILE_SHIPS and p["owner"] == attacker_name:
                                    h["pieces"].pop(i)
                                    break
                            else:
                                continue
                            break
                    game.pending_combat = None
                    _use_action(game)
                    await _flush_eliminations(game)
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
                # Find and move a ship from from_hex's cluster
                from_cluster = from_hex["cluster"]
                req_id = raw.get("target_hex_id")
                landing_hex = None
                if req_id is not None and 0 <= req_id < len(game.board):
                    rh = game.board[req_id]
                    if (rh["cluster"] == dest_cluster and rh["type"] == "orbital"
                            and sum(1 for p in rh["pieces"] if p["type"] in _MOBILE_SHIPS) < 3):
                        landing_hex = rh
                if landing_hex is None:
                    landing_hex = next(
                        (h for h in game.board
                         if h["cluster"] == dest_cluster and h["type"] == "orbital"
                         and sum(1 for p in h["pieces"] if p["type"] in _MOBILE_SHIPS) < 3),
                        None)
                # If all orbitals are full, land on the wormhole entry hex so invasion can still proceed
                if landing_hex is None:
                    landing_hex = to_hex
                moved_piece = None
                for h in game.board:
                    if h["cluster"] != from_cluster:
                        continue
                    for i, p in enumerate(h["pieces"]):
                        if p["type"] in _MOBILE_SHIPS and p["owner"] == player.name:
                            moved_piece = h["pieces"].pop(i)
                            break
                    if moved_piece:
                        break
                if not moved_piece:
                    await ws.send_json({"type": "error", "msg": "No ship to move"})
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
                _prompt_gov = player.tech.get("government", [])
                await ws.send_json({
                    "type": "invasion_prompt",
                    "dest_cluster": dest_cluster,
                    "planet": core_hex["planet"],
                    "tech_cards": player.tech_cards,
                    "def_dice_count": len(_planet_def_dice(game, player.name, core_hex["planet"], _prompt_gov)),
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
                # Verify player has attack-capable ships there (cruise_ship is defense-only)
                player_frigates = [
                    p for h in game.board if h["cluster"] == cluster
                    for p in h["pieces"] if p["type"] in _ATTACK_SHIPS and p["owner"] == player.name
                ]
                if not player_frigates:
                    await ws.send_json({"type": "error", "msg": "No ships in that cluster"})
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
                # Count attacking ships: if source_hex_id provided, use only ships on that hex
                source_hex_id = raw.get("source_hex_id")
                if source_hex_id is not None:
                    source_hex = next(
                        (h for h in game.board
                         if h["id"] == source_hex_id and h["cluster"] == cluster and h["type"] == "orbital"),
                        None,
                    )
                    if source_hex is None:
                        await ws.send_json({"type": "error", "msg": "Invalid source hex"})
                        continue
                    attack_frigates = [p for p in source_hex["pieces"] if p["type"] in _ATTACK_SHIPS and p["owner"] == player.name]
                    if not attack_frigates:
                        await ws.send_json({"type": "error", "msg": "No ships on that tile"})
                        continue
                else:
                    attack_frigates = player_frigates
                # Store combat context and prompt player to pick a tech card before rolling
                atk_count = len(attack_frigates)
                game.pending_combat = {
                    "type": "invasion",
                    "attacker": player.name,
                    "dest_cluster": cluster,
                    "planet": planet,
                    "atk_count": atk_count,
                    "remove_all_on_loss": True,
                }
                state = game.public_state()
                state["board"] = game.board
                await game.broadcast({"type": "game_state", **state}, exclude=ws)
                _ia_gov = player.tech.get("government", [])
                await ws.send_json({
                    "type": "invasion_prompt",
                    "dest_cluster": cluster,
                    "planet": planet,
                    "atk_count": atk_count,
                    "tech_cards": player.tech_cards,
                    "def_dice_count": len(_planet_def_dice(game, player.name, planet, _ia_gov)),
                    **state,
                })

            # ── intra_move ────────────────────────────────────────────────────
            elif kind == "intra_move":
                if not game or not player:
                    continue
                if game.phase != "board" or not game.turn_order:
                    continue
                current = game.turn_order[game.turn_idx % len(game.turn_order)]
                if player.name != current:
                    await ws.send_json({"type": "error", "msg": "Not your turn"})
                    continue
                cluster = raw.get("cluster")
                target_hex_id = raw.get("target_hex_id")
                if cluster is None or target_hex_id is None:
                    continue
                target_hex = next(
                    (h for h in game.board if h["id"] == target_hex_id
                     and h["cluster"] == cluster and h["type"] == "orbital"),
                    None,
                )
                if target_hex is None:
                    await ws.send_json({"type": "error", "msg": "Invalid target tile"})
                    continue
                target_ships = sum(1 for p in target_hex["pieces"] if p["type"] in _MOBILE_SHIPS)
                if target_ships >= 3:
                    await ws.send_json({"type": "error", "msg": "That tile is full"})
                    continue
                # Find a ship on a DIFFERENT orbital in the same cluster
                moved_piece = None
                for h in game.board:
                    if h["cluster"] != cluster or h["id"] == target_hex_id or h["type"] != "orbital":
                        continue
                    for i, p in enumerate(h["pieces"]):
                        if p["type"] in _MOBILE_SHIPS and p["owner"] == player.name:
                            moved_piece = h["pieces"].pop(i)
                            break
                    if moved_piece:
                        break
                if not moved_piece:
                    await ws.send_json({"type": "error", "msg": "No ship to reposition"})
                    continue
                target_hex["pieces"].append(moved_piece)
                _use_action(game)
                state = game.public_state()
                state["board"] = game.board
                await game.broadcast({"type": "game_state", **state})

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
                # Base dice = 1 per attacking ship; tech cards and Physics add extras
                _si_die = 15 if "plasma_forge" in player.tech_cards else 6
                atk_count = combat.get("atk_count", 1)
                atk_dice = [random.randint(1, _si_die) for _ in range(atk_count)]
                if tech_card in ("nuclear_missile", "death_spores", "invasion_dice"):
                    atk_dice.append(random.randint(1, _si_die))
                _si_phys = player.tech.get("physics", [])
                if len(_si_phys) > 2 and _si_phys[2]: atk_dice.append(random.randint(1, _si_die))  # Lv3
                if len(_si_phys) > 4 and _si_phys[4]: atk_dice.append(random.randint(1, _si_die))  # Lv5
                atk_total = sum(atk_dice)
                # Planet defense: scales with attacker empire size
                _si_gov = player.tech.get("government", [])
                planet_dice = _planet_def_dice(game, player.name, planet, _si_gov)
                planet_total = sum(planet_dice)
                if atk_total > planet_total:
                    winner = "player"
                    # Grant planet income to attacker
                    _reveal_dwarf_planet(planet)
                    for _k in ("food", "science", "tool", "money"):
                        player.income[_k] = player.income.get(_k, 0) + planet.get(_k, 0)
                    # Find and evict previous flag owner (empire_flag or home-system owner)
                    inv_core = next((h for h in game.board if h["cluster"] == dest_cluster and h["local"] == 0), None)
                    prev_flag_owner = next(
                        (p["owner"] for p in (inv_core.get("pieces", []) if inv_core else [])
                         if p["type"] == "empire_flag"),
                        None,
                    )
                    home_owner = next(
                        (pname for pname, cl in game.player_system.items()
                         if cl == dest_cluster and pname != player.name),
                        None,
                    )
                    prev_planet_owner = prev_flag_owner or home_owner
                    if prev_planet_owner and prev_planet_owner != player.name:
                        other = game.players.get(prev_planet_owner)
                        if other:
                            for _k in ("food", "science", "tool", "money"):
                                other.income[_k] = max(0, other.income.get(_k, 0) - planet.get(_k, 0))
                            lost = _strip_buildings_from_cluster(game, dest_cluster, prev_planet_owner)
                            for _k, _amt in lost.items():
                                other.income[_k] = max(0, other.income.get(_k, 0) - _amt)
                    # Plant empire flag
                    if inv_core:
                        inv_core["pieces"] = [p for p in inv_core.get("pieces", []) if p["type"] != "empire_flag"]
                        inv_core["pieces"].append({"type": "empire_flag", "owner": player.name})
                    game.ever_owned_planet.add(player.name)
                    # Last-chance: if the evicted owner now has 0 planets, give them one turn to recapture
                    if prev_planet_owner and prev_planet_owner != player.name:
                        if _count_vp(game, prev_planet_owner) == 0:
                            game.last_chance.add(prev_planet_owner)
                else:
                    winner = "planet"
                    if combat.get("remove_all_on_loss"):
                        # Direct invasion: remove all attacking ships from the cluster
                        for h in game.board:
                            if h["cluster"] != dest_cluster:
                                continue
                            h["pieces"] = [p for p in h["pieces"]
                                           if not (p["type"] in _MOBILE_SHIPS and p["owner"] == player.name)]
                    else:
                        # Wormhole invasion: remove only the single ship that flew through
                        for h in game.board:
                            if h["cluster"] != dest_cluster:
                                continue
                            for i, p in enumerate(h["pieces"]):
                                if p["type"] in _MOBILE_SHIPS and p["owner"] == player.name:
                                    h["pieces"].pop(i)
                                    break
                game.pending_combat = None
                if winner == "player":
                    player.invasions_won += 1
                    if planet.get("ancient"):
                        game.ancient_winner = player.name
                _use_action(game)
                await _flush_eliminations(game)
                if winner == "player" and (planet.get("ancient") or _check_vp_winner(game)):
                    game.phase = "ended"
                state = game.public_state()
                state["board"] = game.board
                await game.broadcast({
                    "type": "invasion_result",
                    "attacker": player.name,
                    "atk_dice": atk_dice,
                    "planet_dice": planet_dice,
                    "atk_total": atk_total,
                    "planet_total": planet_total,
                    "won": winner == "player",
                    "planet": planet,
                    **({"game_over": _build_endgame_stats(game)} if game.phase == "ended" else {}),
                    **state,
                })

            # ── play_tech_card ────────────────────────────────────────────────
            elif kind == "play_tech_card":
                if not game or not player:
                    continue
                if game.phase != "board" or not game.turn_order:
                    continue
                current = game.turn_order[game.turn_idx % len(game.turn_order)]
                if player.name != current:
                    await ws.send_json({"type": "error", "msg": "Not your turn"})
                    continue
                card_id = raw.get("card_id")
                if card_id not in player.tech_cards:
                    await ws.send_json({"type": "error", "msg": "Card not in hand"})
                    continue
                if card_id == "command_surge":
                    player.tech_cards.remove(card_id)
                    game.turn_actions_remaining += 1
                    state = game.public_state()
                    state["board"] = game.board
                    await game.broadcast({"type": "game_state", **state})
                else:
                    await ws.send_json({"type": "error", "msg": "That card cannot be played this way"})

            # ── draw_tech_card ────────────────────────────────────────────────
            elif kind == "draw_tech_card":
                if not game or not player:
                    continue
                if game.phase != "board" or not game.turn_order:
                    continue
                current = game.turn_order[game.turn_idx % len(game.turn_order)]
                if player.name != current:
                    await ws.send_json({"type": "error", "msg": "Not your turn"})
                    continue
                card = random.choice(TECH_CARDS)
                player.tech_cards.append(card["id"])
                await game.send_to(player.name, {"type": "bonus_tech_drawn", "cards": [card]})
                _use_action(game)
                await _flush_eliminations(game)
                state = game.public_state()
                state["board"] = game.board
                await game.broadcast({"type": "game_state", **state})

            # ── research_skill ────────────────────────────────────────────────
            elif kind == "research_skill":
                if not game or not player:
                    continue
                if game.phase != "board" or not game.turn_order:
                    continue
                current = game.turn_order[game.turn_idx % len(game.turn_order)]
                if player.name != current:
                    await ws.send_json({"type": "error", "msg": "Not your turn"})
                    continue
                column = raw.get("column")
                if column not in _SKILL_EFFECTS:
                    await ws.send_json({"type": "error", "msg": "Unknown skill column"})
                    continue
                levels = player.tech.setdefault(column, [False] * 5)
                next_lvl = next((i for i, done in enumerate(levels) if not done), None)
                if next_lvl is None:
                    await ws.send_json({"type": "error", "msg": "All levels already unlocked"})
                    continue
                effect = _SKILL_EFFECTS[column][next_lvl]
                cost_sci = effect["science"]
                sci_have = player.resources.get("science", 0)
                if sci_have < cost_sci:
                    await ws.send_json({"type": "error", "msg": f"Need {cost_sci} Science (have {sci_have})"})
                    continue
                player.resources["science"] = sci_have - cost_sci
                levels[next_lvl] = True
                player.tech[column] = levels
                for res, amt in effect.get("income", {}).items():
                    player.income[res] = player.income.get(res, 0) + amt
                if effect.get("vp"):
                    player.pieces["vp"] = player.pieces.get("vp", 0) + effect["vp"]
                _use_action(game)
                await _flush_eliminations(game)
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
