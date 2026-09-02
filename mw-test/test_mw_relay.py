"""WebSocket integration tests for MotherWyrm TV + phone relay."""


def test_tv_host_receives_code(client):
    with client.websocket_connect("/api/mw/ws") as tv:
        tv.send_json({"t": "host"})
        msg = tv.receive_json()
        assert msg["t"] == "hosted"
        assert len(msg["code"]) == 4
        assert msg["code"].isalpha()


def test_phone_join_notifies_tv(client):
    with client.websocket_connect("/api/mw/ws") as tv:
        tv.send_json({"t": "host"})
        code = tv.receive_json()["code"]

        with client.websocket_connect("/api/mw/ws") as phone:
            phone.send_json({"t": "join", "code": code, "name": "Whelp"})
            joined = phone.receive_json()
            assert joined["t"] == "joined"
            assert joined["pid"] == 1
            assert joined["name"] == "Whelp"

            join_evt = tv.receive_json()
            assert join_evt["t"] == "player_join"
            assert join_evt["pid"] == 1
            assert join_evt["name"] == "Whelp"


def test_tv_assigns_team_and_role_to_phone(client):
    with client.websocket_connect("/api/mw/ws") as tv:
        tv.send_json({"t": "host"})
        code = tv.receive_json()["code"]

        with client.websocket_connect("/api/mw/ws") as phone:
            phone.send_json({"t": "join", "code": code, "name": "Alpha"})
            phone.receive_json()

            tv.receive_json()
            tv.send_json({"t": "assign", "pid": 1, "team": "blue", "role": "mother"})

            assigned = phone.receive_json()
            assert assigned["t"] == "assigned"
            assert assigned["team"] == "blue"
            assert assigned["role"] == "mother"


def test_phone_input_relays_to_tv(client):
    with client.websocket_connect("/api/mw/ws") as tv:
        tv.send_json({"t": "host"})
        code = tv.receive_json()["code"]

        with client.websocket_connect("/api/mw/ws") as phone:
            phone.send_json({"t": "join", "code": code, "name": "Mover"})
            pid = phone.receive_json()["pid"]
            tv.receive_json()

            phone.send_json({"t": "i", "x": 0.75, "y": -0.5})
            stick = tv.receive_json()
            assert stick["t"] == "i"
            assert stick["pid"] == pid
            assert stick["x"] == 0.75
            assert stick["y"] == -0.5

            phone.send_json({"t": "b", "k": "jump", "d": 1})
            btn = tv.receive_json()
            assert btn["t"] == "b"
            assert btn["k"] == "jump"
            assert btn["d"] == 1


def test_tv_countdown_relays_to_phone(client):
    with client.websocket_connect("/api/mw/ws") as tv:
        tv.send_json({"t": "host"})
        code = tv.receive_json()["code"]

        with client.websocket_connect("/api/mw/ws") as phone:
            phone.send_json({"t": "join", "code": code, "name": "Ready"})
            pid = phone.receive_json()["pid"]
            tv.receive_json()

            tv.send_json({"t": "countdown", "pid": pid, "n": 2})
            msg = phone.receive_json()
            assert msg["t"] == "countdown"
            assert msg["n"] == 2


def test_pad_deep_link_serves_join_page(client):
    res = client.get("/mw/pad/c/FKVK")
    assert res.status_code == 200
    assert "MotherWyrm" in res.text
    assert "joinBtn" in res.text


def test_join_rejects_unknown_code(client):
    with client.websocket_connect("/api/mw/ws") as phone:
        phone.send_json({"t": "join", "code": "ZZZZ", "name": "Lost"})
        msg = phone.receive_json()
        assert msg["t"] == "error"


def test_join_rejects_full_room(client):
    with client.websocket_connect("/api/mw/ws") as tv:
        tv.send_json({"t": "host"})
        code = tv.receive_json()["code"]

        phones = []
        try:
            for i in range(10):
                ws = client.websocket_connect("/api/mw/ws").__enter__()
                phones.append(ws)
                ws.send_json({"t": "join", "code": code, "name": f"P{i}"})
                ws.receive_json()
                tv.receive_json()

            with client.websocket_connect("/api/mw/ws") as extra:
                extra.send_json({"t": "join", "code": code, "name": "Overflow"})
                msg = extra.receive_json()
                assert msg["t"] == "error"
                assert "full" in msg["reason"].lower()
        finally:
            for ws in phones:
                ws.__exit__(None, None, None)


def test_phone_disconnect_notifies_tv(client):
    with client.websocket_connect("/api/mw/ws") as tv:
        tv.send_json({"t": "host"})
        code = tv.receive_json()["code"]

        phone_ctx = client.websocket_connect("/api/mw/ws")
        phone = phone_ctx.__enter__()
        phone.send_json({"t": "join", "code": code, "name": "Ghost"})
        pid = phone.receive_json()["pid"]
        tv.receive_json()
        phone_ctx.__exit__(None, None, None)

        leave = tv.receive_json()
        assert leave["t"] == "player_leave"
        assert leave["pid"] == pid
