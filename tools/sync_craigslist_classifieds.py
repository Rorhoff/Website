"""
Import Craigslist for-sale listings into classified_ad — up to 10 per US state.

Upsert by (listing_source='craigslist', source_listing_id). Prunes imports not
refreshed in the current run.

Usage:
    ENV_FILE=/home/ubuntu/website-prod/.env.prod python -m tools.sync_craigslist_classifieds

Optional:
    CRAIGSLIST_IMPORT_STATES=Utah,Texas   # comma-separated subset
    CRAIGSLIST_IMPORT_MAX_PER_STATE=10

Import is off by default. Enable with CRAIGSLIST_IMPORT_ENABLED=1.
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
from tools.craigslist_client import CraigslistClient, per_state_cap  # noqa: E402
from tools.craigslist_sites import STATE_CRAIGSLIST_SITE, states_to_sync  # noqa: E402

log = logging.getLogger("sync-craigslist")
logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)s  %(message)s")

SOURCE = "craigslist"
AUTHOR = "craigslist_import"
CONTACT = "Craigslist"


def _enabled() -> bool:
    raw = os.environ.get("CRAIGSLIST_IMPORT_ENABLED", "0").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _states_filter() -> list[tuple[str, str]]:
    raw = os.environ.get("CRAIGSLIST_IMPORT_STATES", "").strip()
    if not raw:
        return states_to_sync()
    want = {s.strip().lower() for s in raw.split(",") if s.strip()}
    return [
        (name, site)
        for name, site in states_to_sync()
        if name.lower() in want
    ]


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
                state=listing.state,
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
        log.info("Craigslist import disabled (CRAIGSLIST_IMPORT_ENABLED=0); exiting.")
        return 0
    if not credential_service.database_enabled() or SessionLocal is None:
        log.error("DATABASE_URL is not configured.")
        return 1

    state_sites = _states_filter()
    if not state_sites:
        log.error("CRAIGSLIST_IMPORT_STATES matched no known states.")
        return 1

    cap = per_state_cap()
    sync_start = datetime.now(UTC).replace(tzinfo=None)
    client = CraigslistClient()
    stats = {
        "states": 0,
        "fetched": 0,
        "inserted": 0,
        "updated": 0,
        "pruned": 0,
        "errors": 0,
    }

    try:
        for state_name, site_base in state_sites:
            if state_name not in STATE_CRAIGSLIST_SITE:
                log.warning("No Craigslist site for state %s; skipping", state_name)
                continue
            stats["states"] += 1
            try:
                listings = client.fetch_listings(
                    site_base=site_base, state=state_name, limit=cap
                )
            except Exception:
                log.exception("Craigslist fetch failed for %s", state_name)
                stats["errors"] += 1
                continue

            db = SessionLocal()
            try:
                for listing in listings:
                    stats["fetched"] += 1
                    try:
                        action = _upsert(
                            db,
                            listing,
                            seen_at=datetime.now(UTC).replace(tzinfo=None),
                        )
                        stats[action] += 1
                    except Exception:
                        db.rollback()
                        log.exception(
                            "Failed to upsert Craigslist %s (%s)",
                            listing.source_listing_id,
                            state_name,
                        )
                        stats["errors"] += 1
                db.commit()
            finally:
                db.close()
    finally:
        client.close()

    db = SessionLocal()
    try:
        legacy = db.execute(
            delete(ClassifiedAd).where(ClassifiedAd.listing_source == "ksl")
        )
        if legacy.rowcount:
            log.info(
                "Removed %d legacy import rows (listing_source=ksl)", legacy.rowcount
            )

        prune = db.execute(
            delete(ClassifiedAd).where(
                ClassifiedAd.listing_source == SOURCE,
                ClassifiedAd.source_last_seen_at < sync_start,
            )
        )
        db.commit()
        stats["pruned"] = prune.rowcount or 0

        log.info(
            "Craigslist sync complete: states=%d cap_per_state=%d fetched=%d "
            "inserted=%d updated=%d errors=%d pruned=%d",
            stats["states"],
            cap,
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
