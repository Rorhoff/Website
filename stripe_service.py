"""
Stripe Checkout integration for the classifieds gold-frame paywall.

Surge pricing: the more gold ads currently active in the same (state, category), the higher
the price for the next boost. Anti-spam mechanism — keeps any one bucket from being
flooded with gold listings. Multiplier curve lives in _SURGE_TIERS below and is easy to
tune; pricing is computed server-side at checkout creation time so the client cannot
manipulate the amount charged.

Endpoints (in classifieds_routes.py):
- GET  /api/classifieds/gold/quote     → live price for a given ad+tier
- POST /api/classifieds/gold/checkout  → creates a Stripe Checkout session
- POST /api/classifieds/gold/webhook   → activates gold on payment confirmation

Gold refunds on early removal (seller delete or report auto-remove): see
`compute_gold_refund_quote` and `refund_prorated_gold_for_ad_removal`.

Env vars (set in .env.prod; never log or commit):
- STRIPE_SECRET_KEY:       sk_test_... or sk_live_...
- STRIPE_WEBHOOK_SECRET:   whsec_... (from Stripe → Webhooks dashboard)
- STRIPE_PUBLISHABLE_KEY:  pk_test_... or pk_live_... (frontend reads via /gold/config)
- STRIPE_PUBLIC_BASE_URL:  https://t1classifieds.com (where Stripe redirects after pay)

Test mode: use card 4242 4242 4242 4242, any future expiry, any CVC.
"""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models import ClassifiedAd, ClassifiedGoldRefundEvent

log = logging.getLogger("webapi-testing")

# --- Tier catalog (canonical: server-side; clients receive prices from /gold/quote) ----

# (tier_id, label, duration_days, base_price_usd)
GOLD_TIERS: tuple[tuple[str, str, int, int], ...] = (
    ("d3", "3 days", 3, 5),
    ("d7", "7 days", 7, 10),
    ("d14", "14 days", 14, 20),
)
_TIERS_BY_ID = {t[0]: t for t in GOLD_TIERS}

# --- Gold refund policy (card refunds) ------------------------------------------------

STRIPE_CARD_FEE_RATE = 0.029
STRIPE_CARD_FEE_FIXED_CENTS = 30
STRIPE_CARD_FEE_LABEL = "2.9% + $0.30"
MIN_REFUND_CENTS = 100  # $1.00 — do not issue smaller card refunds

# Seller-delete anti-abuse (violation auto-remove uses looser rules).
SELLER_REFUND_MIN_GOLD_AGE = timedelta(minutes=15)
SELLER_REFUND_MAX_PER_24H = 5

# Stripe metadata / idempotency reason tokens (stable — do not rename casually).
_GOLD_REFUND_REASON_SELLER_DELETE = "seller_delete_pro_rata"
_GOLD_REFUND_REASON_AUTO_REMOVE = "auto_removed_reports_pro_rata"

GOLD_REFUND_REASON_SELLER_DELETE = _GOLD_REFUND_REASON_SELLER_DELETE
GOLD_REFUND_REASON_AUTO_REMOVE = _GOLD_REFUND_REASON_AUTO_REMOVE


def tier_info(tier_id: str) -> tuple[str, int, int] | None:
    """Return (label, days, base_price_usd) or None if tier_id is unknown."""
    row = _TIERS_BY_ID.get(tier_id)
    if row is None:
        return None
    _, label, days, base = row
    return (label, days, base)


# --- Surge pricing -------------------------------------------------------------------


def _surge_multiplier(active_count: int) -> float:
    for cap, mult in _SURGE_TIERS:
        if active_count <= cap:
            return mult
    return _SURGE_OVER_CAP


def _surge_count(db: Session, state: str, category: str) -> int:
    """How many gold ads are currently active in this exact bucket (state + category)?"""
    now = datetime.utcnow()
    stmt = select(func.count()).select_from(ClassifiedAd).where(
        func.lower(ClassifiedAd.state) == state.strip().lower(),
        ClassifiedAd.category == category,
        ClassifiedAd.gold_until.is_not(None),
        ClassifiedAd.gold_until > now,
    )
    return int(db.execute(stmt).scalar_one())


@dataclass
class GoldQuote:
    tier_id: str
    label: str
    days: int
    base_price_usd: int
    multiplier: float
    price_usd_cents: int  # what Stripe will be told to charge
    active_in_bucket: int

    @property
    def price_usd(self) -> float:
        return self.price_usd_cents / 100.0


def quote_gold(db: Session, ad: ClassifiedAd, tier_id: str) -> GoldQuote:
    """Compute the current price for boosting `ad` for the given tier. Raises ValueError
    on bad tier_id."""
    info = tier_info(tier_id)
    if info is None:
        raise ValueError(f"Unknown gold tier: {tier_id!r}")
    label, days, base = info
    active = _surge_count(db, ad.state, ad.category)
    mult = _surge_multiplier(active)
    # Multiply in cents, round to nearest cent.
    cents = int(round(base * 100 * mult))
    return GoldQuote(
        tier_id=tier_id,
        label=label,
        days=days,
        base_price_usd=base,
        multiplier=mult,
        price_usd_cents=cents,
        active_in_bucket=active,
    )


# (max_active_inclusive, multiplier). Looked up by walking the list; first hit wins.
_SURGE_TIERS: tuple[tuple[int, float], ...] = (
    (1, 1.0),
    (3, 1.5),
    (6, 2.0),
    (10, 3.0),
)
_SURGE_OVER_CAP = 5.0  # applied to anything beyond the last tier's max


# --- Stripe SDK glue (lazy import so the app boots without the package in dev) -------


def _webhook_secret_configured() -> bool:
    return bool(
        os.getenv("STRIPE_WEBHOOK_SECRET")
        or os.getenv("REFERR_ALL_STRIPE_WEBHOOK_SECRET")
        or os.getenv("T1REFERRALL_STRIPE_WEBHOOK_SECRET")
    )


def stripe_enabled() -> bool:
    return bool(
        os.getenv("STRIPE_SECRET_KEY")
        and _webhook_secret_configured()
        and os.getenv("STRIPE_PUBLIC_BASE_URL")
    )


def _stripe_client() -> Any:
    import stripe  # type: ignore[import-not-found]

    stripe.api_key = os.environ["STRIPE_SECRET_KEY"]
    return stripe


def publishable_key() -> str | None:
    """Safe to expose to the browser. Returns None if not configured."""
    return os.getenv("STRIPE_PUBLISHABLE_KEY") or None


def checkout_error_detail(exc: BaseException) -> str:
    """User-facing message for checkout failures (Stripe errors are usually actionable)."""
    try:
        import stripe  # type: ignore[import-not-found]

        if isinstance(exc, stripe.error.StripeError):
            msg = getattr(exc, "user_message", None) or str(exc)
            if msg:
                return msg
    except ImportError:
        pass
    return "Could not start checkout."


def create_checkout_session(
    db: Session, ad: ClassifiedAd, tier_id: str, user_id: int
) -> tuple[str, str]:
    """Create a Stripe Checkout session for boosting `ad`. Returns (session_id, url).

    Pricing is computed server-side from the live surge count — the client cannot
    influence the amount charged. The session's metadata embeds the ad_id, tier, and
    user_id so the webhook can activate the right ad without re-querying.
    """
    if not stripe_enabled():
        raise RuntimeError("Stripe is not configured.")
    quote = quote_gold(db, ad, tier_id)
    stripe = _stripe_client()
    public_base = os.environ["STRIPE_PUBLIC_BASE_URL"].rstrip("/")
    session = stripe.checkout.Session.create(
        mode="payment",
        line_items=[
            {
                "quantity": 1,
                "price_data": {
                    "currency": "usd",
                    "unit_amount": quote.price_usd_cents,
                    "product_data": {
                        "name": f"Gold frame — {quote.label}",
                        "description": (
                            f"Boosts ad '{ad.title[:80]}' to the top of "
                            f"{ad.state} for {quote.days} days."
                        ),
                    },
                },
            }
        ],
        success_url=f"{public_base}/?gold=success&ad_id={ad.id}",
        cancel_url=f"{public_base}/?gold=cancel&ad_id={ad.id}",
        metadata={
            "ad_id": ad.id,
            "tier_id": tier_id,
            "user_id": str(user_id),
            "days": str(quote.days),
        },
        client_reference_id=f"ad:{ad.id}:tier:{tier_id}",
    )
    return (session.id, session.url)


def verify_webhook(payload: bytes, signature_header: str) -> Any:
    """Validate the Stripe webhook signature and return the parsed event. Raises
    stripe.error.SignatureVerificationError on failure."""
    if not stripe_enabled():
        raise RuntimeError("Stripe is not configured.")
    stripe = _stripe_client()
    return stripe.Webhook.construct_event(
        payload, signature_header, os.environ["STRIPE_WEBHOOK_SECRET"]
    )


def _safe_get(obj: Any, key: str) -> Any:
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


def apply_completed_checkout(db: Session, session: Any) -> str | None:
    """Activate gold on a paid Checkout session. Returns ad_id or None."""
    ad_id = _safe_get(_safe_get(session, "metadata"), "ad_id")
    if not ad_id:
        return None
    session_id = _safe_get(session, "id")
    days_raw = _safe_get(_safe_get(session, "metadata"), "days")
    try:
        days = int(days_raw) if days_raw is not None else 0
    except (TypeError, ValueError):
        days = 0
    if days <= 0:
        return None
    ad = db.get(ClassifiedAd, ad_id)
    if ad is None:
        log.warning("Stripe checkout %s referenced missing ad %s", session_id, ad_id)
        return None
    if ad.stripe_session_id == session_id:
        log.info("Stripe checkout %s already applied to ad %s", session_id, ad_id)
        return ad_id
    now = datetime.utcnow()
    base = ad.gold_until if ad.gold_until and ad.gold_until > now else now
    window_end = base + timedelta(days=days)
    ad.gold_until = window_end
    ad.stripe_session_id = session_id
    pi_raw = _safe_get(session, "payment_intent")
    pi_id: str | None = None
    if isinstance(pi_raw, dict):
        pi_id = _safe_get(pi_raw, "id")
    elif isinstance(pi_raw, str):
        pi_id = pi_raw
    amount_total = _safe_get(session, "amount_total")
    if pi_id:
        ad.last_gold_payment_intent_id = str(pi_id)
    if isinstance(amount_total, int) and amount_total > 0:
        ad.last_gold_payment_cents = amount_total
    ad.last_gold_window_start = base
    ad.last_gold_window_end = window_end
    db.add(ad)
    db.commit()
    log.info("Gold activated: ad=%s until=%s (session=%s)", ad_id, ad.gold_until, session_id)
    return ad_id


# --- Gold refund math + abuse ---------------------------------------------------------


def _stripe_fee_cents(gross_paid_cents: int) -> int:
    """Full original card processing fee (2.9% + $0.30), rounded to nearest cent."""
    return int(round(gross_paid_cents * STRIPE_CARD_FEE_RATE + STRIPE_CARD_FEE_FIXED_CENTS))


def _day_fractions(
    window_start: datetime, window_end: datetime, now: datetime
) -> tuple[float, float, float]:
    """Return (total_days, days_used, days_remaining) as fractional days from UTC window."""
    total_sec = max((window_end - window_start).total_seconds(), 0.0)
    if total_sec <= 0:
        return (0.0, 0.0, 0.0)
    used_sec = max(min((now - window_start).total_seconds(), total_sec), 0.0)
    remaining_sec = max(total_sec - used_sec, 0.0)
    sec_per_day = 86400.0
    return (
        total_sec / sec_per_day,
        used_sec / sec_per_day,
        remaining_sec / sec_per_day,
    )


def compute_gold_refund_quote(ad: ClassifiedAd, *, reason: str) -> dict[str, Any]:
    """Compute refund eligibility and a full fee breakdown (no Stripe API call).

    Seller delete: prorate net-after-fee by **days remaining**.
    Violation auto-remove: prorate by **days used** (subtract used-day value from net pool).

    The full original Stripe fee is always deducted from the gross payment before proration.
    """

    quote: dict[str, Any] = {
        "eligible": False,
        "refund_cents": 0,
        "blocked_reason": None,
        "reason": reason,
        "breakdown": None,
    }

    pi = getattr(ad, "last_gold_payment_intent_id", None) or ""
    cents_paid = getattr(ad, "last_gold_payment_cents", None)
    ws = getattr(ad, "last_gold_window_start", None)
    we = getattr(ad, "last_gold_window_end", None)

    if not pi:
        quote["blocked_reason"] = "no_payment_snapshot"
        log.info(
            "gold_refund_quote: ad=%s reason=%s blocked=no_payment_snapshot",
            ad.id,
            reason,
        )
        return quote

    if not isinstance(cents_paid, int) or cents_paid <= 0:
        quote["blocked_reason"] = "invalid_payment_amount"
        log.warning(
            "gold_refund_quote: ad=%s reason=%s blocked=invalid_payment_amount cents=%r",
            ad.id,
            reason,
            cents_paid,
        )
        return quote

    if ws is None or we is None or we <= ws:
        quote["blocked_reason"] = "invalid_gold_window"
        log.warning(
            "gold_refund_quote: ad=%s reason=%s blocked=invalid_gold_window ws=%s we=%s",
            ad.id,
            reason,
            ws,
            we,
        )
        return quote

    now = datetime.utcnow()
    if now >= we:
        quote["blocked_reason"] = "gold_expired"
        log.info(
            "gold_refund_quote: ad=%s reason=%s blocked=gold_expired",
            ad.id,
            reason,
        )
        return quote

    total_days, days_used, days_remaining = _day_fractions(ws, we, now)
    if total_days <= 0:
        quote["blocked_reason"] = "zero_window"
        return quote

    gross_paid_cents = cents_paid
    stripe_fee_cents = _stripe_fee_cents(gross_paid_cents)
    net_after_fee_cents = max(gross_paid_cents - stripe_fee_cents, 0)

    if reason == _GOLD_REFUND_REASON_SELLER_DELETE:
        proration_basis = "days_remaining"
        ratio = days_remaining / total_days
        prorated_cents = int(round(net_after_fee_cents * ratio))
    elif reason == _GOLD_REFUND_REASON_AUTO_REMOVE:
        proration_basis = "days_used"
        used_value_cents = int(round(net_after_fee_cents * (days_used / total_days)))
        prorated_cents = max(net_after_fee_cents - used_value_cents, 0)
        ratio = prorated_cents / net_after_fee_cents if net_after_fee_cents else 0.0
    else:
        quote["blocked_reason"] = "unknown_reason"
        return quote

    prorated_cents = min(prorated_cents, net_after_fee_cents)
    refund_cents = prorated_cents

    breakdown = {
        "gross_paid_cents": gross_paid_cents,
        "stripe_fee_cents": stripe_fee_cents,
        "stripe_fee_label": STRIPE_CARD_FEE_LABEL,
        "net_after_fee_cents": net_after_fee_cents,
        "total_days": round(total_days, 2),
        "days_used": round(days_used, 2),
        "days_remaining": round(days_remaining, 2),
        "proration_basis": proration_basis,
        "proration_ratio": round(ratio, 4),
        "prorated_refund_cents": prorated_cents,
        "minimum_refund_cents": MIN_REFUND_CENTS,
    }
    quote["breakdown"] = breakdown

    if refund_cents < MIN_REFUND_CENTS:
        quote["blocked_reason"] = "below_minimum_refund"
        log.info(
            "gold_refund_quote: ad=%s reason=%s blocked=below_minimum refund_cents=%s breakdown=%s",
            ad.id,
            reason,
            refund_cents,
            json.dumps(breakdown, default=str),
        )
        return quote

    quote["eligible"] = True
    quote["refund_cents"] = refund_cents
    log.info(
        "gold_refund_quote: ad=%s reason=%s eligible refund_cents=%s breakdown=%s",
        ad.id,
        reason,
        refund_cents,
        json.dumps(breakdown, default=str),
    )
    return quote


def assess_gold_refund_abuse(
    db: Session,
    user_id: int,
    ad: ClassifiedAd,
    *,
    reason: str,
    quote: dict[str, Any],
) -> str | None:
    """Return a blocked_reason token if anti-abuse rules fail, else None."""

    if not quote.get("eligible"):
        return None

    if reason == _GOLD_REFUND_REASON_SELLER_DELETE:
        ws = ad.last_gold_window_start
        if ws is not None:
            age = datetime.utcnow() - ws
            if age < SELLER_REFUND_MIN_GOLD_AGE:
                log.warning(
                    "gold_refund_abuse: user=%s ad=%s blocked=gold_too_new age_sec=%.0f",
                    user_id,
                    ad.id,
                    age.total_seconds(),
                )
                return "gold_purchase_too_recent"

        since = datetime.utcnow() - timedelta(hours=24)
        recent = db.scalar(
            select(func.count())
            .select_from(ClassifiedGoldRefundEvent)
            .where(
                ClassifiedGoldRefundEvent.user_id == user_id,
                ClassifiedGoldRefundEvent.reason == _GOLD_REFUND_REASON_SELLER_DELETE,
                ClassifiedGoldRefundEvent.refund_cents > 0,
                ClassifiedGoldRefundEvent.created_at >= since,
            )
        )
        if recent and int(recent) >= SELLER_REFUND_MAX_PER_24H:
            log.warning(
                "gold_refund_abuse: user=%s ad=%s blocked=rate_limit count_24h=%s",
                user_id,
                ad.id,
                recent,
            )
            return "refund_rate_limit"

        dup = db.scalar(
            select(func.count())
            .select_from(ClassifiedGoldRefundEvent)
            .where(
                ClassifiedGoldRefundEvent.ad_id == ad.id,
                ClassifiedGoldRefundEvent.payment_intent_id
                == (ad.last_gold_payment_intent_id or ""),
                ClassifiedGoldRefundEvent.refund_cents > 0,
            )
        )
        if dup and int(dup) > 0:
            log.warning(
                "gold_refund_abuse: user=%s ad=%s blocked=duplicate_refund pi=%s",
                user_id,
                ad.id,
                ad.last_gold_payment_intent_id,
            )
            return "already_refunded"

    return None


def record_gold_refund_event(
    db: Session,
    *,
    user_id: int | None,
    ad_id: str,
    payment_intent_id: str | None,
    reason: str,
    quote: dict[str, Any],
    stripe_refund_id: str | None = None,
    abuse_blocked: str | None = None,
) -> None:
    """Persist an audit row for every refund attempt (eligible or blocked)."""
    blocked = abuse_blocked or quote.get("blocked_reason")
    row = ClassifiedGoldRefundEvent(
        user_id=user_id,
        ad_id=ad_id,
        payment_intent_id=payment_intent_id,
        reason=reason,
        eligible=bool(quote.get("eligible") and not abuse_blocked),
        refund_cents=int(quote.get("refund_cents") or 0),
        blocked_reason=blocked,
        breakdown=quote.get("breakdown"),
        stripe_refund_id=stripe_refund_id,
    )
    db.add(row)
    log.info(
        "gold_refund_event: user=%s ad=%s reason=%s eligible=%s refund_cents=%s blocked=%s stripe_refund=%s",
        user_id,
        ad_id,
        reason,
        row.eligible,
        row.refund_cents,
        blocked,
        stripe_refund_id,
    )


def refund_prorated_gold_for_ad_removal(
    ad: ClassifiedAd, *, reason: str, db: Session, user_id: int | None = None
) -> dict[str, Any]:
    """Issue a best-effort partial refund when a listing is removed before gold expires."""

    outcome: dict[str, Any] = {
        "attempted": False,
        "eligible": False,
        "refund_cents": 0,
        "stripe_refund_id": None,
        "error": None,
        "reason": reason,
        "blocked_reason": None,
        "breakdown": None,
    }

    if not stripe_enabled():
        log.info("gold_refund_skip: ad=%s reason=%s stripe_disabled", ad.id, reason)
        return outcome

    quote = compute_gold_refund_quote(ad, reason=reason)
    outcome["breakdown"] = quote.get("breakdown")
    outcome["blocked_reason"] = quote.get("blocked_reason")

    uid = user_id if user_id is not None else ad.user_id
    abuse = None
    if uid is not None:
        abuse = assess_gold_refund_abuse(db, uid, ad, reason=reason, quote=quote)
    if abuse:
        outcome["blocked_reason"] = abuse
        record_gold_refund_event(
            db,
            user_id=uid,
            ad_id=ad.id,
            payment_intent_id=ad.last_gold_payment_intent_id,
            reason=reason,
            quote=quote,
            abuse_blocked=abuse,
        )
        return outcome

    if not quote.get("eligible"):
        record_gold_refund_event(
            db,
            user_id=uid,
            ad_id=ad.id,
            payment_intent_id=ad.last_gold_payment_intent_id,
            reason=reason,
            quote=quote,
        )
        return outcome

    refund_cents = int(quote["refund_cents"])
    pi = ad.last_gold_payment_intent_id or ""
    outcome["eligible"] = True

    try:
        stripe = _stripe_client()
        outcome["attempted"] = True
        idem = f"t1-gold-refund-{reason}-{ad.id}-{pi}"[:245]
        bd = quote.get("breakdown") or {}
        rf = stripe.Refund.create(
            payment_intent=pi,
            amount=refund_cents,
            metadata={
                "t1classifieds_reason": reason,
                "ad_id": str(ad.id),
                "proration_basis": str(bd.get("proration_basis", "")),
                "stripe_fee_cents": str(bd.get("stripe_fee_cents", "")),
            },
            idempotency_key=idem,
        )
        rf_id = _safe_get(rf, "id")
        outcome["stripe_refund_id"] = rf_id or None
        outcome["refund_cents"] = refund_cents
        log.info(
            "gold_refund_stripe_ok: ad=%s reason=%s refund_cents=%s stripe_refund=%s breakdown=%s",
            ad.id,
            reason,
            refund_cents,
            outcome["stripe_refund_id"],
            json.dumps(bd, default=str),
        )
        record_gold_refund_event(
            db,
            user_id=uid,
            ad_id=ad.id,
            payment_intent_id=pi,
            reason=reason,
            quote=quote,
            stripe_refund_id=outcome["stripe_refund_id"],
        )
    except Exception as exc:
        outcome["attempted"] = True
        outcome["error"] = repr(exc)
        log.exception(
            "gold_refund_stripe_fail: ad=%s reason=%s refund_cents=%s",
            ad.id,
            reason,
            refund_cents,
        )
        record_gold_refund_event(
            db,
            user_id=uid,
            ad_id=ad.id,
            payment_intent_id=pi,
            reason=reason,
            quote=quote,
        )

    return outcome


def refund_prorated_gold_for_platform_removal(
    ad: ClassifiedAd, db: Session
) -> dict[str, Any]:
    return refund_prorated_gold_for_ad_removal(
        ad, reason=_GOLD_REFUND_REASON_AUTO_REMOVE, db=db, user_id=ad.user_id
    )


def refund_prorated_gold_for_seller_delete(
    ad: ClassifiedAd, db: Session, user_id: int
) -> dict[str, Any]:
    return refund_prorated_gold_for_ad_removal(
        ad, reason=_GOLD_REFUND_REASON_SELLER_DELETE, db=db, user_id=user_id
    )


# --- Referr-All featured (premium) refunds --------------------------------------------

PREMIUM_REFUND_REASON_SELLER_DELETE = "referr_all_premium_seller_delete"


def payment_intent_from_checkout_session(session_id: str) -> tuple[str | None, int]:
    """Return (payment_intent_id, amount_total_cents) for a Checkout session."""
    if not session_id or not stripe_enabled():
        return None, 0
    stripe = _stripe_client()
    session = stripe.checkout.Session.retrieve(session_id, expand=["payment_intent"])
    amount_total = _safe_get(session, "amount_total")
    cents = int(amount_total) if isinstance(amount_total, int) and amount_total > 0 else 0
    pi_raw = _safe_get(session, "payment_intent")
    if isinstance(pi_raw, str):
        return pi_raw, cents
    if isinstance(pi_raw, dict):
        pid = pi_raw.get("id")
        return (str(pid) if pid else None), cents
    pid = _safe_get(pi_raw, "id") if pi_raw is not None else None
    return (str(pid) if pid else None), cents


def compute_premium_refund_quote(
    *,
    amount_cents: int,
    payment_intent_id: str,
    window_start: datetime,
    window_end: datetime,
    already_refunded: bool = False,
) -> dict[str, Any]:
    """Prorate featured payment: (gross − Stripe fee) × days remaining / total days.

    Uses the same fee model as Classifieds Gold seller-delete refunds (2.9% + $0.30).
    """
    quote: dict[str, Any] = {
        "eligible": False,
        "refund_cents": 0,
        "blocked_reason": None,
        "reason": PREMIUM_REFUND_REASON_SELLER_DELETE,
        "breakdown": None,
    }
    if already_refunded:
        quote["blocked_reason"] = "already_refunded"
        return quote
    if not payment_intent_id:
        quote["blocked_reason"] = "no_payment_intent"
        return quote
    if amount_cents <= 0:
        quote["blocked_reason"] = "invalid_payment_amount"
        return quote
    now = datetime.utcnow()
    if now >= window_end:
        quote["blocked_reason"] = "premium_expired"
        return quote
    total_days, days_used, days_remaining = _day_fractions(window_start, window_end, now)
    if total_days <= 0:
        quote["blocked_reason"] = "zero_window"
        return quote
    gross_paid_cents = amount_cents
    stripe_fee_cents = _stripe_fee_cents(gross_paid_cents)
    net_after_fee_cents = max(gross_paid_cents - stripe_fee_cents, 0)
    ratio = days_remaining / total_days
    prorated_cents = min(int(round(net_after_fee_cents * ratio)), net_after_fee_cents)
    if prorated_cents < MIN_REFUND_CENTS:
        quote["blocked_reason"] = "below_minimum_refund"
        quote["breakdown"] = {
            "gross_paid_cents": gross_paid_cents,
            "stripe_fee_cents": stripe_fee_cents,
            "stripe_fee_label": STRIPE_CARD_FEE_LABEL,
            "net_after_fee_cents": net_after_fee_cents,
            "total_days": round(total_days, 4),
            "days_used": round(days_used, 4),
            "days_remaining": round(days_remaining, 4),
            "proration_basis": "days_remaining",
            "proration_ratio": round(ratio, 6),
            "prorated_refund_cents": prorated_cents,
            "minimum_refund_cents": MIN_REFUND_CENTS,
        }
        return quote
    quote["eligible"] = True
    quote["refund_cents"] = prorated_cents
    quote["breakdown"] = {
        "gross_paid_cents": gross_paid_cents,
        "stripe_fee_cents": stripe_fee_cents,
        "stripe_fee_label": STRIPE_CARD_FEE_LABEL,
        "net_after_fee_cents": net_after_fee_cents,
        "total_days": round(total_days, 4),
        "days_used": round(days_used, 4),
        "days_remaining": round(days_remaining, 4),
        "proration_basis": "days_remaining",
        "proration_ratio": round(ratio, 6),
        "prorated_refund_cents": prorated_cents,
        "minimum_refund_cents": MIN_REFUND_CENTS,
    }
    return quote


def refund_premium_for_seeker_post_delete(
    *,
    amount_cents: int,
    payment_intent_id: str,
    window_start: datetime,
    window_end: datetime,
    seeker_post_id: str,
    already_refunded: bool = False,
) -> dict[str, Any]:
    """Issue Stripe partial refund when a featured seeker post is deleted early."""
    outcome: dict[str, Any] = {
        "attempted": False,
        "eligible": False,
        "refund_cents": 0,
        "stripe_refund_id": None,
        "error": None,
        "blocked_reason": None,
        "breakdown": None,
    }
    quote = compute_premium_refund_quote(
        amount_cents=amount_cents,
        payment_intent_id=payment_intent_id,
        window_start=window_start,
        window_end=window_end,
        already_refunded=already_refunded,
    )
    outcome["breakdown"] = quote.get("breakdown")
    outcome["blocked_reason"] = quote.get("blocked_reason")
    if not quote.get("eligible"):
        return outcome
    if not stripe_enabled():
        outcome["error"] = "stripe_disabled"
        return outcome
    refund_cents = int(quote["refund_cents"])
    outcome["eligible"] = True
    try:
        stripe = _stripe_client()
        outcome["attempted"] = True
        idem = f"referr-all-premium-refund-{seeker_post_id}-{payment_intent_id}"[:245]
        rf = stripe.Refund.create(
            payment_intent=payment_intent_id,
            amount=refund_cents,
            metadata={
                "product": "referr_all_premium",
                "seeker_post_id": seeker_post_id,
                "reason": PREMIUM_REFUND_REASON_SELLER_DELETE,
            },
            idempotency_key=idem,
        )
        outcome["stripe_refund_id"] = _safe_get(rf, "id") or None
        outcome["refund_cents"] = refund_cents
        log.info(
            "premium_refund_ok: post=%s refund_cents=%s stripe_refund=%s",
            seeker_post_id,
            refund_cents,
            outcome["stripe_refund_id"],
        )
    except Exception as exc:
        outcome["error"] = str(exc)
        log.exception("premium_refund_fail: post=%s", seeker_post_id)
    return outcome


def refund_quote_to_api(quote: dict[str, Any]) -> dict[str, Any]:
    """CamelCase refund preview payload for the SPA."""
    bd = quote.get("breakdown")
    out: dict[str, Any] = {
        "eligible": bool(quote.get("eligible")),
        "refundCents": int(quote.get("refund_cents") or 0),
        "blockedReason": quote.get("blocked_reason"),
        "reason": quote.get("reason"),
    }
    if not bd:
        return out
    out["breakdown"] = {
        "grossPaidCents": bd["gross_paid_cents"],
        "stripeFeeCents": bd["stripe_fee_cents"],
        "stripeFeeLabel": bd["stripe_fee_label"],
        "netAfterFeeCents": bd["net_after_fee_cents"],
        "totalDays": bd["total_days"],
        "daysUsed": bd["days_used"],
        "daysRemaining": bd["days_remaining"],
        "prorationBasis": bd["proration_basis"],
        "prorationRatio": bd["proration_ratio"],
        "proratedRefundCents": bd["prorated_refund_cents"],
        "minimumRefundCents": bd["minimum_refund_cents"],
    }
    return out
