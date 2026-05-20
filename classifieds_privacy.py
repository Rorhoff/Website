"""Public listing privacy: scrub embedded contact info from descriptions."""

from __future__ import annotations

import re

PHONE_RE = re.compile(r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b")
EMAIL_RE = re.compile(
    r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
    re.IGNORECASE,
)
SCRUB_REPLACEMENT = "[contact info hidden]"


def scrub_public_description(text: str | None) -> tuple[str, bool]:
    """Return (scrubbed_text, was_scrubbed)."""
    if not text:
        return "", False
    out = text
    changed = False
    if PHONE_RE.search(out):
        out = PHONE_RE.sub(SCRUB_REPLACEMENT, out)
        changed = True
    if EMAIL_RE.search(out):
        out = EMAIL_RE.sub(SCRUB_REPLACEMENT, out)
        changed = True
    return out, changed


def seller_display_name(user) -> str:
    """Public seller label from profile preference (Sprint 3 fields; MVP uses contact_name on ad)."""
    pref = (getattr(user, "display_preference", None) or "first_name").strip()
    if pref == "username":
        return (user.username or "").strip()
    first = (getattr(user, "first_name", None) or "").strip()
    if first:
        return first.split()[0]
    return (user.username or "").strip()


def buyer_display_name(user) -> str:
    first = (getattr(user, "first_name", None) or "").strip()
    if first:
        return first.split()[0]
    return "A buyer"


def seller_verified_badge(user) -> bool:
    if user is None:
        return False
    if getattr(user, "is_verified", False):
        return True
    created = getattr(user, "created_at", None)
    if created is None:
        return False
    from datetime import datetime, timedelta

    return datetime.utcnow() - created >= timedelta(days=30)
