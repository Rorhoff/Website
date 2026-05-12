"""
Classifieds: users and ads persisted in PostgreSQL; Bearer session tokens for the SPA.

Developer notes:
- Requires DATABASE_URL (503 if missing). All routes use classifieds_db dependency.
- Auth: Authorization: Bearer <token> from /register or /login.
- JSON field names in responses use camelCase for ad fields (subCategory, createdAt) — keep static/classifieds in sync.
- To add fields: extend models.Classified*, Pydantic bodies here, and the frontend app.js if needed.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from passlib.hash import bcrypt as bcrypt_hasher
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

import credential_service
from credential_service import truncate_for_bcrypt
from database import SessionLocal
from models import ClassifiedAd, ClassifiedSession, ClassifiedUser

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


def _ad_out(row: ClassifiedAd) -> dict[str, Any]:
    created_ms = int(row.created_at.timestamp() * 1000)
    return {
        "id": row.id,
        "title": row.title,
        "state": row.state,
        "category": row.category,
        "subCategory": row.sub_category,
        "price": row.price,
        "description": row.description,
        "images": list(row.images) if row.images is not None else [],
        "author": row.author_username,
        "createdAt": created_ms,
    }


# --- Session token issuance ---


def _create_session(db: Session, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires = datetime.utcnow() + timedelta(hours=credential_service.SESSION_HOURS)
    db.add(ClassifiedSession(token=token, user_id=user_id, expires_at=expires))
    db.commit()
    return token


# --- Bearer token → ClassifiedUser (used as Depends(...) on protected routes) ---


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
    category: str = Field(min_length=1, max_length=200)
    subCategory: str = Field(min_length=1, max_length=200)
    price: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1, max_length=50_000)
    images: list[str] = Field(min_length=1, max_length=10)


# --- In-memory reset tokens: token -> (user_id, expires_at) ---
_reset_tokens: dict[str, tuple[int, datetime]] = {}
_RESET_TOKEN_TTL = timedelta(hours=1)


# --- Auth: register, login, logout, profile ---


@router.post("/register")
def classifieds_register(body: RegisterBody, db: Session = Depends(classifieds_db)):
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


# --- Ads: list (filtered by user state) and create ---


@router.get("/ads")
def classifieds_list_ads(
    user: ClassifiedUser = Depends(get_current_classified_user),
    db: Session = Depends(classifieds_db),
):
    state_key = user.state.strip().lower()
    rows = db.scalars(
        select(ClassifiedAd)
        .where(func.lower(ClassifiedAd.state) == state_key)
        .order_by(ClassifiedAd.created_at.desc())
    ).all()
    return [_ad_out(r) for r in rows]


@router.post("/ads")
def classifieds_create_ad(
    body: CreateAdBody,
    user: ClassifiedUser = Depends(get_current_classified_user),
    db: Session = Depends(classifieds_db),
):
    ad = ClassifiedAd(
        id=str(uuid.uuid4()),
        user_id=user.id,
        title=body.title.strip(),
        state=body.state.strip(),
        category=body.category.strip(),
        sub_category=body.subCategory.strip(),
        price=body.price.strip(),
        description=body.description.strip(),
        images=body.images,
        author_username=user.username,
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
