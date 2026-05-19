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

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
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
    # Paper trail for Terms of Service / Privacy Policy acceptance. Nullable so
    # accounts that existed before the checkbox was added don't need a backfill —
    # they're treated as "accepted at registration time" implicitly. New
    # registrations always set this at signup.
    tos_accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


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
    # Required public-facing seller name chosen at ad-creation time. Legacy
    # rows (created before prod-v1.12) get backfilled with the user's
    # username via a one-time UPDATE in the prod-v1.13 deploy notes — after
    # that the application layer requires this field on every new ad, so
    # there is no runtime "fall back to username" path.
    contact_name: Mapped[str | None] = mapped_column(String(120), nullable=True, default=None)
    # City picked at ad-creation time (or freely typed when the user chose
    # "Other..." in the dropdown). Used in the detail modal's location row
    # and in the per-ad SEO title/description so search engines see
    # "Honda Civic in Salt Lake City, Utah" rather than just the state.
    # Nullable so the column can be added to existing rows without a
    # blocking backfill — new ads always provide it via the API.
    city: Mapped[str | None] = mapped_column(String(120), nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    # Gold-frame paywall. gold_until is the UTC expiry timestamp (or NULL if never boosted /
    # expired). The composite index lets _surge_count() in stripe_service.py compute "how
    # many gold ads are active in this state+category right now" in a single seek.
    gold_until: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, default=None
    )
    # Last successful Stripe Checkout session that activated this ad's gold. Stored for
    # idempotency (a replayed webhook is a no-op) and audit. Not unique on its own because
    # an ad may be boosted multiple times over its lifetime; the latest one wins.
    stripe_session_id: Mapped[str | None] = mapped_column(
        String(200), nullable=True, default=None
    )
    # Last gold Checkout payment snapshot (updated every successful webhook). Used to
    # compute prorated card refunds when the listing is removed early (seller delete or
    # report auto-remove). Tracks the purchased time window for *that payment* only.
    last_gold_payment_intent_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, default=None
    )
    last_gold_payment_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_gold_window_start: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, default=None
    )
    last_gold_window_end: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, default=None
    )
    # Aggregated listings (e.g. Craigslist import). ``user`` = native seller post.
    listing_source: Mapped[str] = mapped_column(
        String(32), default="user", server_default="user", index=True
    )
    source_listing_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source_last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, default=None
    )
    imported_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, default=None
    )

    __table_args__ = (
        Index("ix_classified_ad_state_gold", "state", "gold_until"),
        Index(
            "uq_classified_ad_source_listing",
            "listing_source",
            "source_listing_id",
            unique=True,
            postgresql_where=(source_listing_id.isnot(None)),
        ),
    )


class ClassifiedAdReport(Base):
    """A single user's report against an ad.

    The unique constraint on (ad_id, reporter_user_id) means each user can
    report any given ad at most once — the counting logic in the report
    route just runs ``SELECT count(*) FROM classified_ad_report WHERE ad_id = ?``
    to decide when to auto-remove the listing.

    Reports are kept on disk even after the ad is removed so we have an audit
    trail of who flagged what. They're not exposed in any UI today.
    """

    __tablename__ = "classified_ad_report"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ad_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("classified_ad.id", ondelete="CASCADE"),
        index=True,
    )
    reporter_user_id: Mapped[int] = mapped_column(
        ForeignKey("classified_user.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("ad_id", "reporter_user_id", name="uq_ad_report_per_user"),
    )


class ClassifiedGoldRefundEvent(Base):
    """Audit log for every Gold refund attempt (eligible, blocked, or failed).

    Powers anti-abuse rate limits and support lookups. One row per attempt; Stripe
  idempotency keys prevent double charges on retries."""

    __tablename__ = "classified_gold_refund_event"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("classified_user.id", ondelete="SET NULL"), nullable=True, index=True
    )
    ad_id: Mapped[str] = mapped_column(String(36), index=True)
    payment_intent_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reason: Mapped[str] = mapped_column(String(64))
    eligible: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    refund_cents: Mapped[int] = mapped_column(Integer, default=0)
    blocked_reason: Mapped[str | None] = mapped_column(String(128), nullable=True)
    breakdown: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    stripe_refund_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("ix_gold_refund_user_created", "user_id", "created_at"),
    )


class ClassifiedBlockedSignature(Base):
    """SHA-256 fingerprint of an ad's title+description that was auto-removed
    after hitting the report threshold.

    When a user tries to create a new ad we hash its title+description and
    look for a matching row scoped to *that same seller*. If we find one,
    the create is rejected. This is a deterrent against re-listing the
    exact same content immediately after a removal — not a watertight ban,
    since a determined seller can re-word the post.

    Rows are not auto-pruned today; if/when this table gets big we can add
    a cron job to drop entries older than N days.
    """

    __tablename__ = "classified_blocked_signature"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("classified_user.id", ondelete="CASCADE"), index=True
    )
    signature: Mapped[str] = mapped_column(String(64), index=True)
    original_ad_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "signature", name="uq_blocked_sig_per_user"),
    )
