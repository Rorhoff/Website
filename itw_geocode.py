"""Geocode city names for In the Wild event discovery (OpenStreetMap Nominatim)."""

from __future__ import annotations

import logging
import os
from functools import lru_cache

import httpx

log = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = os.environ.get("ITW_GEOCODE_USER_AGENT", "InTheWild/1.0 (contact@rorhoff.com)")


@lru_cache(maxsize=512)
def geocode_city(city: str) -> tuple[float, float] | None:
    """Return (latitude, longitude) for a city label, or None if not found."""
    label = (city or "").strip()
    if not label:
        return None
    if os.environ.get("ITW_GEOCODE_DISABLED", "").strip().lower() in ("1", "true", "yes"):
        return None
    try:
        with httpx.Client(timeout=10.0) as client:
            res = client.get(
                NOMINATIM_URL,
                params={"q": label, "format": "json", "limit": 1},
                headers={"User-Agent": USER_AGENT},
            )
            res.raise_for_status()
            rows = res.json()
    except Exception:
        log.exception("Geocode failed for city=%r", label)
        return None
    if not rows:
        return None
    try:
        return float(rows[0]["lat"]), float(rows[0]["lon"])
    except (KeyError, TypeError, ValueError):
        return None
