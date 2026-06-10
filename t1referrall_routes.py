"""
T1Referrall REST API — RDS + Bearer sessions (replaces Supabase client).

Mounted at /api/t1referrall on rorhoff.com (SERVICE_MODE=full). Requires DATABASE_URL.
"""

from __future__ import annotations

import logging
import os
import re
import secrets
import uuid
import base64
from datetime import datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Header, HTTPException, Request, UploadFile, status
from passlib.hash import bcrypt as bcrypt_hasher
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
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
    T1ReferrallUserBlock,
)

log = logging.getLogger("webapi-testing")

router = APIRouter(prefix="/api/t1referrall", tags=["t1referrall"])

BASE_PREMIUM_PRICE_CENTS = 999
PREMIUM_PRICE_INCREMENT_CENTS = 500
PREMIUM_PRICE_MAX_CENTS = 9999
PREMIUM_DURATION_DAYS = 30
BLOCK_SUSPEND_THRESHOLD = 10
MAX_AVATAR_BYTES = 4 * 1024 * 1024

_AVAILABILITY = frozenset({"immediately", "2weeks", "1month", "3months"})
_CONN_STATUS = frozenset({"pending", "accepted", "declined"})
_INLINE_AVATAR_MAX_BYTES = 512 * 1024

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
            detail="T1Referrall is USA-only. Use a US city/state (e.g. Austin, TX) or enable Open to Remote.",
        )


def _public_base() -> str:
    return os.getenv("T1REFERRALL_PUBLIC_URL", "https://rorhoff.com/t1-referrall").rstrip("/")


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.isoformat() + "Z" if dt.tzinfo is None else dt.isoformat()


def referrall_db() -> Any:
    if not credential_service.database_enabled() or SessionLocal is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="DATABASE_URL is not set; T1Referrall is unavailable.",
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
        "bio": user.bio or "",
        "company": user.company or "",
        "role": user.role or "",
        "location": user.location or "",
        "linkedin_url": user.linkedin_url or "",
        "years_experience": user.years_experience or 0,
        "skills": list(user.skills or []),
        "is_suspended": bool(user.is_suspended),
        "created_at": _iso(user.created_at),
        "updated_at": _iso(user.updated_at),
    }
    if include_email:
        out["email"] = user.email
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


def _create_session(db: Session, user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    expires = datetime.utcnow() + timedelta(hours=credential_service.SESSION_HOURS)
    db.add(T1ReferrallSession(token=token, user_id=user_id, expires_at=expires))
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
    user = db.get(T1ReferrallUser, row.user_id)
    if user is None:
        db.delete(row)
        db.commit()
        raise HTTPException(status_code=401, detail="User not found")
    if user.is_suspended:
        raise HTTPException(status_code=403, detail="Account suspended")
    return user


def _premium_price_cents(db: Session) -> int:
    month_ago = datetime.utcnow() - timedelta(days=30)
    count = db.scalar(
        select(func.count())
        .select_from(T1ReferrallPremiumPurchase)
        .where(T1ReferrallPremiumPurchase.created_at >= month_ago)
    )
    total = int(count or 0)
    price = BASE_PREMIUM_PRICE_CENTS + PREMIUM_PRICE_INCREMENT_CENTS * total
    return min(price, PREMIUM_PRICE_MAX_CENTS)


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


class ProfilePatchBody(BaseModel):
    fullName: str | None = Field(default=None, max_length=200)
    bio: str | None = Field(default=None, max_length=5000)
    company: str | None = Field(default=None, max_length=200)
    role: str | None = Field(default=None, max_length=200)
    location: str | None = Field(default=None, max_length=200)
    linkedinUrl: str | None = Field(default=None, max_length=500)
    yearsExperience: float | None = Field(default=None, ge=0, le=80)
    skills: list[str] | None = Field(default=None, max_length=50)
    avatarUrl: str | None = Field(default=None, max_length=500)


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


# --- Auth ---


@router.post("/register")
def register(body: RegisterBody, db: Session = Depends(referrall_db)):
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
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username or email already taken.")
    db.refresh(user)
    token = _create_session(db, user.id)
    return {"token": token, "profile": _profile_out(user, include_email=True)}


@router.post("/login")
def login(body: LoginBody, db: Session = Depends(referrall_db)):
    email = body.email.strip().lower()
    user = db.scalars(
        select(T1ReferrallUser).where(func.lower(T1ReferrallUser.email) == email)
    ).first()
    if user is None or not _verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    if user.is_suspended:
        raise HTTPException(status_code=403, detail="Account suspended")
    token = _create_session(db, user.id)
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
    return {
        "paymentsConfigured": stripe_service.stripe_enabled(),
        "imageStorageConfigured": image_storage.storage_enabled(),
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
        user.linkedin_url = body.linkedinUrl.strip()
    if body.yearsExperience is not None:
        user.years_experience = body.yearsExperience
    if body.skills is not None:
        user.skills = [s.strip() for s in body.skills if s.strip()][:50]
    if body.avatarUrl is not None:
        user.avatar_url = body.avatarUrl.strip()
    user.updated_at = datetime.utcnow()
    db.add(user)
    db.commit()
    db.refresh(user)
    return _profile_out(user, include_email=True)


# --- Profiles (network discovery) ---


@router.get("/profiles")
def list_profiles(
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    rows = db.scalars(
        select(T1ReferrallUser)
        .where(T1ReferrallUser.id != user.id, T1ReferrallUser.is_suspended.is_(False))
        .order_by(T1ReferrallUser.username)
    ).all()
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
    profiles = _load_profiles(db, author_ids)
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
        job_url=body.jobUrl.strip(),
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
    db.delete(row)
    db.commit()
    return {"ok": True}


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
    profiles = _load_profiles(db, author_ids)
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
    _require_usa_location(body.desiredLocation.strip(), open_to_remote=body.openToRemote)
    row = T1ReferrallSeekerPost(
        id=str(uuid.uuid4()),
        author_id=user.id,
        headline=body.headline.strip(),
        about=body.about.strip(),
        desired_role=body.desiredRole.strip(),
        desired_location=body.desiredLocation.strip(),
        open_to_remote=body.openToRemote,
        field_of_work=body.fieldOfWork.strip(),
        skills=[s.strip() for s in body.skills if s.strip()][:30],
        experience_years=body.experienceYears,
        resume_url=body.resumeUrl.strip(),
        portfolio_url=body.portfolioUrl.strip(),
        availability=avail,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _seeker_out(row, {user.id: _profile_out(user)})


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
    db.delete(row)
    db.commit()
    return {"ok": True}


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
    return [{"id": r.id, "blocked_id": r.blocked_id, "created_at": _iso(r.created_at)} for r in rows]


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
    if not image_storage.allowed_content_type(ct):
        raise HTTPException(status_code=400, detail="Unsupported image type")

    if image_storage.storage_enabled():
        ext_map = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}
        ext = ext_map.get(ct, "jpg")
        key = f"t1ref/{user.id}/avatar.{ext}"
        try:
            url = image_storage.upload_image_at_key(key, content, ct)
        except Exception:
            log.exception("Avatar upload failed for user=%s", user.id)
            raise HTTPException(status_code=500, detail="Upload failed")
    elif len(content) <= _INLINE_AVATAR_MAX_BYTES:
        b64 = base64.b64encode(content).decode("ascii")
        url = f"data:{ct};base64,{b64}"
    else:
        raise HTTPException(
            status_code=503,
            detail="Image storage not configured. Use a photo under 512 KB or set S3_* env vars on the server.",
        )

    user.avatar_url = url
    user.updated_at = datetime.utcnow()
    db.add(user)
    db.commit()
    return {"url": url}


# --- Premium / Stripe ---


@router.get("/premium/price")
def premium_price(
    user: T1ReferrallUser = Depends(get_current_referrall_user),
    db: Session = Depends(referrall_db),
):
    cents = _premium_price_cents(db)
    month_ago = datetime.utcnow() - timedelta(days=30)
    count = db.scalar(
        select(func.count())
        .select_from(T1ReferrallPremiumPurchase)
        .where(T1ReferrallPremiumPurchase.created_at >= month_ago)
    )
    return {
        "priceCents": cents,
        "purchaseNumber": int(count or 0) + 1,
        "durationDays": PREMIUM_DURATION_DAYS,
    }


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
    post = db.get(T1ReferrallSeekerPost, body.seekerPostId)
    if post is None:
        raise HTTPException(status_code=404, detail="Seeker post not found")
    if post.author_id != user.id:
        raise HTTPException(status_code=403, detail="Not your post")
    price_cents = _premium_price_cents(db)
    month_ago = datetime.utcnow() - timedelta(days=30)
    purchase_num = int(
        db.scalar(
            select(func.count())
            .select_from(T1ReferrallPremiumPurchase)
            .where(T1ReferrallPremiumPurchase.created_at >= month_ago)
        )
        or 0
    ) + 1
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
            "product": "t1referrall_premium",
            "seeker_post_id": body.seekerPostId,
            "purchase_number": str(purchase_num),
            "amount_cents": str(price_cents),
            "user_id": user.id,
        },
        success_url=body.successUrl,
        cancel_url=body.cancelUrl,
    )
    return {"url": session.url, "sessionId": session.id}


def _premium_webhook_secret() -> str:
    return (
        os.getenv("T1REFERRALL_STRIPE_WEBHOOK_SECRET")
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
        log.exception("T1Referrall webhook signature failed")
        raise HTTPException(status_code=400, detail="Bad webhook signature")

    if event["type"] != "checkout.session.completed":
        return {"received": True}

    session = event["data"]["object"]
    meta = session.get("metadata") or {}
    if meta.get("product") != "t1referrall_premium":
        return {"received": True}

    seeker_post_id = meta.get("seeker_post_id")
    if not seeker_post_id:
        return {"received": True}

    session_id = session.get("id")
    existing = db.scalars(
        select(T1ReferrallPremiumPurchase).where(
            T1ReferrallPremiumPurchase.stripe_session_id == session_id
        )
    ).first()
    if existing:
        return {"received": True, "duplicate": True}

    post = db.get(T1ReferrallSeekerPost, seeker_post_id)
    if post is None:
        log.warning("Premium webhook: missing seeker post %s", seeker_post_id)
        return {"received": True}

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

    purchase = T1ReferrallPremiumPurchase(
        id=str(uuid.uuid4()),
        user_id=post.author_id,
        seeker_post_id=seeker_post_id,
        amount_cents=int(meta.get("amount_cents") or session.get("amount_total") or 0),
        purchase_number=int(meta.get("purchase_number") or 0),
        stripe_session_id=session_id,
    )
    db.add(post)
    db.add(purchase)
    db.commit()
    return {"received": True, "seekerPostId": seeker_post_id}
