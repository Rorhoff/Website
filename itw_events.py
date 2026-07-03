"""In the Wild event discovery helpers — dedupe, radius filter, identity keys."""

from __future__ import annotations

import math
from datetime import datetime

EVENT_DISCOVERY_RADIUS_MILES = 50
EVENT_DISCOVERY_RADIUS_M = int(EVENT_DISCOVERY_RADIUS_MILES * 1609.344)


def normalize_event_identity(name: str, venue_name: str, city: str) -> tuple[str, str, str]:
    return (
        (name or "").strip().lower(),
        (venue_name or "").strip().lower(),
        (city or "").strip().lower(),
    )


def starts_on_same_day(a: datetime, b: datetime) -> bool:
    return a.date() == b.date()


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    x = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(x))


def event_within_radius(
    event_lat: float,
    event_lng: float,
    center_lat: float,
    center_lng: float,
    radius_m: float = EVENT_DISCOVERY_RADIUS_M,
) -> bool:
    return haversine_m(center_lat, center_lng, event_lat, event_lng) <= radius_m


def is_duplicate_submission(
    *,
    existing_name: str,
    existing_venue: str,
    existing_city: str,
    existing_starts: datetime,
    submit_name: str,
    submit_venue: str,
    submit_city: str,
    submit_starts: datetime,
) -> bool:
    if normalize_event_identity(existing_name, existing_venue, existing_city) != normalize_event_identity(
        submit_name, submit_venue, submit_city
    ):
        return False
    return starts_on_same_day(existing_starts, submit_starts)
