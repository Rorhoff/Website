"""Geocode city names for In the Wild event discovery (OpenStreetMap Nominatim)."""

from __future__ import annotations

import logging
import math
import os
from functools import lru_cache
from typing import Any

import httpx

log = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = os.environ.get("ITW_GEOCODE_USER_AGENT", "InTheWild/1.0 (contact@rorhoff.com)")

_SETTLEMENT_TYPES = frozenset(
    {"city", "town", "village", "hamlet", "suburb", "neighbourhood", "municipality"}
)


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    x = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(x))


def _geocode_score(row: dict[str, Any]) -> float:
    cls = (row.get("class") or "").strip()
    typ = (row.get("type") or "").strip()
    importance = float(row.get("importance") or 0)
    if cls == "boundary" and typ == "administrative":
        return 100 + importance * 10
    if cls == "place" and typ in _SETTLEMENT_TYPES:
        return 80 + importance * 10
    if typ == "peak" or cls == "natural":
        return 10 + importance
    return 20 + importance


def pick_best_geocode_result(
    rows: list[dict[str, Any]],
    *,
    near_lat: float | None = None,
    near_lng: float | None = None,
) -> tuple[float, float]:
    """Choose the best settlement-like Nominatim hit instead of the first raw result."""
    if not rows:
        raise ValueError("No geocode results")
    parsed: list[tuple[float, float, float, dict[str, Any]]] = []
    for row in rows:
        try:
            lat = float(row["lat"])
            lng = float(row["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        parsed.append((lat, lng, _geocode_score(row), row))
    if not parsed:
        raise ValueError("No valid geocode results")

    if near_lat is not None and near_lng is not None:
        settlements = [p for p in parsed if p[2] >= 80]
        pool = settlements or parsed
        best = min(pool, key=lambda p: _haversine_m(near_lat, near_lng, p[0], p[1]))
        return best[0], best[1]

    best = max(parsed, key=lambda p: p[2])
    return best[0], best[1]


def _geocode_search(
    label: str,
    *,
    near_lat: float | None = None,
    near_lng: float | None = None,
) -> tuple[float, float] | None:
    query = (label or "").strip()
    if not query:
        return None
    if os.environ.get("ITW_GEOCODE_DISABLED", "").strip().lower() in ("1", "true", "yes"):
        return None
    try:
        with httpx.Client(timeout=10.0) as client:
            res = client.get(
                NOMINATIM_URL,
                params={
                    "q": query,
                    "format": "json",
                    "limit": 5,
                    "countrycodes": "us",
                    "addressdetails": 1,
                },
                headers={"User-Agent": USER_AGENT},
            )
            res.raise_for_status()
            rows = res.json()
    except Exception:
        log.exception("Geocode failed for city=%r", query)
        return None
    if not rows:
        return None
    try:
        return pick_best_geocode_result(rows, near_lat=near_lat, near_lng=near_lng)
    except ValueError:
        return None


@lru_cache(maxsize=512)
def _geocode_city_cached(city: str) -> tuple[float, float] | None:
    return _geocode_search(city)


def geocode_city(
    city: str,
    *,
    near_lat: float | None = None,
    near_lng: float | None = None,
) -> tuple[float, float] | None:
    """Return (latitude, longitude) for a city label, or None if not found."""
    label = (city or "").strip()
    if not label:
        return None
    if near_lat is not None and near_lng is not None:
        return _geocode_search(label, near_lat=near_lat, near_lng=near_lng)
    return _geocode_city_cached(label)


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
