"""API integration tests for In the Wild — requires DATABASE_URL (Postgres)."""

from __future__ import annotations

import os
import uuid

import pytest
from passlib.hash import bcrypt as bcrypt_hasher

from conftest import auth_headers, register_user, seed_dev_lounge_event, verify_user_id
from credential_service import truncate_for_bcrypt
from models import T1IntheWildUser

pytestmark = [
    pytest.mark.skipif(
        not os.environ.get("DATABASE_URL", "").strip(),
        reason="DATABASE_URL not set",
    ),
    pytest.mark.usefixtures("clean_itw_tables"),
]


def test_discover_filters_by_preferences(client, db_session):
    token_a, profile_a = register_user(client, gender="man", looking_for="women")
    token_b, profile_b = register_user(client, gender="woman", looking_for="men")
    register_user(client, gender="woman", looking_for="women")

    res = client.get("/api/in-the-wild/discover", headers=auth_headers(token_a))
    assert res.status_code == 200
    data = res.json()
    assert data["needs_preferences"] is False
    ids = {p["id"] for p in data["profiles"]}
    assert profile_b["id"] in ids
    assert profile_a["id"] not in ids
    assert len(ids) == 1

    res_b = client.get("/api/in-the-wild/discover", headers=auth_headers(token_b))
    assert profile_a["id"] in {p["id"] for p in res_b.json()["profiles"]}


def test_swipe_rejects_incompatible(client):
    token_a, _profile_a = register_user(client, gender="man", looking_for="women")
    _, profile_c = register_user(client, gender="woman", looking_for="women")

    res = client.post(
        "/api/in-the-wild/swipe",
        headers=auth_headers(token_a),
        json={"target_id": profile_c["id"], "action": "like"},
    )
    assert res.status_code == 400
    assert "preferences" in res.json()["detail"].lower()


def test_venue_match_flow_and_emails(client, db_session, monkeypatch):
    sent: list[dict] = []

    def capture_email(**kwargs):
        sent.append(kwargs)
        return True

    monkeypatch.setattr(
        "t1inthewild_routes.email_service.send_itw_venue_match_email",
        capture_email,
    )

    token_a, profile_a = register_user(client, gender="man", looking_for="women", username="alice")
    token_b, profile_b = register_user(client, gender="woman", looking_for="men", username="bob")
    verify_user_id(db_session, profile_a["id"])
    verify_user_id(db_session, profile_b["id"])

    res_first = client.post(
        "/api/in-the-wild/swipe",
        headers=auth_headers(token_a),
        json={"target_id": profile_b["id"], "action": "like"},
    )
    assert res_first.status_code == 200
    assert res_first.json()["mutual_like"] is False
    assert res_first.json()["new_matches"] == []

    res_second = client.post(
        "/api/in-the-wild/swipe",
        headers=auth_headers(token_b),
        json={"target_id": profile_a["id"], "action": "like"},
    )
    assert res_second.status_code == 200
    assert res_second.json()["mutual_like"] is True
    assert res_second.json()["new_matches"] == []

    event = seed_dev_lounge_event(db_session)

    for token in (token_a, token_b):
        res = client.post(
            f"/api/in-the-wild/events/{event['id']}/check-in",
            headers=auth_headers(token),
            json={"lat": event["latitude"], "lng": event["longitude"]},
        )
        assert res.status_code == 200, res.text
        assert res.json()["new_matches"] == []

    res_a = client.patch(
        "/api/in-the-wild/check-in",
        headers=auth_headers(token_a),
        json={"open_to_meet": True},
    )
    assert res_a.status_code == 200
    assert res_a.json()["new_matches"] == []

    res_b = client.patch(
        "/api/in-the-wild/check-in",
        headers=auth_headers(token_b),
        json={"open_to_meet": True},
    )
    assert res_b.status_code == 200
    new_matches = res_b.json()["new_matches"]
    assert len(new_matches) == 1
    match_id = new_matches[0]["id"]

    assert len(sent) == 2
    recipients = {m["to"] for m in sent}
    assert "alice@itw-test.example" in recipients
    assert "bob@itw-test.example" in recipients
    assert all(m["event_name"] == "Test Dev Lounge" for m in sent)

    msg_res = client.post(
        f"/api/in-the-wild/matches/{match_id}/messages",
        headers=auth_headers(token_a),
        json={"body": "Hey! I'm by the entrance."},
    )
    assert msg_res.status_code == 200
    assert msg_res.json()["body"] == "Hey! I'm by the entrance."

    hist = client.get(
        f"/api/in-the-wild/matches/{match_id}/messages",
        headers=auth_headers(token_b),
    )
    assert hist.status_code == 200
    assert len(hist.json()["messages"]) == 1
    assert hist.json()["can_send"] is True


def test_chat_blocked_until_both_verified(client, db_session):
    token_a, profile_a = register_user(client, gender="man", looking_for="women", username="carl")
    token_b, profile_b = register_user(client, gender="woman", looking_for="men", username="dana")
    verify_user_id(db_session, profile_a["id"])

    res_first = client.post(
        "/api/in-the-wild/swipe",
        headers=auth_headers(token_a),
        json={"target_id": profile_b["id"], "action": "like"},
    )
    assert res_first.status_code == 200
    res_second = client.post(
        "/api/in-the-wild/swipe",
        headers=auth_headers(token_b),
        json={"target_id": profile_a["id"], "action": "like"},
    )
    assert res_second.status_code == 200

    event = seed_dev_lounge_event(db_session)
    for token in (token_a, token_b):
        client.post(
            f"/api/in-the-wild/events/{event['id']}/check-in",
            headers=auth_headers(token),
            json={"lat": event["latitude"], "lng": event["longitude"]},
        )
    client.patch("/api/in-the-wild/check-in", headers=auth_headers(token_a), json={"open_to_meet": True})
    res_b = client.patch("/api/in-the-wild/check-in", headers=auth_headers(token_b), json={"open_to_meet": True})
    match_id = res_b.json()["new_matches"][0]["id"]

    hist = client.get(
        f"/api/in-the-wild/matches/{match_id}/messages",
        headers=auth_headers(token_a),
    )
    assert hist.json()["can_send"] is False

    blocked = client.post(
        f"/api/in-the-wild/matches/{match_id}/messages",
        headers=auth_headers(token_a),
        json={"body": "Hello?"},
    )
    assert blocked.status_code == 403

    verify_user_id(db_session, profile_b["id"])
    ok = client.post(
        f"/api/in-the-wild/matches/{match_id}/messages",
        headers=auth_headers(token_a),
        json={"body": "Now we can chat."},
    )
    assert ok.status_code == 200


def test_discover_needs_preferences(client, db_session):
    user_id = str(uuid.uuid4())
    db_session.add(
        T1IntheWildUser(
            id=user_id,
            email="legacy@itw-test.example",
            username="legacyuser",
            password_hash=bcrypt_hasher.hash(truncate_for_bcrypt("testpass123")),
            display_name="Legacy",
            birth_year=1990,
            gender="",
            looking_for="",
        )
    )
    db_session.commit()

    login = client.post(
        "/api/in-the-wild/login",
        json={"email": "legacy@itw-test.example", "password": "testpass123"},
    )
    assert login.status_code == 200
    token = login.json()["token"]

    res = client.get("/api/in-the-wild/discover", headers=auth_headers(token))
    assert res.status_code == 200
    data = res.json()
    assert data["needs_preferences"] is True
    assert data["profiles"] == []
