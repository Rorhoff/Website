"""
Image object storage for classifieds. S3-compatible — works with Cloudflare R2, AWS S3,
or any S3-API service. Storage stays disabled (and falls back to inline base64) until all
required env vars are set.

Env vars (set in .env.dev / .env.prod; never log or commit):
- S3_BUCKET:             bucket name
- S3_ACCESS_KEY_ID:      access key
- S3_SECRET_ACCESS_KEY:  secret key
- S3_PUBLIC_BASE_URL:    public read URL prefix served to the browser
                         (e.g. https://images.t1classifieds.com or the R2 dev domain)
- S3_ENDPOINT_URL:       API endpoint
                         R2:  https://<account_id>.r2.cloudflarestorage.com
                         S3:  omit (boto3 picks the regional endpoint)
- S3_REGION:             R2: 'auto' (default); AWS S3: e.g. 'us-west-1'
- S3_KEY_PREFIX:         prepended to every object key — use 'dev/' and 'prod/' so the
                         two environments can safely share a single bucket if desired.

Operational notes:
- Uploads stream through this process — keep the per-file size cap small in the route.
- Object keys include a random token, so two users can't collide on the same filename.
- Cache-Control is set to immutable so the CDN/browser can cache forever; the random
  key makes overwrites impossible by design.
"""

from __future__ import annotations

import logging
import os
import secrets
from functools import lru_cache
from typing import Any

log = logging.getLogger("webapi-testing")

_ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
}

_EXT_FOR_TYPE = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}

_REQUIRED_ENV = (
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_PUBLIC_BASE_URL",
)


def storage_enabled() -> bool:
    if not all(os.getenv(k) for k in _REQUIRED_ENV):
        return False
    # R2 requires an explicit API endpoint; without it boto3 hits AWS and uploads fail.
    if not os.getenv("S3_ENDPOINT_URL"):
        log.warning("S3_* set but S3_ENDPOINT_URL missing — image uploads will use inline fallback")
        return False
    return True


def allowed_content_type(content_type: str | None) -> bool:
    return (content_type or "").lower() in _ALLOWED_CONTENT_TYPES


@lru_cache(maxsize=1)
def _client() -> Any:
    # Local import so boto3 only loads in processes that actually need it.
    import boto3  # type: ignore[import-not-found]

    return boto3.client(
        "s3",
        endpoint_url=os.getenv("S3_ENDPOINT_URL") or None,
        region_name=os.getenv("S3_REGION", "auto"),
        aws_access_key_id=os.getenv("S3_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("S3_SECRET_ACCESS_KEY"),
    )


def _object_key(user_id: int, content_type: str) -> str:
    prefix = os.getenv("S3_KEY_PREFIX", "")
    ext = _EXT_FOR_TYPE.get((content_type or "").lower(), ".bin")
    rand = secrets.token_urlsafe(12)
    return f"{prefix}u{user_id}/{rand}{ext}"


def upload_image(user_id: int, content: bytes, content_type: str) -> str:
    """Upload bytes and return a public URL the browser can <img src> directly."""
    if not storage_enabled():
        raise RuntimeError(
            "Image storage is not configured "
            "(set S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_BASE_URL)."
        )
    if not allowed_content_type(content_type):
        raise ValueError(f"Unsupported content type: {content_type!r}")
    bucket = os.environ["S3_BUCKET"]
    public_base = os.environ["S3_PUBLIC_BASE_URL"].rstrip("/")
    key = _object_key(user_id, content_type)
    _client().put_object(
        Bucket=bucket,
        Key=key,
        Body=content,
        ContentType=content_type,
        CacheControl="public, max-age=31536000, immutable",
    )
    return f"{public_base}/{key}"


def upload_image_at_key(relative_key: str, content: bytes, content_type: str) -> str:
    """Upload bytes under S3_KEY_PREFIX + relative_key; return public URL."""
    if not storage_enabled():
        raise RuntimeError(
            "Image storage is not configured "
            "(set S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_BASE_URL)."
        )
    if not allowed_content_type(content_type):
        raise ValueError(f"Unsupported content type: {content_type!r}")
    bucket = os.environ["S3_BUCKET"]
    public_base = os.environ["S3_PUBLIC_BASE_URL"].rstrip("/")
    prefix = os.getenv("S3_KEY_PREFIX", "")
    key = f"{prefix}{relative_key}"
    _client().put_object(
        Bucket=bucket,
        Key=key,
        Body=content,
        ContentType=content_type,
        CacheControl="public, max-age=31536000, immutable",
    )
    return f"{public_base}/{key}"
