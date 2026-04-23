"""SQLAlchemy engine and session factory (PostgreSQL via psycopg 3)."""

from __future__ import annotations

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


def _normalize_database_url(url: str) -> str:
    """
    Accept common Postgres URLs and ensure SQLAlchemy uses the psycopg v3 driver.

    Neon / Render / Heroku-style `postgres://...` and plain `postgresql://...`
    become `postgresql+psycopg://...`.
    """
    u = url.strip()
    if u.startswith("postgresql+psycopg://") or u.startswith("postgresql+psycopg2://"):
        return u
    if u.startswith("postgres://"):
        return "postgresql+psycopg://" + u[len("postgres://") :]
    if u.startswith("postgresql://"):
        return "postgresql+psycopg://" + u[len("postgresql://") :]
    return u


def _database_url() -> str | None:
    url = os.getenv("DATABASE_URL", "").strip()
    return _normalize_database_url(url) if url else None


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
