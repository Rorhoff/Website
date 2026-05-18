"""
Classifieds: users and ads persisted in PostgreSQL; Bearer session tokens for the SPA.

Developer notes:
- Requires DATABASE_URL (503 if missing). All routes use classifieds_db dependency.
- Auth: Authorization: Bearer <token> from /register or /login.
- JSON field names in responses use camelCase for ad fields (subCategory, createdAt) — keep static/classifieds in sync.
- To add fields: extend models.Classified*, Pydantic bodies here, and the frontend app.js if needed.
- Image uploads: POST /api/classifieds/uploads stores bytes in S3/R2 (see image_storage.py)
  and returns a URL the frontend then sends in the ads payload. Existing base64 data URLs
  in the images column keep rendering — the column accepts both shapes for backward compat.
"""

from __future__ import annotations

import hashlib
import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Header, HTTPException, Request, UploadFile, status
from passlib.hash import bcrypt as bcrypt_hasher
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import credential_service
import image_storage
import stripe_service
from credential_service import truncate_for_bcrypt
from database import SessionLocal
from models import (
    ClassifiedAd,
    ClassifiedAdReport,
    ClassifiedBlockedSignature,
    ClassifiedSession,
    ClassifiedUser,
)

# How many distinct logged-in users have to report a single ad before it is
# auto-removed and a signature ban is recorded against the seller. Tuned low
# enough to act as a deterrent, high enough that one disgruntled buyer + a few
# friends can't trivially knock a legit ad offline.
REPORT_AUTO_REMOVE_THRESHOLD = 5

log = logging.getLogger("webapi-testing")

MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024  # 8 MiB per image

router = APIRouter(prefix="/api/classifieds", tags=["classifieds"])

# --- Password hashing & DB session dependency ---


def _hash_password(plain: str) -> str:
    return bcrypt_hasher.hash(truncate_for_bcrypt(plain))


def _verify_password(plain: str, password_hash: str) -> bool:
    try:
        return bcrypt_hasher.verify(truncate_for_bcrypt(plain), password_hash)
    except ValueError:
        return False


def classifieds_db() -> Any:
    if not credential_service.database_enabled() or SessionLocal is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="DATABASE_URL is not set; classifieds persistence is unavailable.",
        )
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _user_out(user: ClassifiedUser) -> dict[str, Any]:
    return {
        "username": user.username,
        "email": user.email,
        "phone": user.phone or "",
        "state": user.state,
    }


_PRICE_LEADING_DOLLAR = re.compile(r"^\s*\$\s*")
_PRICE_TRAILING_DOLLAR = re.compile(r"\s*\$\s*$")


def _normalize_price(raw: str | None) -> str:
    """Canonicalize a user-submitted price to ``$<value>``.

    The form lets users type free text so they can express ranges (``$100-150``),
    OBOs (``$50 OBO``), and so on. We only normalize the position of the dollar
    sign — everything else is left alone:

    - ``"100"``     -> ``"$100"``
    - ``"$100"``    -> ``"$100"``
    - ``"100$"``    -> ``"$100"``
    - ``"  100 $"`` -> ``"$100"``
    - ``"Free"``    -> ``"Free"``  (no digits => not a price; preserve verbatim)
    - ``""``        -> ``""``
    """
    if raw is None:
        return ""
    s = raw.strip()
    if not s:
        return ""
    s = _PRICE_LEADING_DOLLAR.sub("", s)
    s = _PRICE_TRAILING_DOLLAR.sub("", s)
    s = s.strip()
    if not s:
        return ""
    # Pure-text values like "Free" / "TBD" / "Negotiable" don't get a $ glued to
    # them — that would read as "$Free" which nobody wants.
    return f"${s}" if any(c.isdigit() for c in s) else s


def _ad_out(row: ClassifiedAd) -> dict[str, Any]:
    created_ms = int(row.created_at.timestamp() * 1000)
    # goldUntil is an epoch-ms timestamp when active, or None when never boosted / expired.
    # The frontend treats anything > Date.now() as "currently gold" — no need to filter
    # expired golds out of the response, just let the client decide on render.
    gold_until_ms: int | None = None
    if row.gold_until is not None:
        gold_until_ms = int(row.gold_until.timestamp() * 1000)
    # Seller name. New ads always have a non-empty contact_name (API enforces
    # it) and the prod-v1.13 deploy backfills legacy rows. The `or ""`
    # below is a belt-and-suspenders guard for the (unexpected) case of a
    # NULL slipping through after migration — we'd rather render nothing than
    # leak the login username, per the prod-v1.13 product requirement.
    display_name = (row.contact_name or "").strip() if hasattr(row, "contact_name") else ""
    city_value = (row.city or "").strip() if hasattr(row, "city") else ""
    return {
        "id": row.id,
        "title": row.title,
        "state": row.state,
        "city": city_value,
        "category": row.category,
        "subCategory": row.sub_category,
        # Normalized on the way out too so legacy rows saved before _normalize_price
        # existed still render canonically without a one-off DB migration.
        "price": _normalize_price(row.price),
        "description": row.description,
        "images": list(row.images) if row.images is not None else [],
        "author": display_name,
        "createdAt": created_ms,
        "goldUntil": gold_until_ms,
    }


# --- Session token issuance ---


def _create_session(db: Session, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires = datetime.utcnow() + timedelta(hours=credential_service.SESSION_HOURS)
    db.add(ClassifiedSession(token=token, user_id=user_id, expires_at=expires))
    db.commit()
    return token


# --- Bearer token → ClassifiedUser (used as Depends(...) on protected routes) ---


def get_current_classified_user_optional(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(classifieds_db),
) -> ClassifiedUser | None:
    """Resolve the bearer token to a user *if* one is present and valid.

    Returns ``None`` for missing / malformed / expired tokens instead of
    raising 401. Used by routes that need to differentiate logged-in vs
    anonymous viewers — e.g. the shared-ad detail endpoint, which is
    publicly viewable but hides PII from non-logged-in callers.
    """
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization[7:].strip()
    if not token:
        return None
    row = db.get(ClassifiedSession, token)
    if row is None:
        return None
    if row.expires_at < datetime.utcnow():
        db.delete(row)
        db.commit()
        return None
    return db.get(ClassifiedUser, row.user_id)


def get_current_classified_user(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(classifieds_db),
) -> ClassifiedUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    row = db.get(ClassifiedSession, token)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session",
        )
    if row.expires_at < datetime.utcnow():
        db.delete(row)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired",
        )
    user = db.get(ClassifiedUser, row.user_id)
    if user is None:
        db.delete(row)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    return user


# --- Request bodies (validate user input / API contract) ---


class RegisterBody(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    email: str = Field(min_length=3, max_length=255)
    phone: str = Field(default="", max_length=64)
    state: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=4, max_length=256)
    # Must be True — the frontend checkbox is `required`, and we re-enforce
    # server-side so a curl/Postman call can't bypass acceptance.
    tosAccepted: bool = Field(default=False)


class LoginBody(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class ResetRequestBody(BaseModel):
    email: str = Field(min_length=3, max_length=255)


class ResetConfirmBody(BaseModel):
    token: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=4, max_length=256)


class ProfilePatchBody(BaseModel):
    state: str | None = Field(default=None, min_length=1, max_length=64)
    email: str | None = Field(default=None, min_length=3, max_length=255)
    phone: str | None = Field(default=None, max_length=64)


class CreateAdBody(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    state: str = Field(min_length=1, max_length=64)
    city: str = Field(min_length=1, max_length=120)
    category: str = Field(min_length=1, max_length=200)
    subCategory: str = Field(min_length=1, max_length=200)
    price: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1, max_length=50_000)
    images: list[str] = Field(min_length=1, max_length=10)
    # Required public-facing seller name shown in the detail modal. We do
    # NOT silently fall back to the login username — if a poster leaves
    # this blank we'd rather reject the request and prompt them, so a
    # username like "throwaway_42" never accidentally becomes the buyer's
    # only contact point.
    contactName: str = Field(min_length=1, max_length=120)


# --- In-memory reset tokens: token -> (user_id, expires_at) ---
_reset_tokens: dict[str, tuple[int, datetime]] = {}
_RESET_TOKEN_TTL = timedelta(hours=1)


# --- Auth: register, login, logout, profile ---


@router.post("/register")
def classifieds_register(body: RegisterBody, db: Session = Depends(classifieds_db)):
    if not body.tosAccepted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You must accept the Terms of Service and Privacy Policy to register.",
        )
    username = body.username.strip().lower()
    exists = db.scalars(
        select(ClassifiedUser).where(ClassifiedUser.username == username)
    ).first()
    if exists is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username is already taken.",
        )
    user = ClassifiedUser(
        username=username,
        email=body.email.strip(),
        phone=(body.phone or "").strip(),
        state=body.state.strip(),
        password_hash=_hash_password(body.password),
        # UTC so we never have to reason about DST when reading audit logs.
        tos_accepted_at=datetime.utcnow(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = _create_session(db, user.id)
    return {"token": token, "user": _user_out(user)}


@router.post("/login")
def classifieds_login(body: LoginBody, db: Session = Depends(classifieds_db)):
    username = body.username.strip().lower()
    user = db.scalars(
        select(ClassifiedUser).where(ClassifiedUser.username == username)
    ).first()
    if user is None or not _verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )
    token = _create_session(db, user.id)
    return {"token": token, "user": _user_out(user)}


@router.post("/logout")
def classifieds_logout(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(classifieds_db),
):
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:].strip()
        if token:
            db.execute(delete(ClassifiedSession).where(ClassifiedSession.token == token))
            db.commit()
    return {"ok": True}


@router.post("/reset-request")
def classifieds_reset_request(body: ResetRequestBody, db: Session = Depends(classifieds_db)):
    user = db.scalars(
        select(ClassifiedUser).where(
            func.lower(ClassifiedUser.email) == body.email.strip().lower()
        )
    ).first()
    if user is None:
        return {"ok": True}  # don't reveal whether the email exists
    token = secrets.token_urlsafe(32)
    _reset_tokens[token] = (user.id, datetime.utcnow() + _RESET_TOKEN_TTL)
    reset_url = f"/classifieds/reset.html?token={token}"
    return {"ok": True, "reset_url": reset_url}


@router.post("/reset-confirm")
def classifieds_reset_confirm(body: ResetConfirmBody, db: Session = Depends(classifieds_db)):
    entry = _reset_tokens.get(body.token)
    if entry is None or datetime.utcnow() > entry[1]:
        _reset_tokens.pop(body.token, None)
        raise HTTPException(status_code=400, detail="Invalid or expired reset token.")
    user_id, _ = entry
    user = db.get(ClassifiedUser, user_id)
    if user is None:
        raise HTTPException(status_code=400, detail="User not found.")
    user.password_hash = _hash_password(body.password)
    db.add(user)
    db.commit()
    del _reset_tokens[body.token]
    return {"ok": True}


@router.get("/me")
def classifieds_me(user: ClassifiedUser = Depends(get_current_classified_user)):
    return _user_out(user)


@router.patch("/me")
def classifieds_patch_me(
    body: ProfilePatchBody,
    user: ClassifiedUser = Depends(get_current_classified_user),
    db: Session = Depends(classifieds_db),
):
    if body.state is None and body.email is None and body.phone is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update.",
        )
    if body.state is not None:
        user.state = body.state.strip()
    if body.email is not None:
        user.email = body.email.strip()
    if body.phone is not None:
        user.phone = body.phone.strip()
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_out(user)


# --- Image uploads (S3 / R2). Returns a public URL the client puts in images[]. ---


@router.post("/uploads")
async def classifieds_upload_image(
    file: UploadFile = File(...),
    user: ClassifiedUser = Depends(get_current_classified_user),
):
    """Upload one image. Returns {url: ...}. Frontend uploads N times, then POSTs the ad
    with the resulting URLs. Falls back gracefully (503) when storage is not configured —
    the SPA detects that and uses inline data URLs instead so dev keeps working."""
    if not image_storage.storage_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Image storage is not configured on this environment.",
        )
    if not image_storage.allowed_content_type(file.content_type):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type: {file.content_type or 'unknown'}.",
        )
    # Read one byte past the limit so we can reject without buffering huge files.
    content = await file.read(MAX_IMAGE_UPLOAD_BYTES + 1)
    if len(content) > MAX_IMAGE_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Image exceeds the {MAX_IMAGE_UPLOAD_BYTES // (1024 * 1024)} MB limit.",
        )
    try:
        url = image_storage.upload_image(user.id, content, file.content_type or "")
    except Exception:
        log.exception("Image upload failed for user_id=%s", user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Image upload failed.",
        )
    return {"url": url}


# --- Gold-frame paywall (Stripe Checkout, surge pricing). See stripe_service.py. ---


@router.get("/gold/config")
def classifieds_gold_config():
    """Frontend reads this on load to decide whether to show the 'Boost to Gold' button.
    Publishable key is safe to expose (it's designed to be embedded in browsers)."""
    return {
        "enabled": stripe_service.stripe_enabled(),
        "publishableKey": stripe_service.publishable_key(),
        "tiers": [
            {"id": tid, "label": label, "days": days, "basePriceUsd": base}
            for (tid, label, days, base) in stripe_service.GOLD_TIERS
        ],
    }


@router.get("/gold/quote/{ad_id}")
def classifieds_gold_quote(
    ad_id: str,
    user: ClassifiedUser = Depends(get_current_classified_user),
    db: Session = Depends(classifieds_db),
):
    """Live quote for boosting `ad_id` at each tier. Surge multiplier is recomputed every
    call — clients display the current numbers, then post to /gold/checkout to lock them in
    (the checkout endpoint recomputes server-side; client values are not trusted)."""
    ad = db.get(ClassifiedAd, ad_id)
    if ad is None:
        raise HTTPException(status_code=404, detail="Ad not found")
    if ad.user_id != user.id:
        raise HTTPException(status_code=403, detail="You can only boost your own ads")
    tiers = []
    for (tier_id, _label, _days, _base) in stripe_service.GOLD_TIERS:
        q = stripe_service.quote_gold(db, ad, tier_id)
        tiers.append(
            {
                "tierId": q.tier_id,
                "label": q.label,
                "days": q.days,
                "basePriceUsd": q.base_price_usd,
                "multiplier": q.multiplier,
                "priceUsdCents": q.price_usd_cents,
                "priceUsd": round(q.price_usd, 2),
                "activeInBucket": q.active_in_bucket,
            }
        )
    return {
        "adId": ad.id,
        "state": ad.state,
        "category": ad.category,
        "tiers": tiers,
    }


class GoldCheckoutBody(BaseModel):
    adId: str = Field(min_length=1, max_length=64)
    tierId: str = Field(min_length=1, max_length=16)


@router.post("/gold/checkout")
def classifieds_gold_checkout(
    body: GoldCheckoutBody,
    user: ClassifiedUser = Depends(get_current_classified_user),
    db: Session = Depends(classifieds_db),
):
    """Create a Stripe Checkout session for boosting an ad. Returns {url} the SPA
    redirects to. Stripe holds the cardholder; we only get the verified result via the
    webhook (so a tampered return-URL can't grant gold)."""
    if not stripe_service.stripe_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Payments are not configured on this environment.",
        )
    if stripe_service.tier_info(body.tierId) is None:
        raise HTTPException(status_code=400, detail=f"Unknown tier: {body.tierId}")
    ad = db.get(ClassifiedAd, body.adId)
    if ad is None:
        raise HTTPException(status_code=404, detail="Ad not found")
    if ad.user_id != user.id:
        raise HTTPException(status_code=403, detail="You can only boost your own ads")
    try:
        _session_id, url = stripe_service.create_checkout_session(
            db, ad, body.tierId, user.id
        )
    except Exception:
        log.exception("Stripe checkout creation failed for ad=%s tier=%s", body.adId, body.tierId)
        raise HTTPException(status_code=500, detail="Could not start checkout.")
    return {"url": url}


@router.post("/gold/webhook")
async def classifieds_gold_webhook(
    request: Request,
    db: Session = Depends(classifieds_db),
):
    """Stripe → us. Signature-verified; activates gold on confirmed payment. No auth — the
    webhook secret is the credential. Stripe expects a 2xx within ~20s or it retries."""
    if not stripe_service.stripe_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Payments are not configured on this environment.",
        )
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")
    try:
        event = stripe_service.verify_webhook(payload, sig_header)
    except Exception:
        log.exception("Stripe webhook signature verification failed")
        raise HTTPException(status_code=400, detail="Bad webhook signature")
    # Avoid event.get(...) — Stripe's StripeObject treats `.get` as a dict-key lookup,
    # not a method (would raise AttributeError). Use bracket access via try/except instead.
    try:
        event_id = event["id"]
    except (KeyError, TypeError):
        event_id = "<unknown>"
    try:
        ad_id = stripe_service.apply_completed_checkout(db, event)
    except Exception:
        # 500 makes Stripe retry. Don't swallow — gold activation is the whole point.
        log.exception("Stripe webhook application failed for event=%s", event_id)
        raise HTTPException(status_code=500, detail="Webhook processing failed.")
    return {"ok": True, "adId": ad_id}


# --- Ads: list (filtered by user state) and create ---


@router.get("/ads")
def classifieds_list_ads(
    user: ClassifiedUser = Depends(get_current_classified_user),
    db: Session = Depends(classifieds_db),
):
    state_key = user.state.strip().lower()
    now = datetime.utcnow()
    # Sort active gold ads to the top within the buyer's state (any category): a gold ad
    # is "active" when gold_until > now. Among golds, the freshest expiry wins (so a 14-day
    # boost stays above a 3-day boost purchased earlier). Non-gold ads fall through to
    # newest-first.
    is_active_gold = (ClassifiedAd.gold_until.is_not(None)) & (ClassifiedAd.gold_until > now)
    rows = db.scalars(
        select(ClassifiedAd)
        .where(func.lower(ClassifiedAd.state) == state_key)
        .order_by(
            is_active_gold.desc(),
            ClassifiedAd.gold_until.desc().nullslast(),
            ClassifiedAd.created_at.desc(),
        )
    ).all()
    return [_ad_out(r) for r in rows]


def _ad_signature(title: str, description: str) -> str:
    """Stable SHA-256 fingerprint of an ad's textual content.

    Whitespace is collapsed and case-folded before hashing so trivial edits
    (extra spaces, capitalization changes) don't bypass the auto-removed
    repost block. Image content is intentionally *not* hashed — a seller who
    swaps photos but keeps the same title/description is still re-listing
    the same removed ad.
    """
    canonical = re.sub(r"\s+", " ", f"{title}\n{description}").strip().lower()
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


@router.post("/ads")
def classifieds_create_ad(
    body: CreateAdBody,
    user: ClassifiedUser = Depends(get_current_classified_user),
    db: Session = Depends(classifieds_db),
):
    title = body.title.strip()
    description = body.description.strip()
    # Repost block: if this seller has had an ad with the same title+description
    # auto-removed via the report system, refuse to recreate it. Other sellers
    # are unaffected — the block is scoped to (user_id, signature).
    signature = _ad_signature(title, description)
    blocked = db.scalar(
        select(ClassifiedBlockedSignature).where(
            ClassifiedBlockedSignature.user_id == user.id,
            ClassifiedBlockedSignature.signature == signature,
        )
    )
    if blocked is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This listing was previously removed after multiple user reports "
                "and cannot be re-posted. Please contact support if you believe "
                "this is an error."
            ),
        )

    # contactName & city are required by the schema, but the schema only
    # enforces min_length=1 on the raw value — strip whitespace here so
    # something like "   " gets rejected with a 400 instead of being saved
    # as effectively-empty.
    contact_name = (body.contactName or "").strip()
    if not contact_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Display name is required.",
        )
    city_value = (body.city or "").strip()
    if not city_value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="City is required.",
        )
    ad = ClassifiedAd(
        id=str(uuid.uuid4()),
        user_id=user.id,
        title=title,
        state=body.state.strip(),
        city=city_value,
        category=body.category.strip(),
        sub_category=body.subCategory.strip(),
        price=_normalize_price(body.price),
        description=description,
        images=body.images,
        author_username=user.username,
        contact_name=contact_name,
    )
    db.add(ad)
    db.commit()
    db.refresh(ad)
    return _ad_out(ad)


@router.get("/me/ads")
def classifieds_list_my_ads(
    user: ClassifiedUser = Depends(get_current_classified_user),
    db: Session = Depends(classifieds_db),
):
    """Return every ad owned by the currently authenticated user (regardless of state)."""
    rows = db.scalars(
        select(ClassifiedAd)
        .where(ClassifiedAd.user_id == user.id)
        .order_by(ClassifiedAd.created_at.desc())
    ).all()
    return [_ad_out(r) for r in rows]


@router.get("/ads/{ad_id}")
def classifieds_get_ad(
    ad_id: str,
    user: ClassifiedUser | None = Depends(get_current_classified_user_optional),
    db: Session = Depends(classifieds_db),
):
    """Single-ad detail view — accessible to anyone with the share URL.

    Logged-in viewers receive the seller's phone number; anonymous viewers
    see only the public ad payload. This lets sellers share an ad with
    friends/family who don't yet have an account, while still preventing
    drive-by scrapers from harvesting seller PII via direct ad IDs. The
    browse list endpoint (``GET /ads``) remains auth-gated, so anonymous
    visitors can only see ads they were explicitly linked to.

    Seller email is intentionally **not** included in the response, even
    for authenticated viewers — buyers contact sellers via phone, which is
    a required field at registration. Keeping email server-side reduces
    the PII footprint exposed by the SPA.

    If the seller's account was deleted (``user_id`` is NULL), contact
    fields come back empty so the buyer just sees the listing without a
    way to contact a defunct seller.
    """
    ad = db.get(ClassifiedAd, ad_id)
    if ad is None:
        raise HTTPException(status_code=404, detail="Ad not found")
    payload = _ad_out(ad)
    payload["viewerAuthenticated"] = user is not None
    if user is not None:
        # Seller contact pulled live so a profile change shows up immediately
        # on the next view.
        seller = db.get(ClassifiedUser, ad.user_id) if ad.user_id is not None else None
        payload["authorPhone"] = (seller.phone or "") if seller else ""
    return payload


@router.delete("/ads/{ad_id}")
def classifieds_delete_my_ad(
    ad_id: str,
    user: ClassifiedUser = Depends(get_current_classified_user),
    db: Session = Depends(classifieds_db),
):
    """Delete an ad you own. Returns 404 for non-existent ads, 403 for someone else's."""
    ad = db.get(ClassifiedAd, ad_id)
    if ad is None:
        raise HTTPException(status_code=404, detail="Ad not found")
    if ad.user_id != user.id:
        raise HTTPException(status_code=403, detail="You can only delete your own ads")
    db.delete(ad)
    db.commit()
    return {"ok": True, "id": ad_id}


@router.post("/ads/{ad_id}/report")
def classifieds_report_ad(
    ad_id: str,
    user: ClassifiedUser = Depends(get_current_classified_user),
    db: Session = Depends(classifieds_db),
):
    """Flag an ad as spam/scam/inappropriate.

    Rules:

    - Reporting requires a logged-in account so anonymous spammers cannot
      mass-flag legit listings.
    - A user can only report a given ad once; subsequent reports are
      treated as idempotent successes (we don't tell the caller they had
      already reported it, just acknowledge).
    - Sellers can't report their own ads.
    - Once the number of distinct reporters reaches
      ``REPORT_AUTO_REMOVE_THRESHOLD``, the ad is deleted and its
      title+description signature is recorded against the seller so the
      same content cannot be re-posted by them.

    The response is intentionally vague — buyers don't get told whether the
    ad already had a high report count, just that their report was logged.
    """
    ad = db.get(ClassifiedAd, ad_id)
    if ad is None:
        raise HTTPException(status_code=404, detail="Ad not found")
    if ad.user_id == user.id:
        raise HTTPException(status_code=400, detail="You cannot report your own ad")

    # Insert the report idempotently (relies on the (ad_id, reporter_user_id)
    # unique index). Catching IntegrityError lets us treat duplicate reports
    # as a no-op while still using the constraint as the source of truth.
    report = ClassifiedAdReport(ad_id=ad_id, reporter_user_id=user.id)
    db.add(report)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return {"ok": True, "alreadyReported": True}

    report_count = db.scalar(
        select(func.count())
        .select_from(ClassifiedAdReport)
        .where(ClassifiedAdReport.ad_id == ad_id)
    ) or 0

    if report_count >= REPORT_AUTO_REMOVE_THRESHOLD:
        # Snapshot what we need before deletion since the ad row goes away.
        seller_id = ad.user_id
        signature = _ad_signature(ad.title, ad.description)
        # Best-effort: only record the block if we still know who posted the
        # ad. An orphaned ad (user_id NULL because the seller deleted their
        # account) gets removed but nothing is blocklisted — there's no
        # account left to block anyway.
        if seller_id is not None:
            try:
                db.add(
                    ClassifiedBlockedSignature(
                        user_id=seller_id,
                        signature=signature,
                        original_ad_id=ad_id,
                    )
                )
                db.flush()
            except IntegrityError:
                # Already blocklisted (e.g. seller had previously re-listed
                # the same content under a different ad_id and that one was
                # also reported). Roll back the duplicate insert but keep
                # going so the ad still gets removed.
                db.rollback()
        log.info(
            "auto-removing ad %s after %d reports (seller=%s)",
            ad_id,
            report_count,
            seller_id,
        )
        db.delete(ad)
        db.commit()
        return {"ok": True, "removed": True}

    return {"ok": True, "removed": False}
