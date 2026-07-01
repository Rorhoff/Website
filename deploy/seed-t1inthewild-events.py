#!/usr/bin/env python3
"""Seed demo events for In the Wild MVP (idempotent)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import func, select

import models  # noqa: F401
from database import SessionLocal
from models import T1IntheWildEvent

DEMO_EVENTS = [
    {
        "name": "Riverfront Summer Fest",
        "description": "Live music, food trucks, and riverside vibes.",
        "venue_name": "Riverfront Park",
        "city": "Portland",
        "latitude": 45.5152,
        "longitude": -122.6784,
        "radius_m": 400,
        "category": "festival",
    },
    {
        "name": "Sunday Community Gathering",
        "description": "Weekly service and fellowship hour.",
        "venue_name": "Grace Community Church",
        "city": "Portland",
        "latitude": 45.5231,
        "longitude": -122.6765,
        "radius_m": 150,
        "category": "church",
    },
    {
        "name": "Timbers vs. Sounders",
        "description": "MLS rivalry night at Providence Park.",
        "venue_name": "Providence Park",
        "city": "Portland",
        "latitude": 45.5215,
        "longitude": -122.6919,
        "radius_m": 500,
        "category": "sports",
    },
    {
        "name": "Indie Night at the Crystal",
        "description": "Three-band bill — doors at 7pm.",
        "venue_name": "Crystal Ballroom",
        "city": "Portland",
        "latitude": 45.5238,
        "longitude": -122.6810,
        "radius_m": 200,
        "category": "concert",
    },
]


def main() -> None:
    db = SessionLocal()
    try:
        count = db.scalar(select(func.count()).select_from(T1IntheWildEvent)) or 0
        if count > 0:
            print(f"OK  {count} event(s) already exist — skipping seed")
            return

        now = datetime.utcnow()
        for i, ev in enumerate(DEMO_EVENTS):
            starts = now + timedelta(days=i, hours=-2)
            ends = starts + timedelta(hours=8)
            db.add(
                T1IntheWildEvent(
                    id=str(uuid.uuid4()),
                    name=ev["name"],
                    description=ev["description"],
                    venue_name=ev["venue_name"],
                    city=ev["city"],
                    latitude=ev["latitude"],
                    longitude=ev["longitude"],
                    radius_m=ev["radius_m"],
                    category=ev["category"],
                    starts_at=starts,
                    ends_at=ends,
                    is_active=True,
                )
            )
        db.commit()
        print(f"OK  Seeded {len(DEMO_EVENTS)} demo events")
    finally:
        db.close()


if __name__ == "__main__":
    main()
