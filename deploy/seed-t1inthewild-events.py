#!/usr/bin/env python3
"""Seed demo events for In the Wild MVP (idempotent)."""

from __future__ import annotations

import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import func, select

import models  # noqa: F401
from database import SessionLocal
from models import T1IntheWildEvent

DEMO_EVENTS = [
    {
        "slug": "riverfront-summer-fest",
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
        "slug": "sunday-community-gathering",
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
        "slug": "timbers-vs-sounders",
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
        "slug": "indie-night-crystal",
        "name": "Indie Night at the Crystal",
        "description": "Three-band bill — doors at 7pm.",
        "venue_name": "Crystal Ballroom",
        "city": "Portland",
        "latitude": 45.5238,
        "longitude": -122.6810,
        "radius_m": 200,
        "category": "concert",
    },
    {
        "slug": "dev-lounge",
        "name": "Portfolio Dev Lounge",
        "description": "Dev-only test venue on rorhoff.com — check in from anywhere to demo venue matching.",
        "venue_name": "Virtual (dev)",
        "city": "Anywhere",
        "latitude": 45.5152,
        "longitude": -122.6784,
        "radius_m": 500,
        "category": "dev_lounge",
    },
]


def main() -> None:
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        created = 0
        updated = 0
        for ev in DEMO_EVENTS:
            row = db.scalar(
                select(T1IntheWildEvent).where(T1IntheWildEvent.name == ev["name"])
            )
            starts = now - timedelta(hours=2)
            ends = now + timedelta(days=7)
            if row:
                row.description = ev["description"]
                row.venue_name = ev["venue_name"]
                row.city = ev["city"]
                row.latitude = ev["latitude"]
                row.longitude = ev["longitude"]
                row.radius_m = ev["radius_m"]
                row.category = ev["category"]
                row.starts_at = starts
                row.ends_at = ends
                row.is_active = True
                updated += 1
            else:
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
                created += 1
        db.commit()
        total = db.scalar(select(func.count()).select_from(T1IntheWildEvent)) or 0
        print(f"OK  Demo events: {created} created, {updated} refreshed ({total} total)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
