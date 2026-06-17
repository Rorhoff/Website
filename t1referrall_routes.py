"""
Referr-All REST API — RDS + Bearer sessions (replaces Supabase client).

Mounted at /api/referr-all on rorhoff.com (SERVICE_MODE=full). Requires DATABASE_URL.
"""

from __future__ import annotations

import logging
import os
import re
import secrets
import threading
import time
import uuid
import base64
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Annotated, Any
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File, Header, HTTPException, Request, UploadFile, status
from fastapi.responses import RedirectResponse
from passlib.hash import bcrypt as bcrypt_hasher
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.orm import Session

import credential_service
import image_storage
import stripe_service
from credential_service import truncate_for_bcrypt
from database import SessionLocal
from models import (
    T1ReferrallConnection,
    T1ReferrallConversation,
    T1ReferrallConversationParticipant,
    T1ReferrallMessage,
    T1ReferrallPost,
    T1ReferrallPremiumPurchase,
    T1ReferrallSeekerPost,
    T1ReferrallSession,
    T1ReferrallUser,
    T1ReferrallPostReport,
    T1ReferrallUserBlock,
)

log = logging.getLogger("webapi-testing")

router = APIRouter(prefix="/api/referr-all", tags=["referr-all"])

BASE_PREMIUM_PRICE_CENTS = 999
PREMIUM_DURATION_DAYS = 30
# Surge tiers (30-day rolling purchase count → next buyer price):
#   first 5 purchases:  +$10 each
#   next 5 (6–10):      +$20 each
#   11+:                +$50 each (no cap)
PREMIUM_TIER1_COUNT = 5
PREMIUM_TIER1_INCREMENT_CENTS = 1000
PREMIUM_TIER2_COUNT = 5
PREMIUM_TIER2_INCREMENT_CENTS = 2000
PREMIUM_TIER3_INCREMENT_CENTS = 5000
BLOCK_SUSPEND_THRESHOLD = 10
REPORT_REMOVE_THRESHOLD = 10
REPORT_REMOVE_THRESHOLD_PREMIUM = 20
_POST_KIND_JOB = "job"
_POST_KIND_SEEKER = "seeker"
MAX_AVATAR_BYTES = 4 * 1024 * 1024
MAX_BANNER_BYTES = 4 * 1024 * 1024

_AVAILABILITY = frozenset({"immediately", "2weeks", "1month", "3months"})
_CONN_STATUS = frozenset({"pending", "accepted", "declined"})
_INLINE_AVATAR_MAX_BYTES = 512 * 1024
_INLINE_BANNER_MAX_BYTES = 768 * 1024


def _shrink_avatar_for_inline(content: bytes, content_type: str) -> tuple[bytes, str]:
    """Downscale/compress to fit inline DB storage when S3 is off."""
    import io

    from PIL import Image

    img = Image.open(io.BytesIO(content))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    max_dim = 800
    w, h = img.size
    if max(w, h) > max_dim:
        img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
    quality = 85
    while quality >= 40:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        data = buf.getvalue()
        if len(data) <= _INLINE_AVATAR_MAX_BYTES:
            return data, "image/jpeg"
        quality -= 10
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=40, optimize=True)
    return buf.getvalue(), "image/jpeg"


def _shrink_banner_for_inline(content: bytes, content_type: str) -> tuple[bytes, str]:
    """Downscale/compress profile banner for inline DB storage when S3 is off."""
    import io

    from PIL import Image

    img = Image.open(io.BytesIO(content))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    max_w, max_h = 1200, 400
    w, h = img.size
    scale = min(max_w / w, max_h / h, 1.0)
    if scale < 1.0:
        img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
    quality = 85
    while quality >= 40:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        data = buf.getvalue()
        if len(data) <= _INLINE_BANNER_MAX_BYTES:
            return data, "image/jpeg"
        quality -= 10
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=40, optimize=True)
    return buf.getvalue(), "image/jpeg"

_USA_LOCATION_TERMS = (
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut",
    "delaware", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa",
    "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan",
    "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire",
    "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio",
    "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota",
    "tennessee", "texas", "utah", "vermont", "virginia", "washington", "west virginia",
    "wisconsin", "wyoming", "district of columbia", "usa", "u.s.", "united states",
    ", al", ", ak", ", az", ", ar", ", ca", ", co", ", ct", ", de", ", fl", ", ga", ", hi",
    ", id", ", il", ", in", ", ia", ", ks", ", ky", ", la", ", me", ", md", ", ma", ", mi",
    ", mn", ", ms", ", mo", ", mt", ", ne", ", nv", ", nh", ", nj", ", nm", ", ny", ", nc",
    ", nd", ", oh", ", ok", ", or", ", pa", ", ri", ", sc", ", sd", ", tn", ", tx", ", ut",
    ", vt", ", va", ", wa", ", wv", ", wi", ", wy",
)


def _is_usa_location(location: str, *, open_to_remote: bool = False) -> bool:
    loc = (location or "").strip().lower()
    if open_to_remote and (not loc or loc == "remote"):
        return True
    if loc == "remote":
        return True
    if not loc:
        return False
    return any(term in loc for term in _USA_LOCATION_TERMS)


def _require_usa_location(location: str, *, open_to_remote: bool = False) -> None:
    if not _is_usa_location(location, open_to_remote=open_to_remote):
        raise HTTPException(
            status_code=400,
            detail="Referr-All is USA-only. Use a US city/state (e.g. Austin, TX) or enable Open to Remote.",
        )


def _public_base() -> str:
    return (
        os.getenv("REFERR_ALL_PUBLIC_URL")
        or os.getenv("T1REFERRALL_PUBLIC_URL")
        or "https://rorhoff.com/referr-all"
    ).rstrip("/")


def _api_base() -> str:
    """API root (<origin>/api/referr-all), derived from the public SPA base."""
    pub = _public_base()
    origin = pub[: -len("/referr-all")] if pub.endswith("/referr-all") else pub
    return f"{origin}/api/referr-all"


def _app_base() -> str:
    """User-facing SPA origin for email links (e.g. https://referr-all.com)."""
    return (os.getenv("REFERR_ALL_APP_URL") or _public_base()).rstrip("/")


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.isoformat() + "Z" if dt.tzinfo is None else dt.isoformat()


# --- Rate limiting (in-memory fixed window; single-process backend) ---

_rate_lock = threading.Lock()
_rate_buckets: dict[str, list[float]] = defaultdict(list)


def _client_ip(request: Request) -> str:
    """Real client IP, honoring the nginx X-Forwarded-For chain."""
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        first = fwd.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else "unknown"


def _rate_limit(key: str, max_attempts: int, window_seconds: int) -> None:
    """Raise 429 when more than max_attempts happen within the rolling window."""
    now = time.monotonic()
    cutoff = now - window_seconds
    with _rate_lock:
        bucket = _rate_buckets[key]
        drop = 0
        for ts in bucket:
            if ts >= cutoff:
                break
            drop += 1
        if drop:
            del bucket[:drop]
        if len(bucket) >= max_attempts:
            retry = int(window_seconds - (now - bucket[0])) + 1
            raise HTTPException(
                status_code=429,
                detail="Too many attempts. Please wait a moment and try again.",
                headers={"Retry-After": str(max(retry, 1))},
            )
        bucket.append(now)
        if not bucket:
            _rate_buckets.pop(key, None)


# --- URL validation (block javascript:/data: and other XSS-prone schemes) ---


def _validate_url(value: str | None, field: str, *, allow_data_image: bool = False) -> str:
    v = (value or "").strip()
    if not v:
        return ""
    if allow_data_image and v[:11].lower() == "data:image/":
        return v
    if not re.match(r"^https?://", v, re.I):
        v = f"https://{v}"
    parsed = urlparse(v)
    if parsed.scheme.lower() in ("http", "https") and parsed.netloc:
        return v
    raise HTTPException(status_code=400, detail=f"{field} must be a valid http(s) URL.")


# --- Email (provider-agnostic SMTP with a logging no-op fallback) ---

EMAIL_VERIFY_TTL_HOURS = 48


CLOUDFLARE_EMAIL_SEND_URL = (
    "https://api.cloudflare.com/client/v4/accounts/{account_id}/email/sending/send"
)
DEFAULT_EMAIL_FROM = "noreply@referr-all.com"


def _email_configured() -> bool:
    return bool(os.getenv("CLOUDFLARE_API_TOKEN") and os.getenv("CLOUDFLARE_ACCOUNT_ID"))


def _send_email(to_email: str, subject: str, text_body: str, html_body: str | None = None) -> bool:
    """Send via the Cloudflare Email Service REST API.

    Falls back to a logging no-op (returning False) when the Cloudflare env vars
    are not set, so verification/reset links are still recoverable from the logs.
    """
    if not _email_configured():
        log.info("[email:disabled] to=%s | %s | %s", to_email, subject, text_body)
        return False
    import httpx

    account_id = os.getenv("CLOUDFLARE_ACCOUNT_ID", "")
    token = os.getenv("CLOUDFLARE_API_TOKEN", "")
    sender = os.getenv("SMTP_FROM", DEFAULT_EMAIL_FROM)
    payload: dict[str, Any] = {
        "to": to_email,
        "from": sender,
        "subject": subject,
        "text": text_body,
    }
    if html_body:
        payload["html"] = html_body
    try:
        resp = httpx.post(
            CLOUDFLARE_EMAIL_SEND_URL.format(account_id=account_id),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=10,
        )
    except Exception:
        log.exception("Cloudflare email request failed to %s", to_email)
        return False
    if resp.status_code >= 400:
        log.error(
            "Cloudflare email send to %s failed (HTTP %s): %s",
            to_email,
            resp.status_code,
            resp.text[:500],
        )
        return False
    try:
        data = resp.json()
    except ValueError:
        data = {}
    if isinstance(data, dict) and data.get("success") is False:
        log.error("Cloudflare email send to %s returned errors: %s", to_email, data.get("errors"))
        return False
    return True


def _send_verification_email(user: T1ReferrallUser) -> None:
    if not user.email_verify_token:
        return
    link = f"{_api_base()}/verify-email/confirm?token={user.email_verify_token}"
    subject = "Confirm your Referr-All email"
    text_body = (
        f"Hi {user.full_name or user.username},\n\n"
        f"Confirm your email to finish setting up your Referr-All account:\n{link}\n\n"
        f"This link expires in {EMAIL_VERIFY_TTL_HOURS} hours. "
        "If you didn't sign up, you can ignore this message."
    )
    html_body = (
        f"<p>Hi {user.full_name or user.username},</p>"
        f"<p>Confirm your email to finish setting up your Referr-All account:</p>"
        f'<p><a href="{link}">Confirm my email</a></p>'
        f"<p>This link expires in {EMAIL_VERIFY_TTL_HOURS} hours. "
        "If you didn't sign up, you can ignore this message.</p>"
    )
    _send_email(user.email, subject, text_body, html_body)


PASSWORD_RESET_TTL_HOURS = 1


def _send_password_reset_email(user: T1ReferrallUser, raw_token: str) -> None:
    link = f"{_app_base()}/?reset_token={raw_token}"
    subject = "Reset your Referr-All password"
    text_body = (
        f"Hi {user.full_name or user.username},\n\n"
        f"We received a request to reset your Referr-All password. "
        f"Use this link to choose a new one:\n{link}\n\n"
        f"This link expires in {PASSWORD_RESET_TTL_HOURS} hour. "
        "If you didn't request this, you can safely ignore this message — "
        "your password won't change."
    )
    html_body = (
        f"<p>Hi {user.full_name or user.username},</p>"
        f"<p>We received a request to reset your Referr-All password. "
        f"Use this link to choose a new one:</p>"
        f'<p><a href="{link}">Reset my password</a></p>'
        f"<p>This link expires in {PASSWORD_RESET_TTL_HOURS} hour. "
        "If you didn't request this, you can safely ignore this message — "
        "your password won't change.</p>"
    )
    _send_email(user.email, subject, text_body, html_body)


def referrall_db() -> Any:
    if not credential_service.database_enabled() or SessionLocal is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="DATABASE_URL is not set; Referr-All is unavailable.",
        )
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _hash_password(plain: str) -> str:
    return bcrypt_hasher.hash(truncate_for_bcrypt(plain))


def _verify_password(plain: str, password_hash: str) -> bool:
    try:
        return bcrypt_hasher.verify(truncate_for_bcrypt(plain), password_hash)
    except ValueError:
        return False


def _validate_password_strength(password: str) -> None:
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
    if not re.search(r"\d", password):
        raise HTTPException(status_code=400, detail="Password must include at least one number.")
    if not re.search(r"[^A-Za-z0-9]", password):
        raise HTTPException(status_code=400, detail="Password must include at least one special character.")


def _profile_out(user: T1ReferrallUser, *, include_email: bool = False) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "avatar_url": user.avatar_url or "",
        "banner_url": getattr(user, "banner_url", "") or "",
        "bio": user.bio or "",
        "company": user.company or "",
        "role": user.role or "",
        "location": user.location or "",
        "linkedin_url": user.linkedin_url or "",
        "portfolio_url": user.portfolio_url or "",
        "years_experience": user.years_experience or 0,
        "skills": list(user.skills or []),
        "interests": list(user.interests or []),
        "is_suspended": bool(user.is_suspended),
        "created_at": _iso(user.created_at),
        "updated_at": _iso(user.updated_at),
    }
    if include_email:
        out["email"] = user.email
        out["email_verified"] = bool(getattr(user, "email_verified", False))
        out["phone"] = getattr(user, "phone", "") or ""
        out["totp_enabled"] = bool(getattr(user, "totp_enabled", False))
        out["is_deactivated"] = bool(getattr(user, "is_deactivated", False))
        out["settings"] = dict(getattr(user, "settings", None) or {})
    return out


def _post_out(row: T1ReferrallPost, profiles: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": row.id,
        "author_id": row.author_id,
        "company": row.company,
        "role_title": row.role_title,
        "description": row.description or "",
        "referral_bonus": row.referral_bonus or "",
        "has_bonus": bool(row.has_bonus),
        "job_url": row.job_url or "",
        "location": row.location or "",
        "is_remote": bool(row.is_remote),
        "tags": list(row.tags or []),
        "required_skills": list(row.required_skills or []),
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
    }
    if profiles and row.author_id in profiles:
        out["profiles"] = profiles[row.author_id]
    return out


def _seeker_out(
    row: T1ReferrallSeekerPost, profiles: dict[str, dict[str, Any]] | None = None
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": row.id,
        "author_id": row.author_id,
        "headline": row.headline or "",
        "about": row.about or "",
        "desired_role": row.desired_role or "",
        "desired_location": row.desired_location or "",
        "open_to_remote": bool(row.open_to_remote),
        "field_of_work": row.field_of_work or "",
        "skills": list(row.skills or []),
        "experience_years": row.experience_years or 0,
        "resume_url": row.resume_url or "",
        "portfolio_url": row.portfolio_url or "",
        "availability": row.availability or "immediately",
        "is_premium": bool(row.is_premium),
        "premium_expires_at": _iso(row.premium_expires_at),
        "premium_order": row.premium_order or 0,
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
    }
    if profiles and row.author_id in profiles:
        out["profiles"] = profiles[row.author_id]
    return out


def _connection_out(row: T1ReferrallConnection) -> dict[str, Any]:
    return {
        "id": row.id,
        "requester_id": row.requester_id,
        "addressee_id": row.addressee_id,
        "status": row.status,
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
    }


def _message_out(row: T1ReferrallMessage, sender: dict[str, Any] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": row.id,
        "conversation_id": row.conversation_id,
        "sender_id": row.sender_id,
        "content": row.content,
        "created_at": _iso(row.created_at),
    }
    if sender:
        out["sender"] = sender
    return out


def _load_profiles(db: Session, user_ids: set[str]) -> dict[str, dict[str, Any]]:
    if not user_ids:
        return {}
    rows = db.scalars(select(T1ReferrallUser).where(T1ReferrallUser.id.in_(user_ids))).all()
    return {u.id: _profile_out(u) for u in rows}


def _deactivated_author_ids(db: Session, author_ids: set[str]) -> set[str]:
    """Authors who hibernated their account; their content is hidden from feeds."""
    if not author_ids:
        return set()
    return set(
        db.scalars(
            select(T1ReferrallUser.id).where(
                T1ReferrallUser.id.in_(author_ids),
                T1ReferrallUser.is_deactivated.is_(True),
            )
        ).all()
    )


def _bearer_token(authorization: str | None) -> str | None:
    if authorization and authorization.startswith("Bearer "):
        return authorization[7:].strip() or None
    return None


def _shorten(value: str | None, limit: int) -> str:
    return (value or "")[:limit]


def _create_session(db: Session, user_id: str, request: Request | None = None) -> str:
    token = secrets.token_urlsafe(32)
    now = datetime.utcnow()
    expires = now + timedelta(hours=credential_service.SESSION_HOURS)
    user_agent = ""
    ip = ""
    if request is not None:
        user_agent = _shorten(request.headers.get("user-agent"), 400)
        ip = _shorten(_client_ip(request), 64)
    db.add(
        T1ReferrallSession(
            token=token,
            user_id=user_id,
            expires_at=expires,
            user_agent=user_agent,
            ip=ip,
            last_seen_at=now,
        )
    )
    db.commit()
    return token


def get_current_referrall_user(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(referrall_db),
) -> T1ReferrallUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    row = db.get(T1ReferrallSession, token)
    if row is None or row.expires_at < datetime.utcnow():
        if row is not None:
            db.delete(row)
            db.commit()
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    # Throttled "last active" touch so the sessions list stays meaningful without
    # writing on every single request.
    try:
        last_seen = getattr(row, "last_seen_at", None)
        if last_seen is None or datetime.utcnow() - last_seen > timedelta(minutes=10):
            row.last_seen_at = datetime.utcnow()
            db.add(row)
            db.commit()
    except Exception:
        db.rollback()
    user = db.get(T1ReferrallUser, row.user_id)
    if user is None:
        db.delete(row)
        db.commit()
        raise HTTPException(status_code=401, detail="User not found")
    if user.is_suspended:
        raise HTTPException(status_code=403, detail="Account suspended")
    return user


# --- Two-factor auth (TOTP) helpers ---

TOTP_ISSUER = "Referr-All"
_2FA_CHALLENGE_TTL_SECONDS = 300
_pending_2fa: dict[str, tuple[str, float]] = {}
_pending_2fa_lock = threading.Lock()


def _prune_2fa_challenges(now: float) -> None:
    expired = [k for k, (_, exp) in _pending_2fa.items() if exp < now]
    for k in expired:
        _pending_2fa.pop(k, None)


def _create_2fa_challenge(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    now = time.time()
    with _pending_2fa_lock:
        _prune_2fa_challenges(now)
        _pending_2fa[token] = (user_id, now + _2FA_CHALLENGE_TTL_SECONDS)
    return token


def _consume_2fa_challenge(token: str) -> str | None:
    token = (token or "").strip()
    if not token:
        return None
    now = time.time()
    with _pending_2fa_lock:
        _prune_2fa_challenges(now)
        entry = _pending_2fa.pop(token, None)
    if entry is None:
        return None
    user_id, exp = entry
    if exp < now:
        return None
    return user_id


def _restore_2fa_challenge(token: str, user_id: str) -> None:
    token = (token or "").strip()
    if not token:
        return
    with _pending_2fa_lock:
        _pending_2fa[token] = (user_id, time.time() + _2FA_CHALLENGE_TTL_SECONDS)


def _verify_totp(secret: str | None, code: str | None) -> bool:
    if not secret or not code:
        return False
    code = re.sub(r"\s+", "", str(code))
    if not re.fullmatch(r"\d{6}", code):
        return False
    try:
        import pyotp
    except ImportError:
        log.error("pyotp not installed; cannot verify TOTP codes")
        return False
    return pyotp.TOTP(secret).verify(code, valid_window=1)


def _qr_data_url(otpauth_url: str) -> str:
    """Render the otpauth:// URI to a PNG data URL so the secret never leaves us."""
    try:
        import io as _io

        import qrcode

        img = qrcode.make(otpauth_url)
        buf = _io.BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        return f"data:image/png;base64,{b64}"
    except Exception:
        log.exception("Failed to render TOTP QR code")
        return ""


def _finalize_login(db: Session, user: T1ReferrallUser, request: Request | None) -> str:
    # Logging back in reactivates a hibernated account (LinkedIn-style).
    if getattr(user, "is_deactivated", False):
        user.is_deactivated = False
        user.deactivated_at = None
        user.updated_at = datetime.utcnow()
        db.add(user)
        db.commit()
    return _create_session(db, user.id, request)


def _premium_price_cents_for_count(prior_purchases: int) -> int:
    """Price for the next buyer given how many featured purchases occurred in the last 30 days."""
    total = max(0, prior_purchases)
    price = BASE_PREMIUM_PRICE_CENTS
    price += min(total, PREMIUM_TIER1_COUNT) * PREMIUM_TIER1_INCREMENT_CENTS
    price += min(max(total - PREMIUM_TIER1_COUNT, 0), PREMIUM_TIER2_COUNT) * PREMIUM_TIER2_INCREMENT_CENTS
    price += max(total - PREMIUM_TIER1_COUNT - PREMIUM_TIER2_COUNT, 0) * PREMIUM_TIER3_INCREMENT_CENTS
    return price


def _premium_purchase_count_30d(db: Session) -> int:
    month_ago = datetime.utcnow() - timedelta(days=30)
    base = (
        select(func.count())
        .select_from(T1ReferrallPremiumPurchase)
        .where(T1ReferrallPremiumPurchase.created_at >= month_ago)
    )
    try:
        return int(
            db.scalar(base.where(T1ReferrallPremiumPurchase.refunded_at.is_(None))) or 0
        )
    except ProgrammingError:
        db.rollback()
        log.warning("Premium count: refunded_at column missing — run migrate-t1referrall-v7.sh")
        return int(db.scalar(base) or 0)


def _premium_price_cents(db: Session) -> int:
    return _premium_price_cents_for_count(_premium_purchase_count_30d(db))


def _check_block_suspend(db: Session, blocked_id: str) -> None:
    count = db.scalar(
        select(func.count())
        .select_from(T1ReferrallUserBlock)
        .where(T1ReferrallUserBlock.blocked_id == blocked_id)
    )
    if int(count or 0) >= BLOCK_SUSPEND_THRESHOLD:
        user = db.get(T1ReferrallUser, blocked_id)
        if user is not None:
            user.is_suspended = True
            user.updated_at = datetime.utcnow()
            db.add(user)
            db.commit()


def _post_report_count(db: Session, post_kind: str, post_id: str) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(T1ReferrallPostReport)
            .where(
                T1ReferrallPostReport.post_kind == post_kind,
                T1ReferrallPostReport.post_id == post_id,
            )
        )
        or 0
    )


def _post_report_threshold(post_kind: str, seeker_post: T1ReferrallSeekerPost | None) -> int:
    if post_kind == _POST_KIND_SEEKER and seeker_post is not None and _post_premium_active(seeker_post):
        return REPORT_REMOVE_THRESHOLD_PREMIUM
    return REPORT_REMOVE_THRESHOLD


def _remove_post_reports(db: Session, post_kind: str, post_id: str) -> None:
    db.execute(
        delete(T1ReferrallPostReport).where(
            T1ReferrallPostReport.post_kind == post_kind,
            T1ReferrallPostReport.post_id == post_id,
        )
    )


def _check_post_report_removal(db: Session, post_kind: str, post_id: str) -> bool:
    seeker_post = db.get(T1ReferrallSeekerPost, post_id) if post_kind == _POST_KIND_SEEKER else None
    threshold = _post_report_threshold(post_kind, seeker_post)
    if _post_report_count(db, post_kind, post_id) < threshold:
        return False
    if post_kind == _POST_KIND_JOB:
        row = db.get(T1ReferrallPost, post_id)
    else:
        row = seeker_post
    if row is None:
        return False
    _remove_post_reports(db, post_kind, post_id)
    db.delete(row)
    db.commit()
    return True


def _user_reported_post(db: Session, user_id: str, post_kind: str, post_id: str) -> bool:
    row = db.scalars(
        select(T1ReferrallPostReport).where(
            T1ReferrallPostReport.reporter_id == user_id,
            T1ReferrallPostReport.post_kind == post_kind,
            T1ReferrallPostReport.post_id == post_id,
        )
    ).first()
    return row is not None


def _create_post_report(
    db: Session,
    user: T1ReferrallUser,
    post_kind: str,
    post_id: str,
    *,
    author_id: str,
) -> dict[str, Any]:
    if author_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot report your own post")
    if _user_reported_post(db, user.id, post_kind, post_id):
        return {"ok": True, "alreadyReported": True, "removed": False}
    row = T1ReferrallPostReport(
        id=str(uuid.uuid4()),
        reporter_id=user.id,
        post_kind=post_kind,
        post_id=post_id,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return {"ok": True, "alreadyReported": True, "removed": False}
    removed = _check_post_report_removal(db, post_kind, post_id)
    return {"ok": True, "alreadyReported": False, "removed": removed}


def _user_participates(db: Session, conversation_id: str, user_id: str) -> bool:
    row = db.get(
        T1ReferrallConversationParticipant,
        {"conversation_id": conversation_id, "user_id": user_id},
    )
    return row is not None


# --- Request bodies ---


class RegisterBody(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=256)
    username: str = Field(min_length=3, max_length=64)
    fullName: str = Field(min_length=1, max_length=200)


class LoginBody(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=1, max_length=256)


class ForgotPasswordBody(BaseModel):
    email: str = Field(min_length=3, max_length=255)


class ResetPasswordBody(BaseModel):
    token: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=8, max_length=256)


class ProfilePatchBody(BaseModel):
    fullName: str | None = Field(default=None, max_length=200)
    bio: str | None = Field(default=None, max_length=5000)
    company: str | None = Field(default=None, max_length=200)
    role: str | None = Field(default=None, max_length=200)
    location: str | None = Field(default=None, max_length=200)
    linkedinUrl: str | None = Field(default=None, max_length=500)
    portfolioUrl: str | None = Field(default=None, max_length=500)
    yearsExperience: float | None = Field(default=None, ge=0, le=80)
    skills: list[str] | None = Field(default=None, max_length=50)
    interests: list[str] | None = Field(default=None, max_length=50)
    avatarUrl: str | None = Field(default=None, max_length=2_000_000)
    bannerUrl: str | None = Field(default=None, max_length=2_000_000)


class CreatePostBody(BaseModel):
    company: str = Field(min_length=1, max_length=200)
    roleTitle: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=10000)
    referralBonus: str = Field(default="", max_length=200)
    hasBonus: bool = False
    jobUrl: str = Field(default="", max_length=500)
    location: str = Field(default="", max_length=200)
    isRemote: bool = False
    tags: list[str] = Field(default_factory=list, max_length=20)
    requiredSkills: list[str] = Field(default_factory=list, max_length=30)


class CreateSeekerPostBody(BaseModel):
    headline: str = Field(default="", max_length=300)
    about: str = Field(default="", max_length=10000)
    desiredRole: str = Field(min_length=1, max_length=200)
    desiredLocation: str = Field(default="", max_length=200)
    openToRemote: bool = False
    fieldOfWork: str = Field(default="", max_length=200)
    skills: list[str] = Field(default_factory=list, max_length=30)
    experienceYears: float = Field(default=0, ge=0, le=80)
    resumeUrl: str = Field(default="", max_length=500)
    portfolioUrl: str = Field(default="", max_length=500)
    availability: str = Field(default="immediately", max_length=16)


class ConnectionCreateBody(BaseModel):
    addresseeId: str = Field(min_length=36, max_length=36)


class ConnectionPatchBody(BaseModel):
    status: str = Field(min_length=1, max_length=16)


class BlockBody(BaseModel):
    blockedId: str = Field(min_length=36, max_length=36)


class ConversationCreateBody(BaseModel):
    otherUserId: str = Field(min_length=36, max_length=36)


class MessageBody(BaseModel):
    content: str = Field(min_length=1, max_length=5000)


class PremiumCheckoutBody(BaseModel):
    seekerPostId: str = Field(min_length=36, max_length=36)
    successUrl: str = Field(min_length=1, max_length=500)
    cancelUrl: str = Field(min_length=1, max_length=500)


class PremiumConfirmBody(BaseModel):
    sessionId: str = Field(min_length=1, max_length=255)


class Login2faBody(BaseModel):
    twofaToken: str = Field(min_length=1, max_length=64)
    code: str = Field(min_length=1, max_length=10)


class ChangePasswordBody(BaseModel):
    currentPassword: str = Field(min_length=1, max_length=256)
    newPassword: str = Field(min_length=8, max_length=256)


class ChangeEmailBody(BaseModel):
    password: str = Field(min_length=1, max_length=256)
    newEmail: str = Field(min_length=3, max_length=255)


class ChangePhoneBody(BaseModel):
    phone: str = Field(default="", max_length=32)


class TwoFactorEnableBody(BaseModel):
    code: str = Field(min_length=1, max_length=10)


class TwoFactorDisableBody(BaseModel):
    password: str = Field(min_length=1, max_length=256)
    code: str | None = Field(default=None, max_length=10)


class AccountSettingsBody(BaseModel):
    settings: dict[str, Any] = Field(default_factory=dict)


class DeactivateAccountBody(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class DeleteAccountBody(BaseModel):
    password: str = Field(min_length=1, max_length=256)
    confirm: str = Field(default="", max_length=20)


# --- Auth ---


@router.post("/register")
def register(body: RegisterBody, request: Request, db: Session = Depends(referrall_db)):
    _rate_limit(f"register:ip:{_client_ip(request)}", max_attempts=10, window_seconds=3600)
    _validate_password_strength(body.password)
    email = body.email.strip().lower()
    username = re.sub(r"[^a-z0-9_]", "", body.username.strip().lower())
    if len(username) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters.")
    if db.scalars(select(T1ReferrallUser).where(T1ReferrallUser.username == username)).first():
        raise HTTPException(status_code=409, detail="Username is already taken.")
    if db.scalars(select(T1ReferrallUser).where(func.lower(T1ReferrallUser.email) == email)).first():
        raise HTTPException(status_code=409, detail="Email is already registered.")
    user_id = str(uuid.uuid4())
    user = T1ReferrallUser(
        id=user_id,
        email=email,
        username=username,
        password_hash=_hash_password(body.password),
        full_name=body.fullName.strip(),
        email_verify_token=secrets.token_urlsafe(32),
        email_verify_sent_at=datetime.utcnow(),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username or email already taken.")
    db.refresh(user)
    try:
        _send_verification_email(user)
    except Exception:
        log.exception("Verification email send failed for user=%s", user.id)
    token = _create_session(db, user.id, request)
    return {"token": token, "profile": _profile_out(user, include_email=True)}


@router.post("/login")
def login(body: LoginBody, request: Request, db: Session = Depends(referrall_db)):
    email = body.email.strip().lower()
    _rate_limit(f"login:ip:{_client_ip(request)}", max_attempts=15, window_seconds=900)
    _rate_limit(f"login:email:{email}", max_attempts=7, window_seconds=900)
    user = db.scalars(
        select(T1ReferrallUser).where(func.lower(T1ReferrallUser.email) == email)
    ).first()
    if user is None or not _verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    if user.is_suspended:
        raise HTTPException(status_code=403, detail="Account suspended")
    if getattr(user, "totp_enabled", False) and getattr(user, "totp_secret", None):
        challenge = _create_2fa_challenge(user.id)
        return {"twofaRequired": True, "twofaToken": challenge}
    token = _finalize_login(db, user, request)
    return {"token": token, "profile": _profile_out(user, include_email=True)}


@router.post("/login/2fa")
def login_2fa(body: Login2faBody, request: Request, db: Session = Depends(referrall_db)):
    _rate_limit(f"login2fa:ip:{_client_ip(request)}", max_attempts=20, window_seconds=900)
    user_id = _consume_2fa_challenge(body.twofaToken)
    if not user_id:
        raise HTTPException(status_code=400, detail="Your verification session expired. Sign in again.")
    user = db.get(T1ReferrallUser, user_id)
    if user is None:
        raise HTTPException(status_code=400, detail="Account not found.")
    if user.is_suspended:
        raise HTTPException(status_code=403, detail="Account suspended")
    if not _verify_totp(getattr(user, "totp_secret", None), body.code):
        # Put the challenge back so a single typo doesn't force a full re-login.
        _restore_2fa_challenge(body.twofaToken, user_id)
        raise HTTPException(status_code=400, detail="Invalid authentication code.")
    token = _finalize_login(db, user, request)
    return {"token": token, "profile": _profile_out(user, include_email=True)}


@router.post("/logout")
def logout(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(referrall_db),
):
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:].strip()
        if token:
            db.execute(delete(T1ReferrallSession).where(T1ReferrallSession.token == token))
            db.commit()
    return {"ok": True}


@router.get("/verify-email/confirm")
def verify_email_confirm(token: str, db: Session = Depends(referrall_db)):
    """Email link target. Marks the account verified and redirects back to the SPA."""
    base = _public_base()
    token = (token or "").strip()
    if not token:
        return RedirectResponse(url=f"{base}/?verified=0", status_code=303)
    user = db.scalars(
        select(T1ReferrallUser).where(T1ReferrallUser.email_verify_token == token)
    ).first()
    if user is None:
        return RedirectResponse(url=f"{base}/?verified=0", status_code=303)
    sent_at = user.email_verify_sent_at
    if sent_at and datetime.utcnow() - sent_at > timedelta(hours=EMAIL_VERIFY_TTL_HOURS):
        return RedirectResponse(url=f"{base}/?verified=expired", status_code=303)
    user.email_verified = True
    user.email_verify_token = None
    user.updated_at = datetime.utcnow()
    db.add(user)
    db.commit()
    return RedirectResponse(url=f"{base}/?verified=1", status_code=303)


@router.post("/verify-email/resend")
def verify_email_resend(
    request: Request,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    if getattr(user, "email_verified", False):
        return {"ok": True, "alreadyVerified": True}
    _rate_limit(f"verify-resend:{user.id}", max_attempts=5, window_seconds=3600)
    user.email_verify_token = secrets.token_urlsafe(32)
    user.email_verify_sent_at = datetime.utcnow()
    db.add(user)
    db.commit()
    db.refresh(user)
    try:
        _send_verification_email(user)
    except Exception:
        log.exception("Verification email resend failed for user=%s", user.id)
    return {"ok": True, "sent": _email_configured()}


@router.post("/password/forgot")
def password_forgot(
    body: ForgotPasswordBody, request: Request, db: Session = Depends(referrall_db)
):
    email = body.email.strip().lower()
    _rate_limit(f"forgot:ip:{_client_ip(request)}", max_attempts=10, window_seconds=3600)
    _rate_limit(f"forgot:email:{email}", max_attempts=5, window_seconds=3600)
    user = db.scalars(
        select(T1ReferrallUser).where(func.lower(T1ReferrallUser.email) == email)
    ).first()
    if user is not None and not user.is_suspended:
        user.password_reset_token = secrets.token_urlsafe(32)
        user.password_reset_sent_at = datetime.utcnow()
        db.add(user)
        db.commit()
        db.refresh(user)
        try:
            _send_password_reset_email(user, user.password_reset_token)
        except Exception:
            log.exception("Password reset email failed for user=%s", user.id)
    # Always the same response so the endpoint can't be used to probe accounts.
    return {"ok": True}


@router.post("/password/reset")
def password_reset(body: ResetPasswordBody, db: Session = Depends(referrall_db)):
    token = body.token.strip()
    user = db.scalars(
        select(T1ReferrallUser).where(T1ReferrallUser.password_reset_token == token)
    ).first()
    sent_at = user.password_reset_sent_at if user else None
    expired = (
        sent_at is None
        or datetime.utcnow() - sent_at > timedelta(hours=PASSWORD_RESET_TTL_HOURS)
    )
    if user is None or not token or expired:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link.")
    _validate_password_strength(body.password)
    user.password_hash = _hash_password(body.password)
    user.password_reset_token = None
    user.password_reset_sent_at = None
    user.updated_at = datetime.utcnow()
    db.add(user)
    # Invalidate all existing sessions so a leaked token can't keep old logins alive.
    db.execute(delete(T1ReferrallSession).where(T1ReferrallSession.user_id == user.id))
    db.commit()
    return {"ok": True}


AUTH_SCHEMA_MIGRATE_HINT = (
    "Run on the server: bash deploy/migrate-t1referrall-v10.sh && "
    "bash deploy/migrate-t1referrall-v11.sh"
)


def _auth_db_ready(db: Session) -> tuple[bool, str | None]:
    """True when login/register can read users and write sessions."""
    try:
        db.scalar(select(T1ReferrallUser.totp_enabled).limit(1))
        db.scalar(select(T1ReferrallUser.banner_url).limit(1))
        db.scalar(select(T1ReferrallSession.user_agent).limit(1))
        return True, None
    except ProgrammingError:
        db.rollback()
        return False, AUTH_SCHEMA_MIGRATE_HINT
    except Exception:
        db.rollback()
        return False, "Auth database schema is out of date."


def _premium_db_ready(db: Session) -> tuple[bool, str | None]:
    try:
        db.scalar(select(func.count()).select_from(T1ReferrallPremiumPurchase))
        db.scalar(
            select(T1ReferrallSeekerPost.is_premium).limit(1)
        )
        db.scalar(select(T1ReferrallPremiumPurchase.refunded_at).limit(1))
        return True, None
    except ProgrammingError as exc:
        db.rollback()
        msg = str(exc)
        if "refunded_at" in msg or "stripe_payment_intent_id" in msg:
            return False, "Run bash deploy/fix-referr-all-premium.sh on the server (v7 migration)."
        return False, "Premium database schema is out of date."
    except Exception as exc:
        db.rollback()
        return False, "Premium database not ready."


@router.get("/status")
def referrall_status():
    """Public config hints for the SPA (no secrets)."""
    missing = []
    if not os.getenv("STRIPE_SECRET_KEY"):
        missing.append("STRIPE_SECRET_KEY")
    if not os.getenv("STRIPE_WEBHOOK_SECRET"):
        missing.append("STRIPE_WEBHOOK_SECRET")
    if not os.getenv("STRIPE_PUBLIC_BASE_URL"):
        missing.append("STRIPE_PUBLIC_BASE_URL")
    premium_ready = False
    premium_err: str | None = None
    auth_ready = False
    auth_err: str | None = None
    if credential_service.database_enabled() and SessionLocal is not None:
        db = SessionLocal()
        try:
            auth_ready, auth_err = _auth_db_ready(db)
            premium_ready, premium_err = _premium_db_ready(db)
        finally:
            db.close()
    return {
        "paymentsConfigured": stripe_service.stripe_enabled(),
        "imageStorageConfigured": image_storage.storage_enabled(),
        "authDbReady": auth_ready,
        "authDbError": auth_err,
        "premiumDbReady": premium_ready,
        "premiumDbError": premium_err,
        "usaOnly": True,
        "missingPaymentEnv": missing,
    }


@router.get("/me")
def me(user: T1ReferrallUser = Depends(get_current_referrall_user)):
    return _profile_out(user, include_email=True)


@router.patch("/me")
def patch_me(
    body: ProfilePatchBody,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    if body.fullName is not None:
        user.full_name = body.fullName.strip()
    if body.bio is not None:
        user.bio = body.bio.strip()
    if body.company is not None:
        user.company = body.company.strip()
    if body.role is not None:
        user.role = body.role.strip()
    if body.location is not None:
        loc = body.location.strip()
        if loc:
            _require_usa_location(loc)
        user.location = loc
    if body.linkedinUrl is not None:
        user.linkedin_url = _validate_url(body.linkedinUrl, "LinkedIn URL")
    if body.portfolioUrl is not None:
        user.portfolio_url = _validate_url(body.portfolioUrl, "Portfolio URL")
    if body.yearsExperience is not None:
        user.years_experience = body.yearsExperience
    if body.skills is not None:
        user.skills = [s.strip() for s in body.skills if s.strip()][:50]
    if body.interests is not None:
        user.interests = [s.strip() for s in body.interests if s.strip()][:50]
    if body.avatarUrl is not None:
        user.avatar_url = _validate_url(body.avatarUrl, "Avatar URL", allow_data_image=True)
    if body.bannerUrl is not None:
        user.banner_url = _validate_url(body.bannerUrl, "Banner URL", allow_data_image=True)
    user.updated_at = datetime.utcnow()
    db.add(user)
    db.commit()
    db.refresh(user)
    return _profile_out(user, include_email=True)


# --- Account & security settings ---


# Notification/visibility preferences the SPA is allowed to set, with defaults.
_ALLOWED_SETTINGS_KEYS = frozenset({
    "email_notifications",
    "connection_request_emails",
    "message_emails",
    "marketing_emails",
    "profile_discoverable",
    "show_online_status",
})


@router.post("/account/password")
def change_password(
    body: ChangePasswordBody,
    request: Request,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    _rate_limit(f"chpw:{user.id}", max_attempts=10, window_seconds=3600)
    if not _verify_password(body.currentPassword, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    _validate_password_strength(body.newPassword)
    user.password_hash = _hash_password(body.newPassword)
    user.updated_at = datetime.utcnow()
    db.add(user)
    # Invalidate every other session; keep the caller signed in by re-issuing.
    db.execute(delete(T1ReferrallSession).where(T1ReferrallSession.user_id == user.id))
    db.commit()
    token = _create_session(db, user.id, request)
    return {"ok": True, "token": token}


@router.post("/account/email")
def change_email(
    body: ChangeEmailBody,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    _rate_limit(f"chemail:{user.id}", max_attempts=10, window_seconds=3600)
    if not _verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Password is incorrect.")
    new_email = body.newEmail.strip().lower()
    if "@" not in new_email or "." not in new_email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if new_email == (user.email or "").lower():
        raise HTTPException(status_code=400, detail="That is already your email address.")
    existing = db.scalars(
        select(T1ReferrallUser).where(func.lower(T1ReferrallUser.email) == new_email)
    ).first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="That email is already registered.")
    user.email = new_email
    user.email_verified = False
    user.email_verify_token = secrets.token_urlsafe(32)
    user.email_verify_sent_at = datetime.utcnow()
    user.updated_at = datetime.utcnow()
    db.add(user)
    db.commit()
    db.refresh(user)
    try:
        _send_verification_email(user)
    except Exception:
        log.exception("Verification email send failed after email change user=%s", user.id)
    return {"ok": True, "profile": _profile_out(user, include_email=True), "verificationSent": _email_configured()}


@router.post("/account/phone")
def set_phone(
    body: ChangePhoneBody,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    phone = re.sub(r"[^\d+\-\s().]", "", body.phone or "").strip()[:32]
    user.phone = phone
    user.updated_at = datetime.utcnow()
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"ok": True, "profile": _profile_out(user, include_email=True)}


@router.patch("/account/settings")
def update_account_settings(
    body: AccountSettingsBody,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    current = dict(getattr(user, "settings", None) or {})
    for key, value in (body.settings or {}).items():
        if key in _ALLOWED_SETTINGS_KEYS:
            current[key] = bool(value)
    user.settings = current
    user.updated_at = datetime.utcnow()
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"ok": True, "settings": current}


@router.get("/account/2fa/setup")
def two_factor_setup(user: T1ReferrallUser = Depends(get_current_referrall_user)):
    """Generate (but do not yet enable) a TOTP secret + provisioning QR."""
    try:
        import pyotp
    except ImportError:
        raise HTTPException(status_code=503, detail="2FA is not available on this server yet.")
    secret = pyotp.random_base32()
    otpauth_url = pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name=TOTP_ISSUER)
    qr_data_url = _qr_data_url(otpauth_url)
    return {"secret": secret, "otpauthUrl": otpauth_url, "qrDataUrl": qr_data_url}


@router.post("/account/2fa/enable")
def two_factor_enable(
    body: TwoFactorEnableBody,
    secret: Annotated[str | None, Header(alias="X-2FA-Secret")] = None,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    secret = (secret or "").strip()
    if not secret:
        raise HTTPException(status_code=400, detail="Missing setup secret. Restart 2FA setup.")
    if not _verify_totp(secret, body.code):
        raise HTTPException(status_code=400, detail="That code didn't match. Try the current code.")
    user.totp_secret = secret
    user.totp_enabled = True
    user.updated_at = datetime.utcnow()
    db.add(user)
    db.commit()
    return {"ok": True}


@router.post("/account/2fa/disable")
def two_factor_disable(
    body: TwoFactorDisableBody,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    if not _verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Password is incorrect.")
    user.totp_secret = None
    user.totp_enabled = False
    user.updated_at = datetime.utcnow()
    db.add(user)
    db.commit()
    return {"ok": True}


@router.get("/account/sessions")
def list_sessions(
    authorization: Annotated[str | None, Header()] = None,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    current = _bearer_token(authorization)
    rows = db.scalars(
        select(T1ReferrallSession)
        .where(T1ReferrallSession.user_id == user.id)
        .order_by(T1ReferrallSession.created_at.desc())
    ).all()
    out = []
    for row in rows:
        out.append({
            "id": row.token[:12],
            "current": row.token == current,
            "user_agent": getattr(row, "user_agent", "") or "",
            "ip": getattr(row, "ip", "") or "",
            "created_at": _iso(row.created_at),
            "last_seen_at": _iso(getattr(row, "last_seen_at", None)),
            "expires_at": _iso(row.expires_at),
        })
    return out


@router.post("/account/sessions/revoke-others")
def revoke_other_sessions(
    authorization: Annotated[str | None, Header()] = None,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    current = _bearer_token(authorization)
    stmt = delete(T1ReferrallSession).where(T1ReferrallSession.user_id == user.id)
    if current:
        stmt = stmt.where(T1ReferrallSession.token != current)
    db.execute(stmt)
    db.commit()
    return {"ok": True}


@router.delete("/account/sessions/{session_id}")
def revoke_session(
    session_id: str,
    authorization: Annotated[str | None, Header()] = None,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    session_id = (session_id or "").strip()
    rows = db.scalars(
        select(T1ReferrallSession).where(T1ReferrallSession.user_id == user.id)
    ).all()
    target = next((r for r in rows if r.token == session_id or r.token[:12] == session_id), None)
    if target is None:
        raise HTTPException(status_code=404, detail="Session not found.")
    db.delete(target)
    db.commit()
    return {"ok": True}


@router.get("/account/purchases")
def list_purchases(
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    try:
        rows = db.scalars(
            select(T1ReferrallPremiumPurchase)
            .where(T1ReferrallPremiumPurchase.user_id == user.id)
            .order_by(T1ReferrallPremiumPurchase.created_at.desc())
        ).all()
    except ProgrammingError:
        db.rollback()
        return []
    out = []
    for row in rows:
        out.append({
            "id": row.id,
            "amount_cents": row.amount_cents,
            "purchase_number": row.purchase_number,
            "refund_cents": row.refund_cents,
            "refunded_at": _iso(row.refunded_at),
            "created_at": _iso(row.created_at),
            "description": "Featured seeker post (30 days)",
        })
    return out


@router.post("/account/deactivate")
def deactivate_account(
    body: DeactivateAccountBody,
    authorization: Annotated[str | None, Header()] = None,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    if not _verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Password is incorrect.")
    user.is_deactivated = True
    user.deactivated_at = datetime.utcnow()
    user.updated_at = datetime.utcnow()
    db.add(user)
    # End all sessions; signing back in reactivates the account.
    db.execute(delete(T1ReferrallSession).where(T1ReferrallSession.user_id == user.id))
    db.commit()
    return {"ok": True}


@router.delete("/account")
def delete_account(
    body: DeleteAccountBody,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    if not _verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Password is incorrect.")
    # ON DELETE CASCADE on the FKs removes posts, connections, messages, blocks,
    # sessions, and premium-purchase rows tied to this user.
    db.delete(user)
    db.commit()
    return {"ok": True}


# --- Profiles (network discovery) ---


@router.get("/profiles")
def list_profiles(
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    blocked_ids = set(
        db.scalars(
            select(T1ReferrallUserBlock.blocked_id).where(
                T1ReferrallUserBlock.blocker_id == user.id
            )
        ).all()
    )
    stmt = (
        select(T1ReferrallUser)
        .where(
            T1ReferrallUser.id != user.id,
            T1ReferrallUser.is_suspended.is_(False),
            T1ReferrallUser.is_deactivated.is_(False),
        )
        .order_by(T1ReferrallUser.username)
    )
    if blocked_ids:
        stmt = stmt.where(T1ReferrallUser.id.not_in(blocked_ids))
    rows = db.scalars(stmt).all()
    # Honor the "Discoverable profile" preference (defaults to discoverable).
    rows = [r for r in rows if (getattr(r, "settings", None) or {}).get("profile_discoverable") is not False]
    return [_profile_out(r) for r in rows]


@router.get("/profiles/{profile_id}")
def get_profile(
    profile_id: str,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    row = db.get(T1ReferrallUser, profile_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    return _profile_out(row)


# --- Job posts ---


@router.get("/posts")
def list_posts(
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    rows = db.scalars(
        select(T1ReferrallPost).order_by(T1ReferrallPost.created_at.desc())
    ).all()
    author_ids = {r.author_id for r in rows}
    hidden = _deactivated_author_ids(db, author_ids)
    rows = [r for r in rows if r.author_id not in hidden]
    profiles = _load_profiles(db, author_ids - hidden)
    return [_post_out(r, profiles) for r in rows]


@router.post("/posts")
def create_post(
    body: CreatePostBody,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    _require_usa_location(body.location.strip(), open_to_remote=body.isRemote)
    row = T1ReferrallPost(
        id=str(uuid.uuid4()),
        author_id=user.id,
        company=body.company.strip(),
        role_title=body.roleTitle.strip(),
        description=body.description.strip(),
        referral_bonus=body.referralBonus.strip(),
        has_bonus=body.hasBonus,
        job_url=_validate_url(body.jobUrl, "Job URL"),
        location=body.location.strip(),
        is_remote=body.isRemote,
        tags=[t.strip() for t in body.tags if t.strip()][:20],
        required_skills=[s.strip() for s in body.requiredSkills if s.strip()][:30],
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _post_out(row, {user.id: _profile_out(user)})


@router.delete("/posts/{post_id}")
def delete_post(
    post_id: str,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    row = db.get(T1ReferrallPost, post_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Post not found")
    if row.author_id != user.id:
        raise HTTPException(status_code=403, detail="Not your post")
    _remove_post_reports(db, _POST_KIND_JOB, post_id)
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.post("/posts/{post_id}/report")
def report_post(
    post_id: str,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    row = db.get(T1ReferrallPost, post_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return _create_post_report(
        db, user, _POST_KIND_JOB, post_id, author_id=row.author_id
    )


@router.get("/posts/{post_id}/reported")
def check_post_reported(
    post_id: str,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    row = db.get(T1ReferrallPost, post_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return {"reported": _user_reported_post(db, user.id, _POST_KIND_JOB, post_id)}


# --- Seeker posts ---


@router.get("/seeker-posts")
def list_seeker_posts(
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    now = datetime.utcnow()
    rows = db.scalars(
        select(T1ReferrallSeekerPost).order_by(
            T1ReferrallSeekerPost.is_premium.desc(),
            T1ReferrallSeekerPost.premium_order.desc(),
            T1ReferrallSeekerPost.created_at.desc(),
        )
    ).all()
    for r in rows:
        if r.is_premium and r.premium_expires_at and r.premium_expires_at < now:
            r.is_premium = False
    author_ids = {r.author_id for r in rows}
    hidden = _deactivated_author_ids(db, author_ids)
    rows = [r for r in rows if r.author_id not in hidden]
    profiles = _load_profiles(db, author_ids - hidden)
    return [_seeker_out(r, profiles) for r in rows]


@router.post("/seeker-posts")
def create_seeker_post(
    body: CreateSeekerPostBody,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    avail = body.availability.strip()
    if avail not in _AVAILABILITY:
        raise HTTPException(status_code=400, detail="Invalid availability")
    existing = int(
        db.scalar(
            select(func.count())
            .select_from(T1ReferrallSeekerPost)
            .where(T1ReferrallSeekerPost.author_id == user.id)
        )
        or 0
    )
    if existing >= 1:
        raise HTTPException(
            status_code=409,
            detail="You already have a seeker post. Delete it before creating a new one.",
        )
    _require_usa_location(body.desiredLocation.strip(), open_to_remote=body.openToRemote)
    row = T1ReferrallSeekerPost(
        id=str(uuid.uuid4()),
        author_id=user.id,
        headline=body.headline.strip() or body.desiredRole.strip(),
        about=body.about.strip(),
        desired_role=body.desiredRole.strip(),
        desired_location=body.desiredLocation.strip(),
        open_to_remote=body.openToRemote,
        field_of_work=body.fieldOfWork.strip(),
        skills=[s.strip() for s in body.skills if s.strip()][:30],
        experience_years=body.experienceYears,
        resume_url=_validate_url(body.resumeUrl, "Resume URL"),
        portfolio_url=_validate_url(body.portfolioUrl, "Portfolio URL"),
        availability=avail,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _seeker_out(row, {user.id: _profile_out(user)})


def _premium_purchase_for_post(db: Session, post_id: str) -> T1ReferrallPremiumPurchase | None:
    return db.scalars(
        select(T1ReferrallPremiumPurchase)
        .where(
            T1ReferrallPremiumPurchase.seeker_post_id == post_id,
            T1ReferrallPremiumPurchase.refunded_at.is_(None),
        )
        .order_by(T1ReferrallPremiumPurchase.created_at.desc())
    ).first()


def _resolve_premium_payment_intent(purchase: T1ReferrallPremiumPurchase) -> str | None:
    if purchase.stripe_payment_intent_id:
        return purchase.stripe_payment_intent_id
    if purchase.stripe_session_id:
        pi, _ = stripe_service.payment_intent_from_checkout_session(purchase.stripe_session_id)
        return pi
    return None


def _refund_premium_for_deleted_seeker_post(
    db: Session,
    row: T1ReferrallSeekerPost,
) -> dict[str, Any]:
    if not _post_premium_active(row) or not row.premium_expires_at:
        return {"refundCents": 0, "refundEligible": False}
    purchase = _premium_purchase_for_post(db, row.id)
    if purchase is None:
        return {"refundCents": 0, "refundEligible": False}
    window_end = row.premium_expires_at
    window_start = window_end - timedelta(days=PREMIUM_DURATION_DAYS)
    payment_intent_id = _resolve_premium_payment_intent(purchase)
    outcome = stripe_service.refund_premium_for_seeker_post_delete(
        amount_cents=purchase.amount_cents,
        payment_intent_id=payment_intent_id or "",
        window_start=window_start,
        window_end=window_end,
        seeker_post_id=row.id,
        already_refunded=purchase.refunded_at is not None,
    )
    if outcome.get("eligible") and outcome.get("stripe_refund_id"):
        purchase.refunded_at = datetime.utcnow()
        purchase.refund_cents = int(outcome.get("refund_cents") or 0)
        purchase.stripe_refund_id = outcome.get("stripe_refund_id")
        if payment_intent_id and not purchase.stripe_payment_intent_id:
            purchase.stripe_payment_intent_id = payment_intent_id
        db.add(purchase)
        db.commit()
    return {
        "refundCents": int(outcome.get("refund_cents") or 0),
        "refundEligible": bool(outcome.get("eligible")),
        "refundBlockedReason": outcome.get("blocked_reason") or outcome.get("error"),
    }


@router.delete("/seeker-posts/{post_id}")
def delete_seeker_post(
    post_id: str,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    row = db.get(T1ReferrallSeekerPost, post_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Post not found")
    if row.author_id != user.id:
        raise HTTPException(status_code=403, detail="Not your post")
    refund_info = _refund_premium_for_deleted_seeker_post(db, row)
    _remove_post_reports(db, _POST_KIND_SEEKER, post_id)
    db.delete(row)
    db.commit()
    return {"ok": True, **refund_info}


@router.post("/seeker-posts/{post_id}/report")
def report_seeker_post(
    post_id: str,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    row = db.get(T1ReferrallSeekerPost, post_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return _create_post_report(
        db, user, _POST_KIND_SEEKER, post_id, author_id=row.author_id
    )


@router.get("/seeker-posts/{post_id}/reported")
def check_seeker_post_reported(
    post_id: str,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    row = db.get(T1ReferrallSeekerPost, post_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return {"reported": _user_reported_post(db, user.id, _POST_KIND_SEEKER, post_id)}


# --- Connections ---


@router.get("/connections")
def list_connections(
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    rows = db.scalars(
        select(T1ReferrallConnection).where(
            or_(
                T1ReferrallConnection.requester_id == user.id,
                T1ReferrallConnection.addressee_id == user.id,
            )
        )
    ).all()
    user_ids: set[str] = set()
    for r in rows:
        user_ids.add(r.requester_id)
        user_ids.add(r.addressee_id)
    profiles = _load_profiles(db, user_ids)
    out = []
    for r in rows:
        item = _connection_out(r)
        item["requester"] = profiles.get(r.requester_id)
        item["addressee"] = profiles.get(r.addressee_id)
        out.append(item)
    return out


@router.post("/connections")
def create_connection(
    body: ConnectionCreateBody,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    if body.addresseeId == user.id:
        raise HTTPException(status_code=400, detail="Cannot connect with yourself")
    if db.get(T1ReferrallUser, body.addresseeId) is None:
        raise HTTPException(status_code=404, detail="User not found")
    row = T1ReferrallConnection(
        id=str(uuid.uuid4()),
        requester_id=user.id,
        addressee_id=body.addresseeId,
        status="pending",
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Connection already exists")
    db.refresh(row)
    return _connection_out(row)


@router.patch("/connections/{connection_id}")
def update_connection(
    connection_id: str,
    body: ConnectionPatchBody,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    if body.status not in _CONN_STATUS:
        raise HTTPException(status_code=400, detail="Invalid status")
    row = db.get(T1ReferrallConnection, connection_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Connection not found")
    if row.addressee_id != user.id and row.requester_id != user.id:
        raise HTTPException(status_code=403, detail="Not your connection")
    if body.status in ("accepted", "declined") and row.addressee_id != user.id:
        raise HTTPException(status_code=403, detail="Only the recipient can accept or decline")
    row.status = body.status
    row.updated_at = datetime.utcnow()
    db.add(row)
    db.commit()
    return _connection_out(row)


@router.delete("/connections/{connection_id}")
def delete_connection(
    connection_id: str,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    row = db.get(T1ReferrallConnection, connection_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Connection not found")
    if row.requester_id != user.id and row.addressee_id != user.id:
        raise HTTPException(status_code=403, detail="Not your connection")
    db.delete(row)
    db.commit()
    return {"ok": True}


# --- Blocks ---


@router.get("/blocks")
def list_blocks(
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    rows = db.scalars(
        select(T1ReferrallUserBlock).where(T1ReferrallUserBlock.blocker_id == user.id)
    ).all()
    profile_ids = {r.blocked_id for r in rows}
    profiles = _load_profiles(db, profile_ids)
    return [
        {
            "id": r.id,
            "blocked_id": r.blocked_id,
            "created_at": _iso(r.created_at),
            "profile": profiles.get(r.blocked_id),
        }
        for r in rows
    ]


@router.post("/blocks")
def create_block(
    body: BlockBody,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    if body.blockedId == user.id:
        raise HTTPException(status_code=400, detail="Cannot block yourself")
    if db.get(T1ReferrallUser, body.blockedId) is None:
        raise HTTPException(status_code=404, detail="User not found")
    row = T1ReferrallUserBlock(
        id=str(uuid.uuid4()),
        blocker_id=user.id,
        blocked_id=body.blockedId,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return {"ok": True}
    _check_block_suspend(db, body.blockedId)
    return {"ok": True}


@router.delete("/blocks/{blocked_id}")
def delete_block(
    blocked_id: str,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    db.execute(
        delete(T1ReferrallUserBlock).where(
            T1ReferrallUserBlock.blocker_id == user.id,
            T1ReferrallUserBlock.blocked_id == blocked_id,
        )
    )
    db.commit()
    return {"ok": True}


@router.get("/blocks/check/{blocked_id}")
def check_block(
    blocked_id: str,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    row = db.scalars(
        select(T1ReferrallUserBlock).where(
            T1ReferrallUserBlock.blocker_id == user.id,
            T1ReferrallUserBlock.blocked_id == blocked_id,
        )
    ).first()
    return {"blocked": row is not None, "id": row.id if row else None}


# --- Conversations & messages ---


@router.get("/conversations")
def list_conversations(
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    conv_ids = db.scalars(
        select(T1ReferrallConversationParticipant.conversation_id).where(
            T1ReferrallConversationParticipant.user_id == user.id
        )
    ).all()
    if not conv_ids:
        return []
    convs = db.scalars(
        select(T1ReferrallConversation)
        .where(T1ReferrallConversation.id.in_(conv_ids))
        .order_by(T1ReferrallConversation.updated_at.desc())
    ).all()
    participants = db.scalars(
        select(T1ReferrallConversationParticipant).where(
            T1ReferrallConversationParticipant.conversation_id.in_(conv_ids)
        )
    ).all()
    other_ids: set[str] = set()
    conv_to_other: dict[str, str] = {}
    for p in participants:
        if p.user_id != user.id:
            other_ids.add(p.user_id)
            conv_to_other[p.conversation_id] = p.user_id
    profiles = _load_profiles(db, other_ids)
    out = []
    for c in convs:
        last_msg = db.scalars(
            select(T1ReferrallMessage)
            .where(T1ReferrallMessage.conversation_id == c.id)
            .order_by(T1ReferrallMessage.created_at.desc())
            .limit(1)
        ).first()
        other_id = conv_to_other.get(c.id)
        item: dict[str, Any] = {
            "id": c.id,
            "created_at": _iso(c.created_at),
            "updated_at": _iso(c.updated_at),
            "otherUser": profiles.get(other_id) if other_id else None,
            "lastMessage": _message_out(last_msg) if last_msg else None,
        }
        out.append(item)
    return out


@router.post("/conversations")
def create_conversation(
    body: ConversationCreateBody,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    if body.otherUserId == user.id:
        raise HTTPException(status_code=400, detail="Cannot message yourself")
    if db.get(T1ReferrallUser, body.otherUserId) is None:
        raise HTTPException(status_code=404, detail="User not found")
    my_conv_ids = set(
        db.scalars(
            select(T1ReferrallConversationParticipant.conversation_id).where(
                T1ReferrallConversationParticipant.user_id == user.id
            )
        ).all()
    )
    if my_conv_ids:
        shared = db.scalars(
            select(T1ReferrallConversationParticipant.conversation_id).where(
                T1ReferrallConversationParticipant.user_id == body.otherUserId,
                T1ReferrallConversationParticipant.conversation_id.in_(my_conv_ids),
            )
        ).first()
        if shared:
            conv = db.get(T1ReferrallConversation, shared)
            return {"id": shared, "created_at": _iso(conv.created_at) if conv else None}

    conv_id = str(uuid.uuid4())
    conv = T1ReferrallConversation(id=conv_id)
    db.add(conv)
    db.add(T1ReferrallConversationParticipant(conversation_id=conv_id, user_id=user.id))
    db.add(
        T1ReferrallConversationParticipant(
            conversation_id=conv_id, user_id=body.otherUserId
        )
    )
    db.commit()
    return {"id": conv_id, "created_at": _iso(conv.created_at)}


@router.get("/conversations/{conversation_id}/messages")
def list_messages(
    conversation_id: str,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    if not _user_participates(db, conversation_id, user.id):
        raise HTTPException(status_code=403, detail="Not a participant")
    rows = db.scalars(
        select(T1ReferrallMessage)
        .where(T1ReferrallMessage.conversation_id == conversation_id)
        .order_by(T1ReferrallMessage.created_at.asc())
    ).all()
    sender_ids = {r.sender_id for r in rows}
    profiles = _load_profiles(db, sender_ids)
    return [_message_out(r, profiles.get(r.sender_id)) for r in rows]


@router.post("/conversations/{conversation_id}/messages")
def send_message(
    conversation_id: str,
    body: MessageBody,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    if not _user_participates(db, conversation_id, user.id):
        raise HTTPException(status_code=403, detail="Not a participant")
    msg = T1ReferrallMessage(
        id=str(uuid.uuid4()),
        conversation_id=conversation_id,
        sender_id=user.id,
        content=body.content.strip(),
    )
    db.add(msg)
    db.execute(
        update(T1ReferrallConversation)
        .where(T1ReferrallConversation.id == conversation_id)
        .values(updated_at=datetime.utcnow())
    )
    db.commit()
    db.refresh(msg)
    return _message_out(msg, _profile_out(user))


# --- Avatar upload ---


@router.post("/uploads/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    content = await file.read()
    if len(content) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=400, detail="Image too large (max 4 MB)")
    ct = (file.content_type or "").lower()
    if not ct or ct == "application/octet-stream":
        ct = "image/jpeg"
    if not image_storage.allowed_content_type(ct):
        raise HTTPException(status_code=400, detail="Unsupported image type (use JPEG, PNG, WebP, or GIF)")

    url: str | None = None

    if image_storage.storage_enabled():
        ext_map = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}
        ext = ext_map.get(ct, "jpg")
        key = f"t1ref/{user.id}/avatar.{ext}"
        try:
            url = image_storage.upload_image_at_key(key, content, ct)
        except Exception:
            log.exception("Avatar S3 upload failed for user=%s — trying inline fallback", user.id)
            url = None

    if url is None:
        if len(content) > _INLINE_AVATAR_MAX_BYTES:
            try:
                content, ct = _shrink_avatar_for_inline(content, ct)
            except ImportError:
                log.exception("Avatar resize failed: Pillow not installed")
                raise HTTPException(
                    status_code=503,
                    detail="Install Pillow on the server (pip install -r requirements.txt) or fix S3_* env vars.",
                )
            except Exception:
                log.exception("Avatar inline resize failed for user=%s", user.id)
                raise HTTPException(
                    status_code=503,
                    detail="Could not process image. Try a smaller photo.",
                )
        if len(content) > _INLINE_AVATAR_MAX_BYTES:
            raise HTTPException(
                status_code=503,
                detail="Image still too large after compression.",
            )
        b64 = base64.b64encode(content).decode("ascii")
        url = f"data:{ct};base64,{b64}"

    user.avatar_url = url
    user.updated_at = datetime.utcnow()
    db.add(user)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        log.exception("Avatar DB save failed for user=%s (url_len=%s)", user.id, len(url))
        raise HTTPException(
            status_code=500,
            detail="Could not save avatar. Run: bash deploy/migrate-t1referrall-v4.sh",
        ) from exc
    return {"url": url}


@router.post("/uploads/banner")
async def upload_banner(
    file: UploadFile = File(...),
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    content = await file.read()
    if len(content) > MAX_BANNER_BYTES:
        raise HTTPException(status_code=400, detail="Image too large (max 4 MB)")
    ct = (file.content_type or "").lower()
    if not ct or ct == "application/octet-stream":
        ct = "image/jpeg"
    if not image_storage.allowed_content_type(ct):
        raise HTTPException(status_code=400, detail="Unsupported image type (use JPEG, PNG, WebP, or GIF)")

    url: str | None = None

    if image_storage.storage_enabled():
        ext_map = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}
        ext = ext_map.get(ct, "jpg")
        key = f"t1ref/{user.id}/banner.{ext}"
        try:
            url = image_storage.upload_image_at_key(key, content, ct)
        except Exception:
            log.exception("Banner S3 upload failed for user=%s — trying inline fallback", user.id)
            url = None

    if url is None:
        if len(content) > _INLINE_BANNER_MAX_BYTES:
            try:
                content, ct = _shrink_banner_for_inline(content, ct)
            except ImportError:
                log.exception("Banner resize failed: Pillow not installed")
                raise HTTPException(
                    status_code=503,
                    detail="Install Pillow on the server (pip install -r requirements.txt) or fix S3_* env vars.",
                )
            except Exception:
                log.exception("Banner inline resize failed for user=%s", user.id)
                raise HTTPException(
                    status_code=503,
                    detail="Could not process image. Try a smaller photo.",
                )
        if len(content) > _INLINE_BANNER_MAX_BYTES:
            raise HTTPException(
                status_code=503,
                detail="Image still too large after compression.",
            )
        b64 = base64.b64encode(content).decode("ascii")
        url = f"data:{ct};base64,{b64}"

    user.banner_url = url
    user.updated_at = datetime.utcnow()
    db.add(user)
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        log.exception("Banner DB save failed for user=%s (url_len=%s)", user.id, len(url))
        raise HTTPException(
            status_code=500,
            detail="Could not save banner. Run: bash deploy/migrate-t1referrall-v11.sh",
        ) from exc
    return {"url": url}


# --- Premium / Stripe ---


@router.get("/premium/price")
def premium_price(
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    try:
        cents = _premium_price_cents(db)
        count = _premium_purchase_count_30d(db)
    except ProgrammingError as exc:
        db.rollback()
        log.exception("Premium price DB error")
        raise HTTPException(
            status_code=500,
            detail="Database schema out of date — run bash deploy/migrate-t1referrall-v7.sh on the server",
        ) from exc
    return {
        "priceCents": cents,
        "purchaseNumber": count + 1,
        "priorPurchases30d": count,
        "durationDays": PREMIUM_DURATION_DAYS,
        "surgeTiers": [
            {"throughPurchase": 5, "incrementUsd": 10},
            {"throughPurchase": 10, "incrementUsd": 20},
            {"throughPurchase": None, "incrementUsd": 50},
        ],
    }


def _coerce_stripe_mapping(raw: Any) -> dict[str, Any]:
    """Convert Stripe metadata / nested objects to a plain string-key dict."""
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return {str(k): v for k, v in raw.items()}
    to_dict = getattr(raw, "to_dict", None)
    if callable(to_dict):
        try:
            converted = to_dict()
            if isinstance(converted, dict):
                return {str(k): v for k, v in converted.items()}
        except Exception:
            pass
    try:
        items = raw.items()
        return {str(k): v for k, v in items}
    except Exception:
        pass
    try:
        return {str(k): raw[k] for k in raw}
    except Exception:
        return {}


def _checkout_session_meta(session: Any) -> dict[str, Any]:
    if isinstance(session, dict):
        raw = session.get("metadata") or {}
    else:
        raw = getattr(session, "metadata", None) or {}
    return _coerce_stripe_mapping(raw)


def _checkout_session_field(session: Any, key: str, default: Any = None) -> Any:
    if isinstance(session, dict):
        return session.get(key, default)
    return getattr(session, key, default)


def _checkout_session_paid(session: Any) -> bool:
    payment_status = _checkout_session_field(session, "payment_status")
    status = _checkout_session_field(session, "status")
    return payment_status == "paid" or status == "complete"


def _apply_premium_to_post(db: Session, post: T1ReferrallSeekerPost) -> None:
    max_order = db.scalar(
        select(func.max(T1ReferrallSeekerPost.premium_order)).where(
            T1ReferrallSeekerPost.is_premium.is_(True)
        )
    )
    next_order = int(max_order or 0) + 1
    expires = datetime.utcnow() + timedelta(days=PREMIUM_DURATION_DAYS)
    post.is_premium = True
    post.premium_expires_at = expires
    post.premium_order = next_order
    post.updated_at = datetime.utcnow()
    db.add(post)


def _post_premium_active(post: T1ReferrallSeekerPost | None, now: datetime | None = None) -> bool:
    if post is None or not post.is_premium:
        return False
    if post.premium_expires_at is None:
        return True
    return post.premium_expires_at > (now or datetime.utcnow())


def _fulfill_premium_checkout(db: Session, session: Any) -> dict[str, Any] | None:
    """Mark seeker post featured after a paid Checkout session (idempotent)."""
    meta = _checkout_session_meta(session)
    if meta.get("product") not in ("referr_all_premium", "t1referrall_premium"):
        return None

    session_id = _checkout_session_field(session, "id")
    if not _checkout_session_paid(session):
        log.warning(
            "Premium fulfillment: session %s not paid (payment_status=%s, status=%s)",
            session_id,
            _checkout_session_field(session, "payment_status"),
            _checkout_session_field(session, "status"),
        )
        return None

    seeker_post_id = meta.get("seeker_post_id")
    if not seeker_post_id:
        return None

    if not session_id:
        return None

    existing = db.scalars(
        select(T1ReferrallPremiumPurchase).where(
            T1ReferrallPremiumPurchase.stripe_session_id == session_id
        )
    ).first()
    post = db.get(T1ReferrallSeekerPost, seeker_post_id)
    if existing:
        if post and not _post_premium_active(post):
            _apply_premium_to_post(db, post)
            db.commit()
            log.info("Premium fulfillment: healed inactive post %s for session %s", seeker_post_id, session_id)
        return {
            "seekerPostId": seeker_post_id,
            "duplicate": True,
            "isPremium": _post_premium_active(post),
        }

    if post is None:
        log.warning("Premium fulfillment: missing seeker post %s", seeker_post_id)
        return None

    _apply_premium_to_post(db, post)

    pi_id: str | None = None
    if session_id:
        try:
            pi_id, _ = stripe_service.payment_intent_from_checkout_session(session_id)
        except Exception:
            log.warning("Premium fulfillment: could not resolve payment intent for %s", session_id)

    purchase_kwargs: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "user_id": post.author_id,
        "seeker_post_id": seeker_post_id,
        "amount_cents": int(meta.get("amount_cents") or _checkout_session_field(session, "amount_total") or 0),
        "purchase_number": int(meta.get("purchase_number") or 0),
        "stripe_session_id": session_id,
    }
    if pi_id:
        purchase_kwargs["stripe_payment_intent_id"] = pi_id
    purchase = T1ReferrallPremiumPurchase(**purchase_kwargs)
    db.add(purchase)
    try:
        db.commit()
    except ProgrammingError as exc:
        db.rollback()
        log.exception("Premium fulfillment DB error — run migrate-t1referrall-v7.sh")
        raise HTTPException(
            status_code=500,
            detail="Database schema out of date — run bash deploy/migrate-t1referrall-v7.sh on the server",
        ) from exc
    except IntegrityError:
        db.rollback()
        existing = db.scalars(
            select(T1ReferrallPremiumPurchase).where(
                T1ReferrallPremiumPurchase.stripe_session_id == session_id
            )
        ).first()
        post = db.get(T1ReferrallSeekerPost, seeker_post_id)
        if post and not _post_premium_active(post):
            _apply_premium_to_post(db, post)
            db.commit()
        return {
            "seekerPostId": seeker_post_id,
            "duplicate": True,
            "isPremium": _post_premium_active(post),
        }
    return {"seekerPostId": seeker_post_id, "isPremium": True}


@router.post("/premium/checkout")
def premium_checkout(
    body: PremiumCheckoutBody,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    if not stripe_service.stripe_enabled():
        raise HTTPException(
            status_code=503,
            detail=(
                "Payments not configured. On the server, set STRIPE_SECRET_KEY, "
                "STRIPE_WEBHOOK_SECRET, and STRIPE_PUBLIC_BASE_URL in .env.dev, then restart roryportfolio."
            ),
        )
    ready, db_err = _premium_db_ready(db)
    if not ready:
        raise HTTPException(
            status_code=500,
            detail=f"Premium database not ready: {db_err}. Run bash deploy/fix-referr-all-premium.sh on the server.",
        )
    post = db.get(T1ReferrallSeekerPost, body.seekerPostId)
    if post is None:
        raise HTTPException(status_code=404, detail="Seeker post not found")
    if post.author_id != user.id:
        raise HTTPException(status_code=403, detail="Not your post")
    try:
        price_cents = _premium_price_cents(db)
        purchase_num = _premium_purchase_count_30d(db) + 1
        stripe = stripe_service._stripe_client()  # noqa: SLF001
        session = stripe.checkout.Session.create(
            mode="payment",
            payment_method_types=["card"],
            line_items=[
                {
                    "quantity": 1,
                    "price_data": {
                        "currency": "usd",
                        "unit_amount": price_cents,
                        "product_data": {
                            "name": "Featured Post — 30 Days",
                            "description": (
                                "Your seeker post will be pinned near the top of the feed "
                                "with a Featured badge for 30 days."
                            ),
                        },
                    },
                }
            ],
            metadata={
                "product": "referr_all_premium",
                "seeker_post_id": body.seekerPostId,
                "purchase_number": str(purchase_num),
                "amount_cents": str(price_cents),
                "user_id": user.id,
            },
            success_url=body.successUrl,
            cancel_url=body.cancelUrl,
        )
    except ProgrammingError as exc:
        db.rollback()
        log.exception("Premium checkout DB error")
        raise HTTPException(
            status_code=500,
            detail="Database schema out of date — run bash deploy/migrate-t1referrall-v7.sh on the server",
        ) from exc
    except Exception as exc:
        log.exception("Premium checkout Stripe error")
        raise HTTPException(status_code=500, detail="Could not start checkout — try again shortly") from exc
    return {"url": session.url, "sessionId": session.id}


@router.post("/premium/confirm")
def premium_confirm(
    body: PremiumConfirmBody,
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    """Fallback when Stripe redirects back before/alongside the webhook."""
    if not stripe_service.stripe_enabled():
        raise HTTPException(status_code=503, detail="Payments not configured")
    stripe = stripe_service._stripe_client()  # noqa: SLF001
    try:
        session = stripe.checkout.Session.retrieve(body.sessionId)
    except Exception as exc:
        log.exception("Premium confirm: could not retrieve session %s", body.sessionId)
        raise HTTPException(status_code=400, detail="Invalid checkout session") from exc

    meta = _checkout_session_meta(session)
    owner_id = meta.get("user_id")
    if owner_id and owner_id != user.id:
        raise HTTPException(status_code=403, detail="Not your checkout session")

    if meta.get("product") not in ("referr_all_premium", "t1referrall_premium"):
        raise HTTPException(status_code=400, detail="Not a featured-post checkout session")
    if not _checkout_session_paid(session):
        raise HTTPException(status_code=400, detail="Payment not completed yet")

    result = _fulfill_premium_checkout(db, session)
    if result is None:
        raise HTTPException(status_code=400, detail="Could not activate featured status for this session")
    return result


@router.post("/premium/reconcile")
def premium_reconcile(
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    """Activate featured status for completed Stripe checkouts that were never fulfilled."""
    if not os.getenv("STRIPE_SECRET_KEY"):
        raise HTTPException(status_code=503, detail="Stripe not configured")
    ready, db_err = _premium_db_ready(db)
    if not ready:
        raise HTTPException(
            status_code=500,
            detail=f"Premium database not ready: {db_err}. Run bash deploy/fix-referr-all-premium.sh on the server.",
        )
    stripe = stripe_service._stripe_client()  # noqa: SLF001
    cutoff = int((datetime.utcnow() - timedelta(days=30)).timestamp())
    activated: list[dict[str, Any]] = []
    starting_after: str | None = None

    try:
        for _ in range(5):
            params: dict[str, Any] = {"limit": 100, "status": "complete"}
            if starting_after:
                params["starting_after"] = starting_after
            page = stripe.checkout.Session.list(**params)
            for session in page.data:
                if int(_checkout_session_field(session, "created") or 0) < cutoff:
                    continue
                meta = _checkout_session_meta(session)
                if meta.get("user_id") != user.id:
                    continue
                if meta.get("product") not in ("referr_all_premium", "t1referrall_premium"):
                    continue
                try:
                    result = _fulfill_premium_checkout(db, session)
                except HTTPException:
                    raise
                except Exception:
                    log.exception("Premium reconcile: fulfill failed for session")
                    continue
                if result and result.get("isPremium"):
                    activated.append(result)
            if not page.has_more:
                break
            starting_after = page.data[-1].id
    except HTTPException:
        raise
    except ProgrammingError as exc:
        db.rollback()
        log.exception("Premium reconcile DB error")
        raise HTTPException(
            status_code=500,
            detail="Database schema out of date — run bash deploy/migrate-t1referrall-v7.sh on the server",
        ) from exc
    except Exception as exc:
        log.exception("Premium reconcile Stripe error")
        raise HTTPException(status_code=500, detail="Could not sync payments — try again shortly") from exc

    return {"activated": len(activated), "results": activated}


def _premium_webhook_secret() -> str:
    return (
        os.getenv("REFERR_ALL_STRIPE_WEBHOOK_SECRET")
        or os.getenv("T1REFERRALL_STRIPE_WEBHOOK_SECRET")
        or os.getenv("STRIPE_WEBHOOK_SECRET")
        or ""
    )


@router.post("/premium/webhook")
async def premium_webhook(request: Request, db: Session = Depends(referrall_db)):
    secret = _premium_webhook_secret()
    if not secret or not os.getenv("STRIPE_SECRET_KEY"):
        raise HTTPException(status_code=503, detail="Payments not configured")
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    stripe = stripe_service._stripe_client()  # noqa: SLF001
    try:
        event = stripe.Webhook.construct_event(payload, sig, secret)
    except Exception:
        log.exception("Referr-All webhook signature failed")
        raise HTTPException(status_code=400, detail="Bad webhook signature")

    try:
        event_type = event["type"]
    except (KeyError, TypeError):
        return {"received": True}

    if event_type != "checkout.session.completed":
        return {"received": True}

    try:
        session = event["data"]["object"]
        session_id = _checkout_session_field(session, "id")
    except (KeyError, TypeError):
        log.exception("Referr-All webhook: malformed checkout.session.completed payload")
        raise HTTPException(status_code=400, detail="Malformed webhook payload")

    try:
        result = _fulfill_premium_checkout(db, session)
    except ProgrammingError:
        db.rollback()
        log.exception("Referr-All webhook: DB schema missing for session=%s", session_id)
        raise HTTPException(
            status_code=500,
            detail="Database schema missing — run bash deploy/fix-referr-all-premium.sh on the server",
        )
    except Exception:
        db.rollback()
        log.exception("Referr-All webhook fulfillment failed for session=%s", session_id)
        raise HTTPException(status_code=500, detail="Webhook processing failed")
    if result is None:
        return {"received": True}
    return {"received": True, **result}
