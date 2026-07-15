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


def _round_coord(value: float, places: int = 4) -> float:
    return round(value, places)


@lru_cache(maxsize=1024)
def reverse_geocode(lat: float, lng: float) -> dict[str, str]:
    """Reverse-geocode coordinates to a short venue label and city."""
    if os.environ.get("ITW_GEOCODE_DISABLED", "").strip().lower() in ("1", "true", "yes"):
        return {"venue_name": "", "city": "", "label": "Current location"}
    lat_r, lng_r = _round_coord(lat), _round_coord(lng)
    try:
        with httpx.Client(timeout=10.0) as client:
            res = client.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={"lat": lat_r, "lon": lng_r, "format": "json", "zoom": 18},
                headers={"User-Agent": USER_AGENT},
            )
            res.raise_for_status()
            data = res.json()
    except Exception:
        log.exception("Reverse geocode failed lat=%s lng=%s", lat_r, lng_r)
        return {"venue_name": "", "city": "", "label": "Current location"}

    address = data.get("address") if isinstance(data.get("address"), dict) else {}
    venue = (
        (data.get("name") or "").strip()
        or (address.get("amenity") or "").strip()
        or (address.get("shop") or "").strip()
        or (address.get("building") or "").strip()
        or (address.get("road") or "").strip()
    )
    city = (
        (address.get("city") or "").strip()
        or (address.get("town") or "").strip()
        or (address.get("village") or "").strip()
        or (address.get("county") or "").strip()
    )
    if venue and city:
        label = f"{venue}, {city}"
    elif venue:
        label = venue
    elif city:
        label = city
    else:
        label = "Current location"
    return {"venue_name": venue, "city": city, "label": label}
