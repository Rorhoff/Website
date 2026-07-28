"""Integration tests for In the Wild event plans and overlap notifications."""

from __future__ import annotations

import os

import pytest

from conftest import (
    auth_headers,
    register_user,
    seed_dev_lounge_event,
    seed_future_event,
    set_user_city_coords,
)

pytestmark = [
    pytest.mark.skipif(
        not os.environ.get("DATABASE_URL", "").strip(),
        reason="DATABASE_URL not set",
    ),
    pytest.mark.usefixtures("clean_itw_tables"),
]


def _mutual_like(client, token_a, profile_a_id, token_b, profile_b_id) -> None:
    res_a = client.post(
        "/api/in-the-wild/swipe",
        headers=auth_headers(token_a),
        json={"target_id": profile_b_id, "action": "like"},
    )
    assert res_a.status_code == 200, res_a.text
    assert res_a.json()["mutual_like"] is False

    res_b = client.post(
        "/api/in-the-wild/swipe",
        headers=auth_headers(token_b),
        json={"target_id": profile_a_id, "action": "like"},
    )
    assert res_b.status_code == 200, res_b.text
    assert res_b.json()["mutual_like"] is True


def test_add_remove_event_plan(client, db_session):
    token, profile = register_user(client, gender="man", looking_for="women", username="planner")
    event = seed_future_event(db_session, name="Jazz Night")
    # Event discovery is city-scoped now: without profile coords near the
    # seeded event (Salt Lake City), /events drops it once the plan is removed.
    set_user_city_coords(
        db_session, profile["id"], 40.7608, -111.8910, city="Salt Lake City"
    )

    add = client.post(
        f"/api/in-the-wild/events/{event['id']}/plan",
        headers=auth_headers(token),
    )
    assert add.status_code == 200, add.text
    body = add.json()
    assert body["ok"] is True
    assert body["is_going"] is True
    assert body["event"]["id"] == event["id"]
    assert body["new_overlaps"] == []

    listed = client.get("/api/in-the-wild/event-plans", headers=auth_headers(token))
    assert listed.status_code == 200
    plans = listed.json()["plans"]
    assert len(plans) == 1
    assert plans[0]["event"]["id"] == event["id"]
    assert plans[0]["event"]["is_going"] is True

    events_res = client.get("/api/in-the-wild/events", headers=auth_headers(token))
    match = next(e for e in events_res.json()["events"] if e["id"] == event["id"])
    assert match["is_going"] is True
    assert match["can_plan"] is True

    remove = client.delete(
        f"/api/in-the-wild/events/{event['id']}/plan",
        headers=auth_headers(token),
    )
    assert remove.status_code == 200
    assert remove.json()["is_going"] is False

    events_after = client.get("/api/in-the-wild/events", headers=auth_headers(token))
    match_after = next(e for e in events_after.json()["events"] if e["id"] == event["id"])
    assert match_after["is_going"] is False


def test_dev_lounge_rejects_event_plan(client, db_session):
    token, _profile = register_user(client, gender="woman", looking_for="men", username="devuser")
    event = seed_dev_lounge_event(db_session)

    res = client.post(
        f"/api/in-the-wild/events/{event['id']}/plan",
        headers=auth_headers(token),
    )
    assert res.status_code == 400
    assert "cannot be added" in res.json()["detail"].lower()


def test_event_plan_overlap_on_mutual_like(client, db_session, monkeypatch):
    sent: list[dict] = []

    monkeypatch.setattr(
        "t1inthewild_routes.email_service.send_itw_event_plan_overlap_email",
        lambda **kwargs: sent.append(kwargs) or True,
    )

    token_a, profile_a = register_user(client, gender="man", looking_for="women", username="eve")
    token_b, profile_b = register_user(client, gender="woman", looking_for="men", username="frank")
    event = seed_future_event(db_session)

    for token in (token_a, token_b):
        plan = client.post(
            f"/api/in-the-wild/events/{event['id']}/plan",
            headers=auth_headers(token),
        )
        assert plan.status_code == 200
        assert plan.json()["new_overlaps"] == []

    res_first = client.post(
        "/api/in-the-wild/swipe",
        headers=auth_headers(token_a),
        json={"target_id": profile_b["id"], "action": "like"},
    )
    assert res_first.json()["new_overlaps"] == []

    res_mutual = client.post(
        "/api/in-the-wild/swipe",
        headers=auth_headers(token_b),
        json={"target_id": profile_a["id"], "action": "like"},
    )
    assert res_mutual.status_code == 200
    overlaps = res_mutual.json()["new_overlaps"]
    assert len(overlaps) == 1
    assert overlaps[0]["event"]["id"] == event["id"]
    assert overlaps[0]["other_user"]["id"] == profile_a["id"]

    repeat = client.post(
        f"/api/in-the-wild/events/{event['id']}/plan",
        headers=auth_headers(token_a),
    )
    assert repeat.json()["new_overlaps"] == []

    assert len(sent) == 2
    assert {m["to"] for m in sent} == {"eve@itw-test.example", "frank@itw-test.example"}
    assert all(m["event_name"] == event["name"] for m in sent)


def test_event_plan_overlap_when_adding_plan_after_mutual_like(client, db_session, monkeypatch):
    sent: list[dict] = []

    monkeypatch.setattr(
        "t1inthewild_routes.email_service.send_itw_event_plan_overlap_email",
        lambda **kwargs: sent.append(kwargs) or True,
    )

    token_a, profile_a = register_user(client, gender="man", looking_for="women", username="gabe")
    token_b, profile_b = register_user(client, gender="woman", looking_for="men", username="hannah")
    event = seed_future_event(db_session, name="Food Truck Rally")

    _mutual_like(client, token_a, profile_a["id"], token_b, profile_b["id"])

    plan_a = client.post(
        f"/api/in-the-wild/events/{event['id']}/plan",
        headers=auth_headers(token_a),
    )
    assert plan_a.status_code == 200
    assert plan_a.json()["new_overlaps"] == []

    plan_b = client.post(
        f"/api/in-the-wild/events/{event['id']}/plan",
        headers=auth_headers(token_b),
    )
    assert plan_b.status_code == 200
    overlaps = plan_b.json()["new_overlaps"]
    assert len(overlaps) == 1
    assert overlaps[0]["event"]["id"] == event["id"]
    assert overlaps[0]["other_user"]["id"] == profile_a["id"]

    assert len(sent) == 2
    assert {m["to"] for m in sent} == {"gabe@itw-test.example", "hannah@itw-test.example"}
