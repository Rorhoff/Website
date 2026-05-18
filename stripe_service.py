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

Prorated partial refunds after platform auto-removals (report threshold): see `refund_prorated_gold_for_platform_removal`.

Env vars (set in .env.prod; never log or commit):
- STRIPE_SECRET_KEY:       sk_test_... or sk_live_...
- STRIPE_WEBHOOK_SECRET:   whsec_... (from Stripe → Webhooks dashboard)
- STRIPE_PUBLISHABLE_KEY:  pk_test_... or pk_live_... (frontend reads via /gold/config)
- STRIPE_PUBLIC_BASE_URL:  https://t1classifieds.com (where Stripe redirects after pay)

Test mode: use card 4242 4242 4242 4242, any future expiry, any CVC.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models import ClassifiedAd

log = logging.getLogger("webapi-testing")

# --- Tier catalog (canonical: server-side; clients receive prices from /gold/quote) ----

# (tier_id, label, duration_days, base_price_usd)
GOLD_TIERS: tuple[tuple[str, str, int, int], ...] = (
    ("d3", "3 days", 3, 5),
    ("d7", "7 days", 7, 10),
    ("d14", "14 days", 14, 20),
)
_TIERS_BY_ID = {t[0]: t for t in GOLD_TIERS}


def tier_info(tier_id: str) -> tuple[str, int, int] | None:
    """Return (label, days, base_price_usd) or None if tier_id is unknown."""
    row = _TIERS_BY_ID.get(tier_id)
    if row is None:
        return None
    _, label, days, base = row
    return (label, days, base)


# --- Surge pricing -------------------------------------------------------------------

# (max_active_inclusive, multiplier). Looked up by walking the list; first hit wins.
# Tune freely — only affects new checkouts; existing gold ads keep what they paid.
_SURGE_TIERS: tuple[tuple[int, float], ...] = (
    (1, 1.0),
    (3, 1.5),
    (6, 2.0),
    (10, 3.0),
)
_SURGE_OVER_CAP = 5.0  # applied to anything beyond the last tier's max


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


# --- Stripe SDK glue (lazy import so the app boots without the package in dev) -------


def stripe_enabled() -> bool:
    return bool(
        os.getenv("STRIPE_SECRET_KEY")
        and os.getenv("STRIPE_WEBHOOK_SECRET")
        and os.getenv("STRIPE_PUBLIC_BASE_URL")
    )


def _stripe_client() -> Any:
    import stripe  # type: ignore[import-not-found]

    stripe.api_key = os.environ["STRIPE_SECRET_KEY"]
    return stripe


def publishable_key() -> str | None:
    """Safe to expose to the browser. Returns None if not configured."""
    return os.getenv("STRIPE_PUBLISHABLE_KEY") or None


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
        # Surfaces in the Stripe Dashboard listing.
        client_reference_id=f"ad:{ad.id}:tier:{tier_id}",
    )
    return (session.id, session.url)


def verify_webhook(payload: bytes, signature_header: str) -> Any:
    """Validate the Stripe webhook signature and return the parsed event. Raises
    stripe.error.SignatureVerificationError on tampering — let it propagate to a 400."""
    if not stripe_enabled():
        raise RuntimeError("Stripe is not configured.")
    stripe = _stripe_client()
    secret = os.environ["STRIPE_WEBHOOK_SECRET"]
    return stripe.Webhook.construct_event(payload, signature_header, secret)


def _safe_get(obj: Any, key: str) -> Any:
    """Stripe-python's StripeObject overrides __getattr__ such that .get(...) is treated as
    a dict-key lookup ('get') rather than a method, raising AttributeError. Always use
    bracket-style access via this helper, which catches KeyError so optional keys don't
    crash the webhook handler."""
    try:
        return obj[key]
    except (KeyError, TypeError):
        return None


def apply_completed_checkout(db: Session, event: Any) -> str | None:
    """Webhook handler: marks the ad gold for `days` after now. Idempotent — replaying
    the same event is a no-op. Returns the ad_id on success, None if the event isn't a
    successful checkout we care about."""
    if _safe_get(event, "type") != "checkout.session.completed":
        return None
    session = event["data"]["object"]
    session_id = _safe_get(session, "id") or ""
    # Only fully-paid sessions activate gold — skip async unpaid ones (e.g. ACH pending).
    if _safe_get(session, "payment_status") != "paid":
        log.info(
            "Stripe checkout %s not yet paid (status=%s); skipping",
            session_id,
            _safe_get(session, "payment_status"),
        )
        return None
    meta = _safe_get(session, "metadata") or {}
    ad_id = _safe_get(meta, "ad_id")
    days_str = _safe_get(meta, "days")
    if not ad_id or not days_str:
        log.warning("Stripe checkout %s missing metadata: %r", session_id, dict(meta) if meta else {})
        return None
    try:
        days = int(days_str)
    except ValueError:
        log.warning("Stripe checkout %s bad days metadata: %r", session_id, days_str)
        return None
    ad = db.get(ClassifiedAd, ad_id)
    if ad is None:
        log.warning("Stripe checkout %s referenced missing ad %s", session_id, ad_id)
        return None
    # Idempotency: same session id replayed → no-op.
    if ad.stripe_session_id == session_id:
        log.info("Stripe checkout %s already applied to ad %s", session_id, ad_id)
        return ad_id
    # Extend from now (or from current gold_until if still active, so back-to-back boosts
    # stack instead of overlap).
    now = datetime.utcnow()
    base = ad.gold_until if ad.gold_until and ad.gold_until > now else now
    window_end = base + timedelta(days=days)
    ad.gold_until = window_end
    ad.stripe_session_id = session_id
    # Snapshot the paid window + charge for automated prorated refunds if we ever
    # auto-remove this listing before window_end (report threshold). Seller-initiated
    # deletes deliberately do NOT trigger this path — see classify gold-policy.html.
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


def refund_prorated_gold_for_platform_removal(ad: ClassifiedAd) -> dict[str, Any]:
    """Issue a best-effort **partial** refund for unused gold time after the marketplace
    auto-removes a listing (e.g. repeated reports). Sellers who delete their own ads do
    not hit this helper — see footer policy page.

    Returns a small dict suitable for structured logging (attempted, refund cents, refund
    id, error string). Stripe failures never raise — callers still delete the ad so an
    abusive listing does not linger; ops can reconcile from logs / Dashboard."""

    outcome: dict[str, Any] = {
        "attempted": False,
        "eligible": False,
        "refund_cents": 0,
        "stripe_refund_id": None,
        "error": None,
    }

    if not stripe_enabled():
        return outcome

    pi = getattr(ad, "last_gold_payment_intent_id", None) or ""
    cents_paid = getattr(ad, "last_gold_payment_cents", None)
    ws = getattr(ad, "last_gold_window_start", None)
    we = getattr(ad, "last_gold_window_end", None)

    if not pi:
        log.info(
            "Gold refund skipped — no PaymentIntent snapshot (legacy ad?): ad=%s", ad.id
        )
        return outcome

    if not isinstance(cents_paid, int) or cents_paid <= 0:
        log.warning("Gold refund skipped — bad cents snapshot=%r ad=%s", cents_paid, ad.id)
        return outcome

    if ws is None or we is None or we <= ws:
        log.warning(
            "Gold refund skipped — bad window start=%s end=%s ad=%s", ws, we, ad.id
        )
        return outcome

    now = datetime.utcnow()
    if now >= we:
        log.info(
            "Gold refund skipped — listing removed after gold expiry (no unused time): ad=%s",
            ad.id,
        )
        return outcome

    total_sec = (we - ws).total_seconds()
    unused_sec = (we - now).total_seconds()
    if total_sec <= 0 or unused_sec <= 0:
        return outcome

    outcome["eligible"] = True

    refund_cents = int((cents_paid * unused_sec) / total_sec)
    # Never refund less than one cent unless rounding killed it; never more than captured.
    if refund_cents < 1:
        log.info(
            "Gold refund skipped — prorated rounded to zero (ad=%s paid_cents=%d unused_sec=%s)",
            ad.id,
            cents_paid,
            unused_sec,
        )
        return outcome
    if refund_cents > cents_paid:
        refund_cents = cents_paid

    try:
        stripe = _stripe_client()
        outcome["attempted"] = True
        # Stable idempotency key so Stripe replays don't double-refund during rare retries.
        idem = f"t1-auto-remove-{ad.id}-{pi}"[:245]
        rf = stripe.Refund.create(
            payment_intent=pi,
            amount=refund_cents,
            metadata={
                "t1classifieds_reason": "auto_removed_reports_pro_rata",
                "ad_id": str(ad.id),
            },
            idempotency_key=idem,
        )
        rf_id = _safe_get(rf, "id")
        outcome["stripe_refund_id"] = rf_id or None
        outcome["refund_cents"] = refund_cents
        log.info(
            "Gold pro-rata refund ok: ad=%s refund_cents=%s stripe_refund=%s",
            ad.id,
            refund_cents,
            outcome["stripe_refund_id"],
        )
    except Exception as exc:
        outcome["attempted"] = True
        outcome["error"] = repr(exc)
        log.exception(
            "Gold pro-rata refund FAILED (ad removed anyway): ad=%s exc=%s", ad.id, exc
        )

    return outcome
