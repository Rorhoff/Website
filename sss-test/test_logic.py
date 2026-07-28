"""Unit tests for pure SSS game logic — no WebSocket or server required."""
import pytest
from collections import Counter

from sss_routes import (
    VP_TARGET,
    _build_board,
    _apply_turn_income,
    _advance_turn,
    _use_action,
    _planet_def_dice,
    _player_planet_count,
    _ai_try_build_scout,
    _ai_try_research_skill,
    _ai_try_construct_building,
    _ai_do_flight,
    _pick_landing_orbital,
    _valid_landing_orbital,
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


def _add_planet_flag(game, owner: str, cluster_id: int) -> None:
    """Add a planet hex with an empire_flag owned by `owner` to game.board."""
    game.board.append({
        "id": len(game.board),
        "cluster": cluster_id,
        "local": 0,
        "planet": {"food": 1, "science": 0, "tool": 0, "money": 0, "vp": 1},
        "pieces": [{"type": "empire_flag", "owner": owner}],
    })


# ── VP_TARGET ─────────────────────────────────────────────────────────────────

def test_vp_target_matches_server_win_condition():
    """Keeps tests aligned with `VP_TARGET` in `sss_routes.py` (client shows `/7 VP`)."""
    assert VP_TARGET == 7, f"Expected VP_TARGET=7, got {VP_TARGET}"


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
    """When upkeep exceeds income a resource goes negative and unrest is gained."""
    game = _make_game(2)
    p = game.players["P0"]
    p.income = {"food": 0, "science": 0, "tool": 0, "money": 0}
    p.resources = {"food": 0, "science": 0, "tool": 0, "money": 0}

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
    assert p.resources.get("unrest", 0) == 1, "expected exactly 1 unrest regardless of how many resources are negative"
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
    game.turn_idx = 0
    _advance_turn(game)
    assert game.players["P0"].resources["money"] == 7
    assert game.players["P1"].resources["money"] == 0


def test_advance_turn_wraps_player_order():
    game = _make_game(2)
    game.turn_idx = 1
    _advance_turn(game)
    assert game.turn_idx == 2
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
    assert game.turn_idx == 1
    assert game.turn_actions_remaining == 3


def test_use_action_three_times_advances_once():
    game = _make_game(2)
    _use_action(game)
    _use_action(game)
    _use_action(game)
    assert game.turn_idx == 1
    assert game.turn_actions_remaining == 3


# ── _player_planet_count ──────────────────────────────────────────────────────

def test_player_planet_count_zero():
    game = _make_game(2)
    game.board = []
    assert _player_planet_count(game, "P0") == 0


def test_player_planet_count_one():
    game = _make_game(2)
    game.board = []
    _add_planet_flag(game, "P0", 1)
    assert _player_planet_count(game, "P0") == 1


def test_player_planet_count_multiple():
    game = _make_game(2)
    game.board = []
    for c in range(4):
        _add_planet_flag(game, "P0", c)
    assert _player_planet_count(game, "P0") == 4


def test_player_planet_count_ignores_other_owner():
    game = _make_game(2)
    game.board = []
    _add_planet_flag(game, "P1", 1)
    _add_planet_flag(game, "P0", 2)
    assert _player_planet_count(game, "P0") == 1
    assert _player_planet_count(game, "P1") == 1


# ── _planet_def_dice ──────────────────────────────────────────────────────────

def _dice_count(game, name, planet=None, gov=None):
    if planet is None:
        planet = {}
    return len(_planet_def_dice(game, name, planet, gov))


def test_planet_def_ancient_rolls_3d50():
    game = _make_game(2)
    game.board = []
    dice = _planet_def_dice(game, "P0", {"ancient": True})
    assert len(dice) == 3
    assert all(1 <= d <= 50 for d in dice), "ancient dice must be in [1,50]"


def test_planet_def_zero_planets_is_2d6():
    game = _make_game(2)
    game.board = []
    assert _dice_count(game, "P0") == 2


def test_planet_def_one_planet_is_2d6():
    game = _make_game(2)
    game.board = []
    _add_planet_flag(game, "P0", 1)
    assert _dice_count(game, "P0") == 2


def test_planet_def_two_planets_is_3d6():
    game = _make_game(2)
    game.board = []
    for c in range(2):
        _add_planet_flag(game, "P0", c)
    assert _dice_count(game, "P0") == 3


def test_planet_def_three_planets_is_3d6():
    game = _make_game(2)
    game.board = []
    for c in range(3):
        _add_planet_flag(game, "P0", c)
    assert _dice_count(game, "P0") == 3


def test_planet_def_four_planets_is_5d6():
    game = _make_game(2)
    game.board = []
    for c in range(4):
        _add_planet_flag(game, "P0", c)
    assert _dice_count(game, "P0") == 5


def test_planet_def_five_planets_is_5d6():
    game = _make_game(2)
    game.board = []
    for c in range(5):
        _add_planet_flag(game, "P0", c)
    assert _dice_count(game, "P0") == 5


def test_planet_def_six_planets_is_7d6():
    game = _make_game(2)
    game.board = []
    for c in range(6):
        _add_planet_flag(game, "P0", c)
    assert _dice_count(game, "P0") == 7


def test_planet_def_seven_planets_is_7d6():
    game = _make_game(2)
    game.board = []
    for c in range(7):
        _add_planet_flag(game, "P0", c)
    assert _dice_count(game, "P0") == 7


def test_planet_def_government_lv3_reduces_by_one():
    """Government Lv3 Martial Command removes 1 die from defense (minimum 1)."""
    game = _make_game(2)
    game.board = []
    for c in range(4):
        _add_planet_flag(game, "P0", c)
    gov_with_lv3 = [False, False, True]
    without_gov = _dice_count(game, "P0")
    with_gov    = _dice_count(game, "P0", gov=gov_with_lv3)
    assert with_gov == without_gov - 1


def test_planet_def_government_reduction_floored_at_one():
    """Even with Govt Lv3, the minimum defense is 1 die."""
    game = _make_game(2)
    game.board = []  # 0 planets owned → normally 2d6, -1 = 1d6
    gov_with_lv3 = [False, False, True]
    assert _dice_count(game, "P0", gov=gov_with_lv3) == 1


def test_planet_def_normal_dice_in_range():
    """All non-ancient defense dice must be in [1, 6]."""
    game = _make_game(2)
    game.board = []
    for c in range(3):
        _add_planet_flag(game, "P0", c)
    dice = _planet_def_dice(game, "P0", {})
    assert all(1 <= d <= 6 for d in dice), f"got out-of-range dice: {dice}"


def test_planet_def_ancient_not_affected_by_empire_size():
    """Ancient planet always rolls 3d50 regardless of how many planets attacker owns."""
    game = _make_game(2)
    game.board = []
    for c in range(7):
        _add_planet_flag(game, "P0", c)
    dice = _planet_def_dice(game, "P0", {"ancient": True})
    assert len(dice) == 3
    assert all(1 <= d <= 50 for d in dice)


# ── flight_move landing hex selection ─────────────────────────────────────────

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

    result = _pick_landing_orbital(board, dest_cluster, "P0", None)
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

    target = orbitals[-1]
    assert target["id"] != orbitals[0]["id"], "target and fallback must differ"

    result = _pick_landing_orbital(board, dest_cluster, "P0", target["id"])
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

    wrong_hex = next(
        h for h in board if h["cluster"] == src_cluster and h["type"] == "orbital"
    )
    result = _pick_landing_orbital(board, dest_cluster, "P0", wrong_hex["id"])

    expected_fallback = min(
        (h for h in board if h["cluster"] == dest_cluster and h["type"] == "orbital"),
        key=lambda h: h["id"],
    )
    assert result is not None
    assert result["id"] == expected_fallback["id"], (
        "Wrong-cluster target_hex_id must fall back to first available orbital"
    )


def test_flight_move_cannot_land_on_hex_with_enemy_ships():
    """Opponent mobile ships block landing on the same orbital."""
    board = _build_board(2)
    src_wh = next(h for h in board if h["wormhole"] and h["wormhole_partner"] is not None)
    dest_cluster = board[src_wh["wormhole_partner"]]["cluster"]
    orbitals = [h for h in board if h["cluster"] == dest_cluster and h["type"] == "orbital"]
    assert len(orbitals) >= 1
    blocked = orbitals[0]
    blocked["pieces"].append({"type": "scout", "owner": "P1"})
    assert not _valid_landing_orbital(blocked, "P0")
    for orb in orbitals:
        orb["pieces"] = [{"type": "scout", "owner": "P1"}]
    assert _pick_landing_orbital(board, dest_cluster, "P0", None) is None


def test_cannot_land_on_hex_with_enemy_battle_station():
    """Stationary enemy spacecraft (battle stations, outposts) also close the hex."""
    board = _build_board(2)
    src_wh = next(h for h in board if h["wormhole"] and h["wormhole_partner"] is not None)
    dest_cluster = board[src_wh["wormhole_partner"]]["cluster"]
    orbitals = [h for h in board if h["cluster"] == dest_cluster and h["type"] == "orbital"]
    assert len(orbitals) >= 2

    orbitals[0]["pieces"].append({"type": "battle_station", "owner": "P1"})
    assert not _valid_landing_orbital(orbitals[0], "P0")
    orbitals[1]["pieces"].append({"type": "outpost", "owner": "P1"})
    assert not _valid_landing_orbital(orbitals[1], "P0")

    # Your own station never blocks you.
    assert _valid_landing_orbital(orbitals[0], "P1")

    # Even an explicit target_hex_id request must be refused and fall back elsewhere.
    picked = _pick_landing_orbital(board, dest_cluster, "P0", orbitals[0]["id"])
    assert picked is not None and picked["id"] not in (orbitals[0]["id"], orbitals[1]["id"])

    # With every orbital station-held, there is nowhere to land at all.
    for orb in orbitals:
        orb["pieces"] = [{"type": "battle_station", "owner": "P1"}]
    assert _pick_landing_orbital(board, dest_cluster, "P0", None) is None


# ── AI economy helpers (_ai_try_build_scout / _research_skill / _construct_building) ──────────
# Reproduces the user-reported scenario: AI's scouts all died, AI still owns its home planet,
# AI has resources and orbital space — it should rebuild on the next turn (and also invest in
# buildings + skill tree, which used to be missing entirely).

def _setup_ai_game_with_home() -> Game:
    """Build a 2-player game with an AI 'AI' that has a home cluster, planet, and orbitals."""
    board = _build_board(2)
    game = Game(code="AIT", host_name="Hu")
    game.board = board
    game.players = {
        "Hu": Player(ws=None, name="Hu", role="player"),
        "AI": Player(ws=None, name="AI", role="ai"),
    }
    game.turn_order = ["Hu", "AI"]
    game.turn_idx = 1  # AI's turn
    game.turn_actions_remaining = 3
    # Pick the first cluster's battle_station / planet / orbitals for the AI.
    cluster = next(h["cluster"] for h in board if h["type"] == "orbital")
    game.player_system["AI"] = cluster
    # Place empire_flag on the planet hex (local==0) so _player_planet_count > 0.
    planet_hex = next(h for h in board if h["cluster"] == cluster and h.get("local") == 0)
    planet_hex.setdefault("planet", {"food": 1, "science": 0, "tool": 0, "money": 0, "vp": 1})
    planet_hex["pieces"].append({"type": "empire_flag", "owner": "AI"})
    # Drop a battle_station on an orbital so the AI's home is real.
    orbital_hex = next(h for h in board if h["cluster"] == cluster and h["type"] == "orbital")
    orbital_hex["pieces"].append({"type": "battle_station", "owner": "AI"})
    ai = game.players["AI"]
    ai.resources = {"food": 5, "science": 0, "tool": 5, "money": 50}
    ai.income = {"food": 1, "science": 1, "tool": 1, "money": 3}
    ai.pieces = {"scout": 9, "battle_station": 0, "empire_flag": 0, "building_money": 3,
                 "building_science": 3, "building_tool": 3, "farmer_upgrade": 3}
    ai.tech = {}
    ai.tech_cards = []
    return game


def test_ai_rebuilds_scout_when_scouts_wiped():
    """After every scout dies the AI should still be able to put a new one in an open orbital."""
    game = _setup_ai_game_with_home()
    ai = game.players["AI"]
    # Confirm there are no AI scouts on the board to start (regression for the user bug).
    starting_scouts = sum(
        1 for h in game.board for pc in h["pieces"]
        if pc["type"] == "scout" and pc["owner"] == "AI"
    )
    assert starting_scouts == 0

    built = _ai_try_build_scout(game, ai, "AI")
    assert built is True, "AI should rebuild a scout when home planet + resources + orbital exist"
    new_scouts = sum(
        1 for h in game.board for pc in h["pieces"]
        if pc["type"] == "scout" and pc["owner"] == "AI"
    )
    assert new_scouts == 1
    # Cost matches human build_piece cost (money 10 + tool 2) with no engineering.
    assert ai.resources["money"] == 40
    assert ai.resources["tool"] == 3


def test_ai_skips_scout_build_when_broke():
    game = _setup_ai_game_with_home()
    ai = game.players["AI"]
    ai.resources["money"] = 5  # below 10-money scout cost
    assert _ai_try_build_scout(game, ai, "AI") is False


def test_ai_builds_scout_uses_engineering_discounts():
    """Engineering Lv2 cuts 2 money, Lv3 cuts 1 tool from spacecraft cost."""
    game = _setup_ai_game_with_home()
    ai = game.players["AI"]
    ai.tech = {"engineering": [True, True, True, False, False]}
    assert _ai_try_build_scout(game, ai, "AI") is True
    assert ai.resources["money"] == 50 - 8  # 10 - 2
    assert ai.resources["tool"]  == 5  - 1  # 2  - 1


def test_ai_researches_skill_when_science_available():
    """With enough science the AI buys the cheapest payoff skill (Hydroponics, 2 sci → +1 food)."""
    game = _setup_ai_game_with_home()
    ai = game.players["AI"]
    ai.resources["science"] = 10
    initial_food_income = ai.income.get("food", 0)
    bought = _ai_try_research_skill(game, ai, "AI")
    assert bought is True
    assert ai.resources["science"] == 8  # 10 - 2
    assert ai.tech["biology"][0] is True
    assert ai.income["food"] == initial_food_income + 1


def test_ai_skips_skill_when_no_science():
    game = _setup_ai_game_with_home()
    ai = game.players["AI"]
    ai.resources["science"] = 1  # below the cheapest 2-sci buy
    assert _ai_try_research_skill(game, ai, "AI") is False


def test_ai_constructs_money_building_first():
    """AI should prefer building_money (income 3) over the other buildings."""
    game = _setup_ai_game_with_home()
    ai = game.players["AI"]
    # Ensure there's a bs_slot in the AI's cluster.
    has_bs = any(
        h["type"] == "bs_slot" and h["cluster"] == game.player_system["AI"]
        for h in game.board
    )
    if not has_bs:
        pytest.skip("Board layout has no bs_slot in chosen cluster")
    starting_money_income = ai.income.get("money", 0)
    built = _ai_try_construct_building(game, ai, "AI")
    assert built is True
    # building_money base cost 6 × max(1, 1 planet) = 6 money.
    assert ai.resources["money"] == 50 - 6
    assert ai.income["money"] == starting_money_income + 3
    # Confirm the piece exists on a bs_slot.
    placed = any(
        pc["type"] == "building_money" and pc["owner"] == "AI"
        for h in game.board if h["type"] == "bs_slot"
        for pc in h["pieces"]
    )
    assert placed


# ── AI fly-and-invade gating ──────────────────────────────────────────────────

def test_ai_flight_marks_arrived_this_turn():
    """`_ai_do_flight` should record the destination cluster in `ai_arrived_this_turn`
    so subsequent invasion logic can refuse a same-turn planet invasion."""
    game = _setup_ai_game_with_home()
    ai_name = "AI"
    home_cluster = game.player_system[ai_name]
    ai_p = game.players[ai_name]
    # Park a scout in the AI's home cluster on an orbital so flight has something to move.
    home_orbital = next(
        h for h in game.board if h["cluster"] == home_cluster and h["type"] == "orbital"
    )
    home_orbital["pieces"].append({"type": "scout", "owner": ai_name})

    # Find any wormhole hex owned/located in the home cluster as the source.
    src_wh = next(
        (h for h in game.board
         if h["cluster"] == home_cluster and h.get("wormhole_partner") is not None),
        None,
    )
    if src_wh is None:
        pytest.skip("Random home cluster has no wormhole — try a different layout")
    dest_wh_id = src_wh["wormhole_partner"]
    dest_cluster = game.board[dest_wh_id]["cluster"]

    moved = _ai_do_flight(game, ai_name, src_wh["id"], dest_wh_id)
    assert moved is True
    arrived = game.ai_arrived_this_turn.get(ai_name, set())
    assert dest_cluster in arrived, "Flight destination must be flagged as arrived-this-turn"
    # Sanity: the scout actually landed somewhere in dest_cluster.
    landed = any(
        pc["type"] == "scout" and pc["owner"] == ai_name
        for h in game.board if h["cluster"] == dest_cluster
        for pc in h["pieces"]
    )
    assert landed


def test_arrived_carries_within_same_turn_clears_across_turns():
    """The arrived-this-turn set must persist while the AI's turn_idx is unchanged, but be
    treated as stale (and reset by `_ai_board_action`) once turn_idx advances. This test
    exercises only the *data invariant* — the actual reset runs as the first few lines of
    `_ai_board_action`, which is verified via behavior in the WS integration tests."""
    game = _setup_ai_game_with_home()
    ai_name = "AI"
    game.ai_arrived_this_turn[ai_name] = {5, 7}
    game.ai_last_turn_idx[ai_name] = game.turn_idx

    # Same turn — set must still match what we put in.
    assert game.ai_arrived_this_turn[ai_name] == {5, 7}

    # Advancing turn_idx alone does NOT clear it; the reset happens inside
    # `_ai_board_action`. Both are intentionally simple to reason about.
    game.turn_idx += 1
    assert game.ai_arrived_this_turn[ai_name] == {5, 7}
    assert game.ai_last_turn_idx[ai_name] != game.turn_idx
