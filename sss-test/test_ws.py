"""WebSocket integration tests — spins up a real FastAPI TestClient."""
import pytest
from fastapi.testclient import TestClient
from main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


# ── Hosting ───────────────────────────────────────────────────────────────────

def test_host_creates_game(client):
    with client.websocket_connect("/api/sss/ws/NEW") as ws:
        ws.send_json({"type": "host", "name": "Alice"})
        joined = ws.receive_json()
        assert joined["type"] == "joined"
        assert joined["role"] == "host"
        assert len(joined["code"]) == 4

        state = ws.receive_json()
        assert state["type"] == "game_state"
        assert state["phase"] == "lobby"


def test_host_rejects_empty_name(client):
    with client.websocket_connect("/api/sss/ws/NEW") as ws:
        ws.send_json({"type": "host", "name": ""})
        msg = ws.receive_json()
        assert msg["type"] == "error"


# ── Joining ───────────────────────────────────────────────────────────────────

def test_join_reaches_lobby(client):
    with client.websocket_connect("/api/sss/ws/NEW") as host_ws:
        host_ws.send_json({"type": "host", "name": "Alice"})
        code = host_ws.receive_json()["code"]
        host_ws.receive_json()  # game_state

        with client.websocket_connect(f"/api/sss/ws/{code}") as join_ws:
            join_ws.send_json({"type": "join", "name": "Bob", "code": code})
            joined = join_ws.receive_json()
            assert joined["type"] == "joined"
            assert joined["role"] == "player"

            state = join_ws.receive_json()
            assert state["type"] == "game_state"
            player_names = [p["name"] for p in state["players"]]
            assert "Alice" in player_names
            assert "Bob" in player_names


def test_join_rejects_unknown_code(client):
    with client.websocket_connect("/api/sss/ws/ZZZZ") as ws:
        ws.send_json({"type": "join", "name": "Bob", "code": "ZZZZ"})
        msg = ws.receive_json()
        assert msg["type"] == "error"


def test_join_rejects_full_game(client):
    """A 7th player should be rejected (max 6)."""
    code = None
    connections = []
    try:
        host_ws = client.websocket_connect("/api/sss/ws/NEW").__enter__()
        connections.append(host_ws)
        host_ws.send_json({"type": "host", "name": "P0"})
        code = host_ws.receive_json()["code"]
        host_ws.receive_json()  # game_state

        for i in range(1, 6):
            ws = client.websocket_connect(f"/api/sss/ws/{code}").__enter__()
            connections.append(ws)
            ws.send_json({"type": "join", "name": f"P{i}", "code": code})
            ws.receive_json()  # joined
            ws.receive_json()  # game_state
            # drain host broadcast
            for prev in connections[:-1]:
                try:
                    prev.receive_json()
                except Exception:
                    pass

        # 7th connection attempt (max is 6)
        ws7 = client.websocket_connect(f"/api/sss/ws/{code}").__enter__()
        connections.append(ws7)
        ws7.send_json({"type": "join", "name": "P6", "code": code})
        msg = ws7.receive_json()
        assert msg["type"] == "error"
    finally:
        for c in reversed(connections):
            try:
                c.__exit__(None, None, None)
            except Exception:
                pass


# ── Starting ──────────────────────────────────────────────────────────────────

def test_start_game_advances_phase(client):
    """Host starting a 2-player lobby should move to race_pick."""
    with client.websocket_connect("/api/sss/ws/NEW") as host_ws:
        host_ws.send_json({"type": "host", "name": "Alice"})
        code = host_ws.receive_json()["code"]
        host_ws.receive_json()  # game_state

        with client.websocket_connect(f"/api/sss/ws/{code}") as join_ws:
            join_ws.send_json({"type": "join", "name": "Bob", "code": code})
            join_ws.receive_json()  # joined
            join_ws.receive_json()  # game_state
            host_ws.receive_json()  # lobby broadcast after join

            host_ws.send_json({"type": "start_game"})
            # Server broadcasts game_state to ALL players — drain both queues.
            host_msg = host_ws.receive_json()
            join_ws.receive_json()
            assert host_msg["phase"] == "race_pick"


# ── Recordings ────────────────────────────────────────────────────────────────

import json
import time as _time
from pathlib import Path

from sss_routes import RECORDINGS_DIR


def test_recording_created_when_game_starts(client):
    """Hosting a game should immediately create a JSONL recording on disk."""
    before = {p.name for p in RECORDINGS_DIR.glob("*.jsonl")}
    with client.websocket_connect("/api/sss/ws/NEW") as host_ws:
        host_ws.send_json({"type": "host", "name": "Recorder"})
        code = host_ws.receive_json()["code"]
        host_ws.receive_json()
        # Give the recorder's to_thread writes a chance to flush.
        _time.sleep(0.05)
    after = {p.name for p in RECORDINGS_DIR.glob("*.jsonl")}
    new_files = [n for n in after - before if n.startswith(code + "_")]
    assert new_files, f"Expected a recording named {code}_*.jsonl"
    path = RECORDINGS_DIR / new_files[0]
    lines = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]
    kinds = [evt.get("kind") for evt in lines]
    assert "game_start" in kinds
    # Inbound host action should be logged.
    assert any(evt.get("kind") == "in" and evt.get("msg", {}).get("type") == "host" for evt in lines), \
        "Recording should include the inbound host message"


def test_recording_listing_endpoint(client):
    """GET /api/sss/recordings returns JSON metadata for every recording."""
    # Host a game so at least one recording exists.
    with client.websocket_connect("/api/sss/ws/NEW") as host_ws:
        host_ws.send_json({"type": "host", "name": "Indexed"})
        code = host_ws.receive_json()["code"]
        host_ws.receive_json()
        _time.sleep(0.05)

    resp = client.get("/api/sss/recordings")
    assert resp.status_code == 200
    items = resp.json()
    assert isinstance(items, list)
    match = [item for item in items if item.get("code") == code]
    assert match, f"Recording for game {code} should appear in the listing"
    entry = match[0]
    assert entry["filename"].startswith(code + "_")
    assert entry["filename"].endswith(".jsonl")
    assert entry["size_bytes"] > 0
    assert "modified" in entry


def test_recording_download_endpoint(client):
    """GET /api/sss/recordings/{filename} streams the JSONL back."""
    with client.websocket_connect("/api/sss/ws/NEW") as host_ws:
        host_ws.send_json({"type": "host", "name": "Streamed"})
        code = host_ws.receive_json()["code"]
        host_ws.receive_json()
        _time.sleep(0.05)

    listing = client.get("/api/sss/recordings").json()
    entry = next(item for item in listing if item.get("code") == code)
    filename = entry["filename"]

    resp = client.get(f"/api/sss/recordings/{filename}")
    assert resp.status_code == 200
    body = resp.text
    assert "game_start" in body
    assert code in body


def test_recording_download_rejects_path_traversal(client):
    """Crafted filenames must be rejected before touching the filesystem."""
    bad = client.get("/api/sss/recordings/..%2F..%2Fetc%2Fpasswd")
    assert bad.status_code in (400, 404)
    bad2 = client.get("/api/sss/recordings/not-a-recording.txt")
    assert bad2.status_code == 400


# ── Re-invasion of captured home ───────────────────────────────────────────────

from sss_routes import _games, _build_board, Game, Player


def _make_board_phase_game(code: str, attacker: str, defender: str):
    """Build a 2-player Game with a real board and place both players on owned clusters.

    Both players are pre-marked `connected=False` so the join handler's "previously
    disconnected — allow re-entry" branch fires when our TestClient reconnects.
    """
    game = Game(code=code, host_name=attacker)
    game.board = _build_board(2)
    game.phase = "board"
    game.players = {
        attacker: Player(ws=None, name=attacker, role="player"),
        defender: Player(ws=None, name=defender, role="player"),
    }
    game.players[attacker].connected = False
    game.players[defender].connected = False
    game.turn_order = [attacker, defender]
    game.turn_idx = 0  # attacker's turn
    game.turn_actions_remaining = 3

    # Pick two distinct clusters that have a core (planet) hex.
    cluster_ids = sorted({h["cluster"] for h in game.board if h.get("local") == 0})
    atk_cluster, def_cluster = cluster_ids[0], cluster_ids[1]

    # Defender owns def_cluster: flag on core, planet income source.
    game.player_system[defender] = def_cluster
    def_core = next(h for h in game.board if h["cluster"] == def_cluster and h.get("local") == 0)
    def_core["pieces"].append({"type": "empire_flag", "owner": defender})
    def_core.setdefault("planet", {"food": 1, "science": 0, "tool": 0, "money": 0, "vp": 1})

    # Attacker owns atk_cluster (just so they have a home).
    game.player_system[attacker] = atk_cluster
    atk_core = next(h for h in game.board if h["cluster"] == atk_cluster and h.get("local") == 0)
    atk_core["pieces"].append({"type": "empire_flag", "owner": attacker})
    atk_core.setdefault("planet", {"food": 1, "science": 0, "tool": 0, "money": 0, "vp": 1})

    for p in game.players.values():
        p.resources = {"food": 5, "science": 5, "tool": 5, "money": 5, "unrest": 0}
        p.income = {"food": 1, "science": 1, "tool": 1, "money": 1}
        p.pieces = {"scout": 9}
        p.tech = {}
        p.tech_cards = []
    return game, atk_cluster, def_cluster


def test_player_can_reinvade_their_captured_home(client):
    """Regression: after an opponent takes your home planet (flag now points to them),
    your `player_system[you] == cluster` mapping still points at that cluster — the
    server must NOT use that mapping to short-circuit re-invasion."""
    code = "RINV"
    game, atk_cluster, def_cluster = _make_board_phase_game(code, "Atk", "Def")

    # Simulate the captured-home scenario: defender's flag has been *replaced* by attacker
    # in defender's original cluster, but defender.player_system still points to it.
    def_core = next(h for h in game.board if h["cluster"] == def_cluster and h.get("local") == 0)
    def_core["pieces"] = [pc for pc in def_core["pieces"] if pc["type"] != "empire_flag"]
    def_core["pieces"].append({"type": "empire_flag", "owner": "Atk"})

    # Put a defender scout in def_cluster so they have an attack-capable ship there to invade.
    def_orbital = next(
        h for h in game.board if h["cluster"] == def_cluster and h["type"] == "orbital"
    )
    def_orbital["pieces"].append({"type": "scout", "owner": "Def"})

    # Make it defender's turn.
    game.turn_idx = 1

    _games[code] = game
    try:
        with client.websocket_connect(f"/api/sss/ws/{code}") as ws:
            ws.send_json({"type": "join", "name": "Def", "code": code})
            ws.receive_json()  # joined
            ws.receive_json()  # game_state — rejoin broadcast excludes this socket

            ws.send_json({"type": "invasion_attack", "cluster": def_cluster})
            reply = ws.receive_json()
            assert reply.get("type") != "error", \
                f"Expected re-invasion to be allowed, got error: {reply.get('msg')}"
            # Should be the invasion_prompt sent only to the attacker.
            assert reply["type"] == "invasion_prompt"
            assert reply["dest_cluster"] == def_cluster
    finally:
        _games.pop(code, None)


def test_player_blocked_from_invading_planet_they_currently_own(client):
    """Inverse regression: if the player actually still owns the cluster (their flag is on
    the core hex), invasion_attack must be rejected — but ONLY because the flag confirms
    current ownership, not because of `player_system`."""
    code = "ROWN"
    game, atk_cluster, def_cluster = _make_board_phase_game(code, "Atk", "Def")
    # Give attacker a scout in DEFENDER'S cluster (so the same-cluster check would pass).
    def_orbital = next(h for h in game.board if h["cluster"] == def_cluster and h["type"] == "orbital")
    def_orbital["pieces"].append({"type": "scout", "owner": "Atk"})
    # Now also plant attacker's flag on the defender cluster (they "took" it).
    def_core = next(h for h in game.board if h["cluster"] == def_cluster and h.get("local") == 0)
    def_core["pieces"] = [pc for pc in def_core["pieces"] if pc["type"] != "empire_flag"]
    def_core["pieces"].append({"type": "empire_flag", "owner": "Atk"})

    _games[code] = game
    try:
        with client.websocket_connect(f"/api/sss/ws/{code}") as ws:
            ws.send_json({"type": "join", "name": "Atk", "code": code})
            ws.receive_json()  # joined
            ws.receive_json()  # game_state

            ws.send_json({"type": "invasion_attack", "cluster": def_cluster})
            reply = ws.receive_json()
            assert reply["type"] == "error"
            assert "already own" in reply["msg"]
    finally:
        _games.pop(code, None)
