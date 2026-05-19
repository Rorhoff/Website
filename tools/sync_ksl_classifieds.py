"""
Daily KSL Classifieds sync — Utah aggregator listings into classified_ad.

Upserts by (listing_source='ksl', source_listing_id), prunes rows not seen in the
current run, caps total active imports.

Usage:
    ENV_FILE=/home/ubuntu/website-prod/.env.prod python -m tools.sync_ksl_classifieds

Kill switch:
    KSL_IMPORT_ENABLED=0  → exit 0 without touching the database.

Requires DATABASE_URL (same as the web service).
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
from tools.ksl_client import KslClient, KslListing  # noqa: E402

log = logging.getLogger("sync-ksl")
logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)s  %(message)s")

KSL_SOURCE = "ksl"
KSL_AUTHOR = "ksl_import"
KSL_CONTACT = "KSL Classifieds"
KSL_STATE = "Utah"


def _enabled() -> bool:
    raw = os.environ.get("KSL_IMPORT_ENABLED", "1").strip().lower()
    return raw not in ("0", "false", "no", "off")


def _max_listings() -> int:
    try:
        return max(1, int(os.environ.get("KSL_IMPORT_MAX_LISTINGS", "500")))
    except ValueError:
        return 500


def _images_for(listing: KslListing) -> list[str]:
    if listing.image_url:
        return [listing.image_url]
    return []


def _upsert(db, listing: KslListing, *, seen_at: datetime) -> str:
    row = db.scalar(
        select(ClassifiedAd).where(
            ClassifiedAd.listing_source == KSL_SOURCE,
            ClassifiedAd.source_listing_id == listing.source_listing_id,
        )
    )
    images = _images_for(listing)
    if row is None:
        row = ClassifiedAd(
            id=str(uuid.uuid4()),
            user_id=None,
            title=listing.title,
            state=listing.state,
            city=listing.city or None,
            category=listing.category,
            sub_category=listing.sub_category,
            price=listing.price,
            description=listing.description,
            images=images,
            author_username=KSL_AUTHOR,
            contact_name=KSL_CONTACT,
            listing_source=KSL_SOURCE,
            source_listing_id=listing.source_listing_id,
            source_url=listing.source_url,
            source_last_seen_at=seen_at,
            imported_at=seen_at,
        )
        db.add(row)
        return "inserted"
    row.title = listing.title
    row.state = listing.state
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
        log.info("KSL import disabled (KSL_IMPORT_ENABLED=0); exiting.")
        return 0
    if not credential_service.database_enabled() or SessionLocal is None:
        log.error("DATABASE_URL is not configured.")
        return 1

    cap = _max_listings()
    sync_start = datetime.now(UTC).replace(tzinfo=None)
    client = KslClient()

    log.info("Fetching KSL search listing IDs (cap=%d)…", cap)
    try:
        listing_ids = client.fetch_search_listing_ids()[:cap]
    finally:
        client.close()
    log.info("Found %d listing IDs to process", len(listing_ids))

    stats = {"fetched": 0, "inserted": 0, "updated": 0, "skipped": 0, "errors": 0, "pruned": 0}

    db = SessionLocal()
    try:
        for lid in listing_ids:
            stats["fetched"] += 1
            try:
                listing = client.fetch_listing(lid)
            except Exception:
                log.exception("Failed to fetch KSL listing %s", lid)
                stats["errors"] += 1
                continue
            if listing is None:
                stats["skipped"] += 1
                continue
            try:
                action = _upsert(
                    db, listing, seen_at=datetime.now(UTC).replace(tzinfo=None)
                )
                stats[action] += 1
                if (stats["inserted"] + stats["updated"]) % 25 == 0:
                    db.commit()
            except Exception:
                db.rollback()
                log.exception("Failed to upsert KSL listing %s", lid)
                stats["errors"] += 1
        db.commit()

        prune_result = db.execute(
            delete(ClassifiedAd).where(
                ClassifiedAd.listing_source == KSL_SOURCE,
                ClassifiedAd.source_last_seen_at < sync_start,
            )
        )
        db.commit()
        stats["pruned"] = prune_result.rowcount or 0

        log.info(
            "KSL sync complete: fetched=%d inserted=%d updated=%d skipped=%d errors=%d pruned=%d",
            stats["fetched"],
            stats["inserted"],
            stats["updated"],
            stats["skipped"],
            stats["errors"],
            stats["pruned"],
        )
        return 0 if stats["errors"] == 0 else 2
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
