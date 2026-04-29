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
    """A 5th player should be rejected."""
    code = None
    connections = []
    try:
        host_ws = client.websocket_connect("/api/sss/ws/NEW").__enter__()
        connections.append(host_ws)
        host_ws.send_json({"type": "host", "name": "P0"})
        code = host_ws.receive_json()["code"]
        host_ws.receive_json()  # game_state

        for i in range(1, 4):
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

        # 5th connection attempt
        ws5 = client.websocket_connect(f"/api/sss/ws/{code}").__enter__()
        connections.append(ws5)
        ws5.send_json({"type": "join", "name": "P4", "code": code})
        msg = ws5.receive_json()
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
