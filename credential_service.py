"""
API credential lifecycle: memory (dev) or PostgreSQL + bcrypt (production).

Developer notes:
- Without DATABASE_URL: credentials live in process memory; set API_KEY and API_SECRET in .env to fix the pair
  (if API_SECRET is set, a random secret is not generated; if only API_SECRET is set, API key is generated).
- API secret is truncated to 72 UTF-8 bytes before bcrypt (bcrypt library limit).
- With DATABASE_URL: single ApiCredential row + BrowserSession table for httpOnly cookies.
- Session length: SESSION_HOURS; cookie name: COOKIE_NAME (keep in sync with main.py imports).
- Rotation wipes BrowserSession rows when using the database.
"""

from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, timedelta
from threading import Lock
from typing import Any

from passlib.hash import bcrypt as bcrypt_hasher
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from database import Base, SessionLocal, engine
from models import ApiCredential, BrowserSession

log = logging.getLogger("webapi-testing")

_cred_lock = Lock()

# Memory fallback (no DATABASE_URL)
_mem_key: str = ""
_mem_secret: str = ""

SESSION_HOURS = int(os.getenv("SESSION_HOURS", "8"))
COOKIE_NAME = "wapi_session"

# --- Secret generation & verification ---

BCRYPT_MAX_BYTES = 72


def truncate_for_bcrypt(plain: str) -> str:
    """Bcrypt uses at most the first 72 bytes of the password (UTF-8)."""
    data = plain.encode("utf-8")
    if len(data) <= BCRYPT_MAX_BYTES:
        return plain
    return data[:BCRYPT_MAX_BYTES].decode("utf-8", "ignore")


def _generate_pair() -> tuple[str, str]:
    return secrets.token_urlsafe(48), secrets.token_urlsafe(48)


def _api_pair_from_env_or_generate() -> tuple[str, str]:
    """Prefer API_KEY + API_SECRET from the environment; never replace a provided API_SECRET with a random one."""
    env_k = (os.getenv("API_KEY") or "").strip() or None
    env_s = (os.getenv("API_SECRET") or "").strip() or None
    if env_k and env_s:
        return env_k, env_s
    if env_s:
        return secrets.token_urlsafe(48), env_s
    if env_k:
        return env_k, secrets.token_urlsafe(48)
    return _generate_pair()


def _hash_secret(plain: str) -> str:
    return bcrypt_hasher.hash(truncate_for_bcrypt(plain))


def _verify_secret(plain: str, secret_hash: str) -> bool:
    try:
        return bcrypt_hasher.verify(truncate_for_bcrypt(plain), secret_hash)
    except ValueError:
        return False


def database_enabled() -> bool:
    return engine is not None


def create_tables() -> None:
    if engine is None:
        return
    Base.metadata.create_all(bind=engine)


# --- Bootstrap: first-run credential row or memory pair ---


def init_credentials() -> dict[str, str] | None:
    """
    Initialize credential store. Returns {"api_key", "api_secret"} once when newly created
    (for logging), else None.
    """
    global _mem_key, _mem_secret
    if not database_enabled():
        _mem_key, _mem_secret = _api_pair_from_env_or_generate()
        # No startup handoff to logs when the full pair is provided via environment
        if (os.getenv("API_KEY") or "").strip() and (os.getenv("API_SECRET") or "").strip():
            return None
        return {"api_key": _mem_key, "api_secret": _mem_secret}

    if SessionLocal is None:
        return None
    db = SessionLocal()
    try:
        row = db.scalars(select(ApiCredential).limit(1)).first()
        if row is not None:
            return None
        pub, sec = _api_pair_from_env_or_generate()
        row = ApiCredential(public_key=pub, secret_hash=_hash_secret(sec))
        db.add(row)
        db.commit()
        return {"api_key": pub, "api_secret": sec}
    finally:
        db.close()


# --- Header verification (Postman / programmatic clients) ---


def _get_credential_row(db: Session) -> ApiCredential | None:
    return db.scalars(select(ApiCredential).limit(1)).first()


def verify_headers(api_key: str | None, api_secret: str | None) -> bool:
    if not api_key or not api_secret:
        return False
    if not database_enabled():
        with _cred_lock:
            try:
                return secrets.compare_digest(
                    api_key.encode("utf-8"), _mem_key.encode("utf-8")
                ) and secrets.compare_digest(
                    api_secret.encode("utf-8"), _mem_secret.encode("utf-8")
                )
            except ValueError:
                return False

    db = SessionLocal()
    try:
        row = _get_credential_row(db)
        if row is None:
            return False
        try:
            if not secrets.compare_digest(
                api_key.encode("utf-8"), row.public_key.encode("utf-8")
            ):
                return False
        except ValueError:
            return False
        return _verify_secret(api_secret, row.secret_hash)
    finally:
        db.close()


# --- Credential rotation (invalidates browser sessions in DB mode) ---


def rotate_credentials() -> dict[str, str]:
    """Invalidate current pair and browser sessions; return new api_key and api_secret (plaintext once)."""
    global _mem_key, _mem_secret
    new_k, new_s = _generate_pair()
    if not database_enabled():
        with _cred_lock:
            _mem_key, _mem_secret = new_k, new_s
        return {"api_key": new_k, "api_secret": new_s}

    db = SessionLocal()
    try:
        db.execute(delete(BrowserSession))
        row = _get_credential_row(db)
        if row is None:
            row = ApiCredential(public_key=new_k, secret_hash=_hash_secret(new_s))
            db.add(row)
        else:
            row.public_key = new_k
            row.secret_hash = _hash_secret(new_s)
        db.commit()
        return {"api_key": new_k, "api_secret": new_s}
    finally:
        db.close()


# --- httpOnly cookie sessions (dashboard) ---


def create_browser_session() -> tuple[str, datetime]:
    token = secrets.token_urlsafe(32)
    expires = datetime.utcnow() + timedelta(hours=SESSION_HOURS)
    if SessionLocal is None:
        raise RuntimeError("Session store unavailable")
    db = SessionLocal()
    try:
        db.add(BrowserSession(token=token, expires_at=expires))
        db.commit()
        return token, expires
    finally:
        db.close()


def delete_session_token(token: str | None) -> None:
    if not token or SessionLocal is None:
        return
    db = SessionLocal()
    try:
        row = db.get(BrowserSession, token)
        if row:
            db.delete(row)
            db.commit()
    finally:
        db.close()


def verify_session_token(token: str | None) -> bool:
    if not token or SessionLocal is None:
        return False
    db = SessionLocal()
    try:
        row = db.get(BrowserSession, token)
        if row is None:
            return False
        if row.expires_at < datetime.utcnow():
            db.delete(row)
            db.commit()
            return False
        return True
    finally:
        db.close()


# --- Session cleanup ---


def purge_expired_sessions() -> None:
    if SessionLocal is None:
        return
    db = SessionLocal()
    try:
        db.execute(
            delete(BrowserSession).where(BrowserSession.expires_at < datetime.utcnow())
        )
        db.commit()
    finally:
        db.close()
