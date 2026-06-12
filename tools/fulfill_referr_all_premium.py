#!/usr/bin/env python3
"""Activate Referr-All featured status for a paid Stripe Checkout session (bypasses webhook)."""

from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.chdir(ROOT)


def _load_env() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    for name in (
        os.environ.get("ENV_FILE", ""),
        ".env.dev",
        ".env",
        "/home/ubuntu/Website/.env.dev",
        "/home/ubuntu/Website/.env",
    ):
        if name and os.path.isfile(name):
            load_dotenv(name, override=False)


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: fulfill_referr_all_premium.py <stripe_session_id>", file=sys.stderr)
        print("Example: fulfill_referr_all_premium.py cs_test_a1MiHqAtsogEfYeZ9Ksd10ssx6GWEAOuTiqBAUohRCUAi4MTqUNwdhHYiR")
        return 1

    session_id = sys.argv[1].strip()
    _load_env()

    if not os.getenv("STRIPE_SECRET_KEY"):
        print("ERR  STRIPE_SECRET_KEY not set", file=sys.stderr)
        return 1
    if not os.getenv("DATABASE_URL"):
        print("ERR  DATABASE_URL not set", file=sys.stderr)
        return 1

    import stripe_service
    from database import SessionLocal
    from t1referrall_routes import _fulfill_premium_checkout

    stripe = stripe_service._stripe_client()
    try:
        session = stripe.checkout.Session.retrieve(session_id)
    except Exception as exc:
        print(f"ERR  Could not retrieve Stripe session: {exc}", file=sys.stderr)
        return 1

    db = SessionLocal()
    try:
        result = _fulfill_premium_checkout(db, session)
    except Exception as exc:
        print(f"ERR  Fulfillment failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        print("     Run: bash deploy/migrate-t1referrall-v3.sh", file=sys.stderr)
        return 1
    finally:
        db.close()

    if not result:
        print("WARN No changes — session may be unpaid or not a featured checkout.")
        print(f"     payment_status={getattr(session, 'payment_status', None)}")
        print(f"     metadata={dict(getattr(session, 'metadata', {}) or {})}")
        return 2

    print("OK ", result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
