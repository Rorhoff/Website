"""Shared fixtures for MotherWyrm relay tests."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from main import app  # noqa: E402
import motherwyrm_routes  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def clear_mw_rooms():
    motherwyrm_routes.rooms.clear()
    yield
    motherwyrm_routes.rooms.clear()
