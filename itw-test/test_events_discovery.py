"""Integration tests for event discovery radius and user-submitted events."""

from __future__ import annotations

import os
from datetime import datetime, timedelta

import pytest

from conftest import auth_headers, register_user, set_user_city_coords
from models import T1IntheWildEvent

pytestmark = [
    pytest.mark.skipif(
        not os.environ.get("DATABASE_URL", "").strip(),
        reason="DATABASE_URL not set",
    ),
    pytest.mark.usefixtures("clean_itw_tables"),
]

PORTLAND = (45.5152, -122.6784)
DENVER = (39.7392, -104.9903)


def seed_event_at(
    db_session,
    *,
    name: str,
    latitude: float,
    longitude: float,
    city: str,
    venue_name: str = "Test Venue",
) -> str:
    import uuid

    event_id = str(uuid.uuid4())
    now = datetime.utcnow()
    event = T1IntheWildEvent(
        id=event_id,
        name=name,
        description="Test event",
        venue_name=venue_name,
        city=city,
        latitude=latitude,
        longitude=longitude,
        radius_m=300,
        category="community",
        starts_at=now + timedelta(days=7),
        ends_at=now + timedelta(days=7, hours=6),
        is_active=True,
    )
    db_session.add(event)
    db_session.commit()
    return event_id


def test_events_filtered_within_50_miles(client, db_session):
    token, profile = register_user(client, gender="man", looking_for="women", username="nearby")
    set_user_city_coords(db_session, profile["id"], *PORTLAND, city="Portland")

    near_id = seed_event_at(db_session, name="Near Fest", latitude=45.5238, longitude=-122.6810, city="Portland")
    seed_event_at(db_session, name="Far Fest", latitude=DENVER[0], longitude=DENVER[1], city="Denver")

    res = client.get("/api/in-the-wild/events", headers=auth_headers(token))
    assert res.status_code == 200
    data = res.json()
    assert data["filter"]["geocode_ok"] is True
    assert data["filter"]["city"] == "Portland"
    assert data["filter"]["radius_miles"] == 50
    ids = {e["id"] for e in data["events"]}
    assert near_id in ids
    assert all(e["name"] != "Far Fest" for e in data["events"])


def test_submit_event_and_dedupe(client, db_session, monkeypatch):
    token, profile = register_user(client, gender="woman", looking_for="men", username="submitter")
    set_user_city_coords(db_session, profile["id"], *PORTLAND, city="Portland")

    def fake_geocode(city: str):
        return PORTLAND

    monkeypatch.setattr("t1inthewild_routes.itw_geocode.geocode_city", fake_geocode)

    now = datetime.utcnow()
    body = {
        "name": "Neighborhood Block Party",
        "venue_name": "Oak Street Park",
        "city": "Portland",
        "description": "Potluck and music",
        "starts_at": (now + timedelta(days=10)).isoformat(),
        "ends_at": (now + timedelta(days=10, hours=4)).isoformat(),
    }
    first = client.post("/api/in-the-wild/events", headers=auth_headers(token), json=body)
    assert first.status_code == 200
    first_data = first.json()
    assert first_data["already_exists"] is False
    assert first_data["event"]["user_submitted"] is True
    event_id = first_data["event"]["id"]

    second = client.post("/api/in-the-wild/events", headers=auth_headers(token), json=body)
    assert second.status_code == 200
    second_data = second.json()
    assert second_data["already_exists"] is True
    assert second_data["event"]["id"] == event_id

    listed = client.get("/api/in-the-wild/events", headers=auth_headers(token))
    assert any(e["id"] == event_id for e in listed.json()["events"])


def test_discover_returns_compatibility_scores(client, db_session):
    token_a, profile_a = register_user(client, gender="man", looking_for="women", username="comp_a")
    _, profile_b = register_user(client, gender="woman", looking_for="men", username="comp_b")
    set_user_city_coords(db_session, profile_a["id"], *PORTLAND, city="Portland")
    set_user_city_coords(db_session, profile_b["id"], *PORTLAND, city="Portland")

    client.patch(
        "/api/in-the-wild/me",
        headers=auth_headers(token_a),
        json={"interests": ["hiking", "coffee"]},
    )

    res = client.get("/api/in-the-wild/discover", headers=auth_headers(token_a))
    assert res.status_code == 200
    profiles = res.json()["profiles"]
    assert len(profiles) == 1
    p = profiles[0]
    assert "compatibility_pct" in p
    assert "interest_match_pct" in p
    assert "vicinity_pct" in p
    assert p["vicinity_pct"] == 100
