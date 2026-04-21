"""Database models."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String, func
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
