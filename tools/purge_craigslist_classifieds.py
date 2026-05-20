"""
Delete every classified ad imported from Craigslist (listing_source='craigslist').

Usage:
    ENV_FILE=/home/ubuntu/website-prod/.env.prod python -m tools.purge_craigslist_classifieds

Dry run (count only):
    CRAIGSLIST_PURGE_DRY_RUN=1 ENV_FILE=... python -m tools.purge_craigslist_classifieds
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv  # noqa: E402

_env_file = os.environ.get("ENV_FILE") or str(REPO_ROOT / ".env")
load_dotenv(_env_file)

from sqlalchemy import delete, func, select  # noqa: E402

import credential_service  # noqa: E402
from database import SessionLocal  # noqa: E402
from models import ClassifiedAd  # noqa: E402

log = logging.getLogger("purge-craigslist")
logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)s  %(message)s")

SOURCE = "craigslist"


def main() -> int:
    if not credential_service.database_enabled() or SessionLocal is None:
        log.error("DATABASE_URL is not configured.")
        return 1

    dry = os.environ.get("CRAIGSLIST_PURGE_DRY_RUN", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )

    db = SessionLocal()
    try:
        count = db.scalar(
            select(func.count())
            .select_from(ClassifiedAd)
            .where(ClassifiedAd.listing_source == SOURCE)
        )
        count = int(count or 0)
        if dry:
            log.info("Dry run: would delete %d Craigslist import ads", count)
            return 0
        if count == 0:
            log.info("No Craigslist import ads in database.")
            return 0
        result = db.execute(
            delete(ClassifiedAd).where(ClassifiedAd.listing_source == SOURCE)
        )
        db.commit()
        deleted = result.rowcount or 0
        log.info("Deleted %d Craigslist import ads", deleted)
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
