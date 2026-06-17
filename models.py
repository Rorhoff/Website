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

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
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
    email: Mapped[str] = mapped_column(String(255), index=True)
    phone: Mapped[str] = mapped_column(String(64), default="")
    state: Mapped[str] = mapped_column(String(64))
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    first_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    display_preference: Mapped[str] = mapped_column(
        String(16), default="first_name", server_default="first_name"
    )
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    is_lightweight: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    email_notifications_enabled: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true"
    )
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


class ClassifiedConversation(Base):
    __tablename__ = "classified_conversation"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    listing_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("classified_ad.id", ondelete="CASCADE"), index=True
    )
    buyer_user_id: Mapped[int] = mapped_column(
        ForeignKey("classified_user.id", ondelete="CASCADE"), index=True
    )
    seller_user_id: Mapped[int] = mapped_column(
        ForeignKey("classified_user.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String(16), default="active", server_default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    last_message_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("listing_id", "buyer_user_id", name="uq_conversation_listing_buyer"),
        Index("ix_conversation_buyer_last", "buyer_user_id", "last_message_at"),
        Index("ix_conversation_seller_last", "seller_user_id", "last_message_at"),
    )


class ClassifiedMessage(Base):
    __tablename__ = "classified_message"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("classified_conversation.id", ondelete="CASCADE"), index=True
    )
    sender_user_id: Mapped[int] = mapped_column(
        ForeignKey("classified_user.id", ondelete="CASCADE"), index=True
    )
    message_type: Mapped[str] = mapped_column(String(16))
    preset_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    body: Mapped[str] = mapped_column(Text())
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("ix_message_conversation_created", "conversation_id", "created_at"),
    )


class ClassifiedMagicLinkToken(Base):
    __tablename__ = "classified_magic_link_token"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(255))
    token_hash: Mapped[str] = mapped_column(String(64), index=True)
    redirect_path: Mapped[str] = mapped_column(String(500), default="/")
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)

    __table_args__ = (
        Index("ix_magic_link_email_created", "email", "created_at"),
    )


class ClassifiedPasswordResetToken(Base):
    __tablename__ = "classified_password_reset_token"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("classified_user.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)

    __table_args__ = (
        Index("ix_password_reset_user_created", "user_id", "created_at"),
    )


# --- Referr-All (job referral network on rorhoff.com /referr-all/) ----------------


class T1ReferrallUser(Base):
    """Auth + profile in one row (replaces Supabase auth.users + profiles)."""

    __tablename__ = "t1referrall_user"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(200), default="", server_default="")
    avatar_url: Mapped[str] = mapped_column(Text(), default="", server_default="")
    banner_url: Mapped[str] = mapped_column(Text(), default="", server_default="")
    bio: Mapped[str] = mapped_column(Text(), default="", server_default="")
    company: Mapped[str] = mapped_column(String(200), default="", server_default="")
    role: Mapped[str] = mapped_column(String(200), default="", server_default="")
    location: Mapped[str] = mapped_column(String(200), default="", server_default="")
    linkedin_url: Mapped[str] = mapped_column(String(500), default="", server_default="")
    portfolio_url: Mapped[str] = mapped_column(String(500), default="", server_default="")
    years_experience: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")
    skills: Mapped[list[Any]] = mapped_column(JSONB, default=list, server_default="[]")
    interests: Mapped[list[Any]] = mapped_column(JSONB, default=list, server_default="[]")
    is_suspended: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    email_verify_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    email_verify_sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    password_reset_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    password_reset_sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    phone: Mapped[str] = mapped_column(String(32), default="", server_default="")
    totp_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    is_deactivated: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class T1ReferrallSession(Base):
    __tablename__ = "t1referrall_session"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("t1referrall_user.id", ondelete="CASCADE"), index=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    user_agent: Mapped[str] = mapped_column(String(400), default="", server_default="")
    ip: Mapped[str] = mapped_column(String(64), default="", server_default="")
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class T1ReferrallPost(Base):
    __tablename__ = "t1referrall_post"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    author_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("t1referrall_user.id", ondelete="CASCADE"), index=True
    )
    company: Mapped[str] = mapped_column(String(200))
    role_title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text(), default="", server_default="")
    referral_bonus: Mapped[str] = mapped_column(String(200), default="", server_default="")
    has_bonus: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    job_url: Mapped[str] = mapped_column(String(500), default="", server_default="")
    location: Mapped[str] = mapped_column(String(200), default="", server_default="")
    is_remote: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    tags: Mapped[list[Any]] = mapped_column(JSONB, default=list, server_default="[]")
    required_skills: Mapped[list[Any]] = mapped_column(JSONB, default=list, server_default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class T1ReferrallSeekerPost(Base):
    __tablename__ = "t1referrall_seeker_post"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    author_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("t1referrall_user.id", ondelete="CASCADE"), index=True
    )
    headline: Mapped[str] = mapped_column(String(300), default="", server_default="")
    about: Mapped[str] = mapped_column(Text(), default="", server_default="")
    desired_role: Mapped[str] = mapped_column(String(200), default="", server_default="")
    desired_location: Mapped[str] = mapped_column(String(200), default="", server_default="")
    open_to_remote: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    field_of_work: Mapped[str] = mapped_column(String(200), default="", server_default="")
    skills: Mapped[list[Any]] = mapped_column(JSONB, default=list, server_default="[]")
    experience_years: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")
    resume_url: Mapped[str] = mapped_column(String(500), default="", server_default="")
    portfolio_url: Mapped[str] = mapped_column(String(500), default="", server_default="")
    availability: Mapped[str] = mapped_column(String(16), default="immediately", server_default="immediately")
    is_premium: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    premium_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    premium_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class T1ReferrallConnection(Base):
    __tablename__ = "t1referrall_connection"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    requester_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("t1referrall_user.id", ondelete="CASCADE"), index=True
    )
    addressee_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("t1referrall_user.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("requester_id", "addressee_id", name="uq_t1ref_connection_pair"),
    )


class T1ReferrallConversation(Base):
    __tablename__ = "t1referrall_conversation"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class T1ReferrallConversationParticipant(Base):
    __tablename__ = "t1referrall_conversation_participant"

    conversation_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("t1referrall_conversation.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("t1referrall_user.id", ondelete="CASCADE"), primary_key=True
    )


class T1ReferrallMessage(Base):
    __tablename__ = "t1referrall_message"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("t1referrall_conversation.id", ondelete="CASCADE"),
        index=True,
    )
    sender_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("t1referrall_user.id", ondelete="CASCADE"), index=True
    )
    content: Mapped[str] = mapped_column(Text())
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("ix_t1ref_message_conv_created", "conversation_id", "created_at"),
    )


class T1ReferrallPremiumPurchase(Base):
    __tablename__ = "t1referrall_premium_purchase"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("t1referrall_user.id", ondelete="CASCADE"), index=True
    )
    seeker_post_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("t1referrall_seeker_post.id", ondelete="SET NULL"),
        nullable=True,
    )
    amount_cents: Mapped[int] = mapped_column(Integer)
    purchase_number: Mapped[int] = mapped_column(Integer)
    stripe_session_id: Mapped[str | None] = mapped_column(String(200), unique=True, nullable=True)
    stripe_payment_intent_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    refund_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stripe_refund_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class T1ReferrallUserBlock(Base):
    __tablename__ = "t1referrall_user_block"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    blocker_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("t1referrall_user.id", ondelete="CASCADE"), index=True
    )
    blocked_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("t1referrall_user.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("blocker_id", "blocked_id", name="uq_t1ref_block_pair"),
        Index("ix_t1ref_block_blocked_id", "blocked_id"),
    )


class T1ReferrallPostReport(Base):
    __tablename__ = "t1referrall_post_report"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    reporter_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("t1referrall_user.id", ondelete="CASCADE"), index=True
    )
    post_kind: Mapped[str] = mapped_column(String(16), index=True)
    post_id: Mapped[str] = mapped_column(String(36), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("reporter_id", "post_kind", "post_id", name="uq_t1ref_post_report"),
        Index("ix_t1ref_post_report_target", "post_kind", "post_id"),
    )
