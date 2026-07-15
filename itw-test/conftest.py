"""Shared pytest fixtures for In the Wild tests."""

from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

os.environ.setdefault("SERVICE_MODE", "full")
os.environ.setdefault("EMAIL_DEV_LOG_ONLY", "1")

ITW_TABLES = (
    "t1inthewild_message",
    "t1inthewild_verification",
    "t1inthewild_user_report",
    "t1inthewild_user_block",
    "t1inthewild_push_subscription",
    "t1inthewild_event_plan_alert",
    "t1inthewild_event_plan",
    "t1inthewild_match",
    "t1inthewild_check_in",
    "t1inthewild_like",
    "t1inthewild_session",
    "t1inthewild_waitlist",
    "t1inthewild_user",
    "t1inthewild_event",
)


def database_configured() -> bool:
    return bool(os.environ.get("DATABASE_URL", "").strip())


@pytest.fixture(scope="session")
def itw_db_engine():
    if not database_configured():
        pytest.skip("DATABASE_URL not set — skipping In the Wild integration tests")
    import models  # noqa: F401
    from database import engine
    from itw_schema_upgrade import ensure_itw_schema
    from sqlalchemy import inspect

    if engine is None:
        pytest.skip("Database engine unavailable")

    ensure_itw_schema(engine)

    missing = [
        name
        for name in ITW_TABLES
        if name not in inspect(engine).get_table_names()
    ]
    if missing:
        pytest.skip(f"In the Wild tables missing after schema upgrade: {missing}")

    yield engine


@pytest.fixture
def clean_itw_tables(itw_db_engine):
    from sqlalchemy import text

    table_list = ", ".join(ITW_TABLES)
    with itw_db_engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {table_list} RESTART IDENTITY CASCADE"))


@pytest.fixture
def client(itw_db_engine):
    from fastapi.testclient import TestClient
    from main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def db_session(itw_db_engine):
    from database import SessionLocal

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def register_user(
    client,
    *,
    gender: str,
    looking_for: str,
    username: str | None = None,
    display_name: str | None = None,
) -> tuple[str, dict]:
    suffix = uuid.uuid4().hex[:8]
    explicit_username = username
    email = f"{explicit_username or f'user_{suffix}'}@itw-test.example"
    birth_year = datetime.utcnow().year - 28
    payload = {
        "email": email,
        "password": "testpass123",
        "display_name": display_name or (explicit_username.replace("_", " ").title() if explicit_username else f"Test User {suffix}"),
        "birth_year": birth_year,
        "gender": gender,
        "looking_for": looking_for,
    }
    if explicit_username:
        payload["username"] = explicit_username
    res = client.post(
        "/api/in-the-wild/register",
        json=payload,
    )
    assert res.status_code == 200, res.text
    data = res.json()
    return data["token"], data["profile"]


def verify_user_id(db_session, user_id: str) -> None:
    from models import T1IntheWildUser

    user = db_session.get(T1IntheWildUser, user_id)
    assert user is not None
    user.id_verified = True
    db_session.commit()


def set_user_city_coords(
    db_session,
    user_id: str,
    latitude: float,
    longitude: float,
    *,
    city: str = "Portland",
) -> None:
    from models import T1IntheWildUser

    user = db_session.get(T1IntheWildUser, user_id)
    assert user is not None
    user.city = city
    user.city_latitude = latitude
    user.city_longitude = longitude
    db_session.commit()


def seed_dev_lounge_event(db_session) -> dict:
    from models import T1IntheWildEvent

    event_id = str(uuid.uuid4())
    now = datetime.utcnow()
    event = T1IntheWildEvent(
        id=event_id,
        name="Test Dev Lounge",
        description="Integration test event",
        venue_name="Test Venue",
        city="Test City",
        latitude=40.7608,
        longitude=-111.8910,
        radius_m=300,
        category="dev_lounge",
        starts_at=now - timedelta(hours=1),
        ends_at=now + timedelta(hours=6),
        is_active=True,
    )
    db_session.add(event)
    db_session.commit()
    return {"id": event_id, "latitude": event.latitude, "longitude": event.longitude}


def seed_future_event(db_session, *, name: str = "Summer Fest") -> dict:
    from models import T1IntheWildEvent

    event_id = str(uuid.uuid4())
    now = datetime.utcnow()
    event = T1IntheWildEvent(
        id=event_id,
        name=name,
        description="Future integration test event",
        venue_name="Park Pavilion",
        city="Test City",
        latitude=40.7608,
        longitude=-111.8910,
        radius_m=300,
        category="festival",
        starts_at=now + timedelta(days=14),
        ends_at=now + timedelta(days=14, hours=8),
        is_active=True,
    )
    db_session.add(event)
    db_session.commit()
    return {"id": event_id, "name": name}
