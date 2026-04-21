"""SQLAlchemy engine and session factory."""

from __future__ import annotations

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


def _database_url() -> str | None:
    url = os.getenv("DATABASE_URL", "").strip()
    return url or None


DATABASE_URL = _database_url()
engine = (
    create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)
    if DATABASE_URL
    else None
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine) if engine else None


def get_db():
    if SessionLocal is None:
        raise RuntimeError("DATABASE_URL is not configured")
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
