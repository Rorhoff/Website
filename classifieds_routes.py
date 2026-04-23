"""Classifieds: users and ads persisted in PostgreSQL; Bearer session tokens for the SPA."""

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
from database import SessionLocal
from models import ClassifiedAd, ClassifiedSession, ClassifiedUser

router = APIRouter(prefix="/api/classifieds", tags=["classifieds"])


def _hash_password(plain: str) -> str:
    return bcrypt_hasher.hash(plain)


def _verify_password(plain: str, password_hash: str) -> bool:
    try:
        return bcrypt_hasher.verify(plain, password_hash)
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


def _create_session(db: Session, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires = datetime.utcnow() + timedelta(hours=credential_service.SESSION_HOURS)
    db.add(ClassifiedSession(token=token, user_id=user_id, expires_at=expires))
    db.commit()
    return token


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


class RegisterBody(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    email: str = Field(min_length=3, max_length=255)
    phone: str = Field(default="", max_length=64)
    state: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=4, max_length=256)


class LoginBody(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


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
