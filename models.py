"""
SQLAlchemy ORM models (PostgreSQL).

Developer notes:
- Schema changes: update classes here; production DBs need migrations (Alembic or manual ALTER).
  ``create_all`` only creates missing tables — it does not alter existing columns.
- Classifieds: ClassifiedUser / ClassifiedSession / ClassifiedAd must stay aligned with
  classifieds_routes.py request bodies and JSON field names.
- API dashboard auth: ApiCredential (single row) + BrowserSession (cookie tokens).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class ApiCredential(Base):
    """Single active API identifier + bcrypt hash of the secret."""

    __tablename__ = "api_credential"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    public_key: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    secret_hash: Mapped[str] = mapped_column(String(255))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class BrowserSession(Base):
    """Opaque token for httpOnly cookie auth (no secrets stored in the browser)."""

    __tablename__ = "browser_session"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ClassifiedUser(Base):
    __tablename__ = "classified_user"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255))
    phone: Mapped[str] = mapped_column(String(64), default="")
    state: Mapped[str] = mapped_column(String(64))
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ClassifiedSession(Base):
    __tablename__ = "classified_session"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("classified_user.id", ondelete="CASCADE"), index=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class ClassifiedAd(Base):
    __tablename__ = "classified_ad"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("classified_user.id", ondelete="SET NULL"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(500))
    state: Mapped[str] = mapped_column(String(64), index=True)
    category: Mapped[str] = mapped_column(String(200))
    sub_category: Mapped[str] = mapped_column(String(200))
    price: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text())
    images: Mapped[list[Any]] = mapped_column(JSONB)
    author_username: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
