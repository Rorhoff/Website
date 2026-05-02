"""Unit tests for pure SSS game logic — no WebSocket or server required."""
import pytest
from collections import Counter

from sss_routes import (
    _build_board,
    _apply_turn_income,
    _advance_turn,
    _use_action,
    Game,
    Player,
)

# ── Expected adjacency sets (mirrored from _build_board) ──────────────────────
_ADJ_BASE = frozenset({
    (0,1),(0,2),(1,3),(1,4),(2,4),(2,5),(3,4),(3,6),(4,5),(4,6),(4,7),(5,7),(6,8),(7,8),
})
# 3P uses a "weird diamond" layout (clusters 9-12 in different positions than 4P)
_ADJ_3P = _ADJ_BASE | frozenset({
    (6,9),(8,9),(9,10),(3,10),(6,10),(0,11),(2,11),(11,12),(2,12),(5,12),
})
# 4P builds on the original wing positions (different from 3P weird diamond)
_ADJ_4P_WINGS = frozenset({(3,9),(9,10),(3,10),(6,10),(5,11),(11,12),(2,12),(5,12)})
_ADJ_4P = _ADJ_BASE | _ADJ_4P_WINGS | frozenset({
    (1,13),(3,13),(13,14),(0,14),(1,14),(7,15),(5,15),(15,16),(8,16),(7,16),(12,17),(10,18),
})

def _expected_adj(n):
    if n <= 2:
        return _ADJ_BASE
    if n == 3:
        return _ADJ_3P
    return _ADJ_4P


# ── _build_board ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("n_players", [1, 2, 3, 4])
def test_build_board_wormhole_connectivity(n_players):
    """Every adjacency pair must have exactly one wormhole placed."""
    hexes = _build_board(n_players)
    placed = set()
    for h in hexes:
        if h.get("wormhole"):
            p = h["wormhole_partner"]
            ci = h["cluster"]
            cj = hexes[p]["cluster"]
            placed.add((min(ci, cj), max(ci, cj)))

    missing = _expected_adj(n_players) - placed
    assert not missing, (
        f"n_players={n_players}: no wormhole for cluster pairs {missing}"
    )


@pytest.mark.parametrize("n_players", [1, 2, 3, 4])
def test_build_board_wormhole_partners_symmetric(n_players):
    """If hex A is a wormhole to B, B must be a wormhole back to A."""
    hexes = _build_board(n_players)
    for i, h in enumerate(hexes):
        if h.get("wormhole"):
            p = h["wormhole_partner"]
            assert hexes[p].get("wormhole"), (
                f"hex {i} points to partner {p} but partner is not marked as wormhole"
            )
            assert hexes[p]["wormhole_partner"] == i, (
                f"asymmetric wormhole: hex {i} -> {p}, but {p} -> {hexes[p]['wormhole_partner']}"
            )


@pytest.mark.parametrize("n_players", [1, 2, 3, 4])
def test_build_board_cluster_sizes(n_players):
    """Each cluster must contain exactly 7 hexes (1 center + 6 ring)."""
    hexes = _build_board(n_players)
    counts = Counter(h["cluster"] for h in hexes)
    bad = {ci: c for ci, c in counts.items() if c != 7}
    assert not bad, f"n_players={n_players}: clusters with wrong hex count: {bad}"


@pytest.mark.parametrize("n_players,expected_clusters", [
    (1, 9), (2, 9), (3, 13), (4, 19),
])
def test_build_board_cluster_count(n_players, expected_clusters):
    hexes = _build_board(n_players)
    actual = len(set(h["cluster"] for h in hexes))
    assert actual == expected_clusters


# ── Fixtures ──────────────────────────────────────────────────────────────────

def _make_player(name: str, money: int = 0) -> Player:
    p = Player(ws=None, name=name, role="player")
    p.resources = {"food": 0, "science": 0, "tool": 0, "money": money}
    p.income    = {"food": 1, "science": 1, "tool": 1, "money": 3}
    return p


def _make_game(n: int = 2) -> Game:
    names = [f"P{i}" for i in range(n)]
    game = Game(code="TEST", host_name=names[0])
    game.players = {name: _make_player(name) for name in names}
    game.board = []
    game.turn_order = names
    game.turn_idx = 0
    game.turn_actions_remaining = 3
    return game


# ── _apply_turn_income ────────────────────────────────────────────────────────

def test_apply_turn_income_adds_income():
    game = _make_game(2)
    p = game.players["P0"]
    p.income = {"food": 0, "science": 0, "tool": 0, "money": 5}
    _apply_turn_income(game, p)
    assert p.resources["money"] == 5


def test_apply_turn_income_accumulates():
    game = _make_game(2)
    p = game.players["P0"]
    p.resources["money"] = 10
    p.income = {"food": 0, "science": 0, "tool": 0, "money": 3}
    _apply_turn_income(game, p)
    assert p.resources["money"] == 13


def test_apply_turn_income_negative_resources_add_unrest():
    """When upkeep exceeds income a resource goes negative and unrest is gained.

    Build a fake tri hex with upkeep the player owes but has no income to cover.
    """
    game = _make_game(2)
    p = game.players["P0"]
    p.income = {"food": 0, "science": 0, "tool": 0, "money": 0}
    p.resources = {"food": 0, "science": 0, "tool": 0, "money": 0}

    # Give player an empire_flag in cluster 0 and a tri hex with upkeep in cluster 0.
    game.board = [
        {
            "id": 0, "cluster": 0, "local": 0, "tri": False,
            "pieces": [{"type": "empire_flag", "owner": "P0"}],
        },
        {
            "id": 1, "cluster": 0, "local": 1, "tri": True,
            "tri_counts": [2, 2, 2],
            "pieces": [],
        },
    ]
    _apply_turn_income(game, p)
    # With tri_counts [2,2,2]: tool upkeep=2, food upkeep=2, science upkeep=2, all income=0.
    # food, science, tool go to -2 each → 3 unrest gained.
    assert p.resources.get("unrest", 0) >= 3, "expected ≥3 unrest from 3 negative resources"
    for key in ("food", "science", "tool"):
        assert p.resources.get(key, 0) < 0, f"{key} should be negative when upkeep exceeds income"


# ── _advance_turn ─────────────────────────────────────────────────────────────

def test_advance_turn_increments_idx():
    game = _make_game(2)
    _advance_turn(game)
    assert game.turn_idx == 1


def test_advance_turn_resets_actions():
    game = _make_game(2)
    game.turn_actions_remaining = 0
    _advance_turn(game)
    assert game.turn_actions_remaining == 3


def test_advance_turn_applies_income_to_current_player():
    game = _make_game(2)
    game.players["P0"].income = {"food": 0, "science": 0, "tool": 0, "money": 7}
    game.players["P1"].income = {"food": 0, "science": 0, "tool": 0, "money": 0}
    game.turn_idx = 0  # current player is P0
    _advance_turn(game)
    assert game.players["P0"].resources["money"] == 7
    assert game.players["P1"].resources["money"] == 0


def test_advance_turn_wraps_player_order():
    game = _make_game(2)
    game.turn_idx = 1  # P1's turn, advancing wraps to P0
    _advance_turn(game)
    assert game.turn_idx == 2
    # Next active player index 2 % 2 == 0, i.e. P0 again — income goes to P1 during this advance
    assert game.players["P1"].resources["money"] > 0


# ── _use_action ───────────────────────────────────────────────────────────────

def test_use_action_decrements():
    game = _make_game(2)
    _use_action(game)
    assert game.turn_actions_remaining == 2


def test_use_action_triggers_advance_at_zero():
    game = _make_game(2)
    game.turn_actions_remaining = 1
    _use_action(game)
    # _advance_turn was called: turn_idx incremented, actions reset to 3
    assert game.turn_idx == 1
    assert game.turn_actions_remaining == 3


def test_use_action_three_times_advances_once():
    game = _make_game(2)
    _use_action(game)
    _use_action(game)
    _use_action(game)
    assert game.turn_idx == 1
    assert game.turn_actions_remaining == 3


# ── flight_move landing hex selection ─────────────────────────────────────────

def _pick_landing(board, dest_cluster, req_id):
    """Mirror of the server-side landing hex selection in the flight_move handler."""
    landing = None
    if req_id is not None and 0 <= req_id < len(board):
        rh = board[req_id]
        if (rh["cluster"] == dest_cluster and rh["type"] == "orbital"
                and sum(1 for p in rh["pieces"] if p["type"] == "frigate") < 3):
            landing = rh
    if landing is None:
        landing = next(
            (h for h in board
             if h["cluster"] == dest_cluster and h["type"] == "orbital"
             and sum(1 for p in h["pieces"] if p["type"] == "frigate") < 3),
            None,
        )
    return landing


def test_flight_move_fallback_uses_first_orbital():
    """Without target_hex_id the server picks the first orbital (lowest id) in dest cluster."""
    board = _build_board(2)
    src_wh = next(h for h in board if h["wormhole"] and h["wormhole_partner"] is not None)
    dst_wh_id = src_wh["wormhole_partner"]
    dest_cluster = board[dst_wh_id]["cluster"]

    orbitals = sorted(
        [h for h in board if h["cluster"] == dest_cluster and h["type"] == "orbital"],
        key=lambda h: h["id"],
    )
    assert orbitals, "dest cluster must have at least one orbital"

    result = _pick_landing(board, dest_cluster, None)
    assert result is not None
    assert result["id"] == orbitals[0]["id"], (
        f"fallback should pick lowest-id orbital ({orbitals[0]['id']}), got {result['id']}"
    )


def test_flight_move_respects_target_hex_id():
    """When target_hex_id is provided the server must land on that specific orbital."""
    board = _build_board(2)
    src_wh = next(h for h in board if h["wormhole"] and h["wormhole_partner"] is not None)
    dst_wh_id = src_wh["wormhole_partner"]
    dest_cluster = board[dst_wh_id]["cluster"]

    orbitals = sorted(
        [h for h in board if h["cluster"] == dest_cluster and h["type"] == "orbital"],
        key=lambda h: h["id"],
    )
    assert len(orbitals) >= 2, "Need ≥2 orbitals in dest cluster to verify non-default targeting"

    # Ask for the LAST orbital — not the first (which the fallback would pick)
    target = orbitals[-1]
    assert target["id"] != orbitals[0]["id"], "target and fallback must differ"

    result = _pick_landing(board, dest_cluster, target["id"])
    assert result is not None, "Server should accept a valid target_hex_id"
    assert result["id"] == target["id"], (
        f"Expected hex {target['id']} (last orbital) but got {result['id']}"
    )


def test_flight_move_target_hex_id_wrong_cluster_falls_back():
    """A target_hex_id from the wrong cluster must be rejected and the fallback used."""
    board = _build_board(2)
    src_wh = next(h for h in board if h["wormhole"] and h["wormhole_partner"] is not None)
    dst_wh_id = src_wh["wormhole_partner"]
    src_cluster = src_wh["cluster"]
    dest_cluster = board[dst_wh_id]["cluster"]

    # Find an orbital from the SOURCE cluster (wrong cluster for this move)
    wrong_hex = next(
        h for h in board if h["cluster"] == src_cluster and h["type"] == "orbital"
    )
    result = _pick_landing(board, dest_cluster, wrong_hex["id"])

    # Should fall back to first orbital in dest cluster
    expected_fallback = min(
        (h for h in board if h["cluster"] == dest_cluster and h["type"] == "orbital"),
        key=lambda h: h["id"],
    )
    assert result is not None
    assert result["id"] == expected_fallback["id"], (
        "Wrong-cluster target_hex_id must fall back to first available orbital"
    )
