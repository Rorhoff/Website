"""
Import a small batch of Craigslist (Salt Lake) listings into classified_ad.

Default cap: 10 listings per run. Upsert by (listing_source='craigslist', source_listing_id).

Usage:
    ENV_FILE=/home/ubuntu/website-prod/.env.prod python -m tools.sync_craigslist_classifieds

Kill switch: CRAIGSLIST_IMPORT_ENABLED=0
"""

from __future__ import annotations

import logging
import os
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv  # noqa: E402

_env_file = os.environ.get("ENV_FILE") or str(REPO_ROOT / ".env")
load_dotenv(_env_file)

from sqlalchemy import delete, select  # noqa: E402

import credential_service  # noqa: E402
from database import SessionLocal  # noqa: E402
from models import ClassifiedAd  # noqa: E402
from tools.aggregated_listing import AggregatedListing  # noqa: E402
from tools.craigslist_client import CraigslistClient  # noqa: E402

log = logging.getLogger("sync-craigslist")
logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)s  %(message)s")

SOURCE = "craigslist"
AUTHOR = "craigslist_import"
CONTACT = "Craigslist"
STATE = "Utah"


def _enabled() -> bool:
    raw = os.environ.get("CRAIGSLIST_IMPORT_ENABLED", "1").strip().lower()
    return raw not in ("0", "false", "no", "off")


def _upsert(db, listing: AggregatedListing, *, seen_at: datetime) -> str:
    row = db.scalar(
        select(ClassifiedAd).where(
            ClassifiedAd.listing_source == SOURCE,
            ClassifiedAd.source_listing_id == listing.source_listing_id,
        )
    )
    images = [listing.image_url] if listing.image_url else []
    if row is None:
        db.add(
            ClassifiedAd(
                id=str(uuid.uuid4()),
                user_id=None,
                title=listing.title,
                state=listing.state or STATE,
                city=listing.city or None,
                category=listing.category,
                sub_category=listing.sub_category,
                price=listing.price,
                description=listing.description,
                images=images,
                author_username=AUTHOR,
                contact_name=CONTACT,
                listing_source=SOURCE,
                source_listing_id=listing.source_listing_id,
                source_url=listing.source_url,
                source_last_seen_at=seen_at,
                imported_at=seen_at,
            )
        )
        return "inserted"
    row.title = listing.title
    row.state = listing.state or STATE
    row.city = listing.city or None
    row.category = listing.category
    row.sub_category = listing.sub_category
    row.price = listing.price
    row.description = listing.description
    row.images = images
    row.source_url = listing.source_url
    row.source_last_seen_at = seen_at
    if row.imported_at is None:
        row.imported_at = seen_at
    return "updated"


def main() -> int:
    if not _enabled():
        log.info("Craigslist import disabled (CRAIGSLIST_IMPORT_ENABLED=0); exiting.")
        return 0
    if not credential_service.database_enabled() or SessionLocal is None:
        log.error("DATABASE_URL is not configured.")
        return 1

    sync_start = datetime.now(UTC).replace(tzinfo=None)
    client = CraigslistClient()
    stats = {"fetched": 0, "inserted": 0, "updated": 0, "pruned": 0, "errors": 0}

    try:
        listings = client.fetch_listings()
    finally:
        client.close()

    db = SessionLocal()
    try:
        for listing in listings:
            stats["fetched"] += 1
            try:
                action = _upsert(
                    db, listing, seen_at=datetime.now(UTC).replace(tzinfo=None)
                )
                stats[action] += 1
            except Exception:
                db.rollback()
                log.exception("Failed to upsert Craigslist %s", listing.source_listing_id)
                stats["errors"] += 1
        db.commit()

        prune = db.execute(
            delete(ClassifiedAd).where(
                ClassifiedAd.listing_source == SOURCE,
                ClassifiedAd.source_last_seen_at < sync_start,
            )
        )
        db.commit()
        stats["pruned"] = prune.rowcount or 0

        log.info(
            "Craigslist sync complete: fetched=%d inserted=%d updated=%d errors=%d pruned=%d",
            stats["fetched"],
            stats["inserted"],
            stats["updated"],
            stats["errors"],
            stats["pruned"],
        )
        return 0 if stats["errors"] == 0 else 2
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
