"""
One-off migration: move base64 data URLs out of classified_ad.images and into S3/R2,
replacing the row's images array with the resulting public URLs.

Safe to re-run — entries that already look like http(s) URLs are skipped, so partial
runs (or new ads posted between runs) are no-ops on the second pass.

Usage:
    # Dry run — show what would change, no writes
    ENV_FILE=/home/ubuntu/Website/.env.prod python -m tools.migrate_image_blobs --dry-run

    # Real run
    ENV_FILE=/home/ubuntu/Website/.env.prod python -m tools.migrate_image_blobs

Requires the same env vars as the prod service: DATABASE_URL plus all four S3_* vars.
Runs against whichever DB the env points at — pick the env file deliberately.
"""

from __future__ import annotations

import argparse
import base64
import logging
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv  # noqa: E402

_env_file = os.environ.get("ENV_FILE") or str(REPO_ROOT / ".env")
load_dotenv(_env_file)

from sqlalchemy import select  # noqa: E402

import credential_service  # noqa: E402
import image_storage  # noqa: E402
from database import SessionLocal  # noqa: E402
from models import ClassifiedAd  # noqa: E402

log = logging.getLogger("migrate-image-blobs")
logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)s  %(message)s")

# Map base64 data URL prefixes to a content type so image_storage picks the right extension.
_DATA_PREFIXES: dict[str, str] = {
    "data:image/jpeg;base64,": "image/jpeg",
    "data:image/jpg;base64,": "image/jpeg",
    "data:image/png;base64,": "image/png",
    "data:image/webp;base64,": "image/webp",
    "data:image/gif;base64,": "image/gif",
}


def _decode(data_url: str) -> tuple[bytes, str] | None:
    for prefix, ctype in _DATA_PREFIXES.items():
        if data_url.startswith(prefix):
            try:
                return base64.b64decode(data_url[len(prefix) :], validate=False), ctype
            except (ValueError, base64.binascii.Error):  # type: ignore[attr-defined]
                log.warning("Failed to decode a data URL (truncated row?), leaving in place.")
                return None
    return None


def _migrate_row(ad: ClassifiedAd, *, dry_run: bool) -> tuple[int, int]:
    """Return (uploaded, skipped) counts for one ad."""
    images = list(ad.images or [])
    uploaded = 0
    skipped = 0
    new_images: list[str] = []
    for entry in images:
        if not isinstance(entry, str):
            skipped += 1
            new_images.append(entry)
            continue
        if entry.startswith(("http://", "https://")):
            skipped += 1
            new_images.append(entry)
            continue
        decoded = _decode(entry)
        if decoded is None:
            skipped += 1
            new_images.append(entry)
            continue
        content, ctype = decoded
        if dry_run:
            log.info("  would upload %d bytes (%s) for ad=%s", len(content), ctype, ad.id)
            uploaded += 1
            new_images.append(f"<dry-run:{ctype}:{len(content)}B>")
            continue
        owner_id = ad.user_id if ad.user_id is not None else 0
        url = image_storage.upload_image(owner_id, content, ctype)
        log.info("  uploaded -> %s", url)
        uploaded += 1
        new_images.append(url)
    if not dry_run and uploaded:
        # Reassign so SQLAlchemy treats the JSONB column as dirty.
        ad.images = new_images
    return uploaded, skipped


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Do not upload or write DB.")
    parser.add_argument("--limit", type=int, default=None, help="Process at most N ads.")
    args = parser.parse_args()

    if not credential_service.database_enabled() or SessionLocal is None:
        log.error("DATABASE_URL not set — refusing to run.")
        return 2
    if not args.dry_run and not image_storage.storage_enabled():
        log.error("S3_* env vars not set — refusing to run a real migration without storage.")
        return 2

    log.info("Using env file: %s", _env_file)
    log.info("Dry run: %s", args.dry_run)

    db = SessionLocal()
    try:
        stmt = select(ClassifiedAd).order_by(ClassifiedAd.created_at.asc())
        if args.limit:
            stmt = stmt.limit(args.limit)
        ads = db.scalars(stmt).all()
        log.info("Found %d ad(s) to scan.", len(ads))

        total_uploaded = 0
        total_skipped = 0
        touched_rows = 0
        for ad in ads:
            up, sk = _migrate_row(ad, dry_run=args.dry_run)
            total_uploaded += up
            total_skipped += sk
            if up:
                touched_rows += 1
                log.info("ad=%s: %d uploaded, %d skipped", ad.id, up, sk)
        if not args.dry_run:
            db.commit()
        log.info(
            "Done. rows_touched=%d  images_uploaded=%d  images_skipped=%d",
            touched_rows,
            total_uploaded,
            total_skipped,
        )
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
