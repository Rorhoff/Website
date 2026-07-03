"""Web push helpers for In the Wild venue proximity alerts."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

log = logging.getLogger(__name__)


def vapid_public_key() -> str | None:
    key = (os.environ.get("ITW_VAPID_PUBLIC_KEY") or "").strip()
    return key or None


def push_configured() -> bool:
    return bool(
        vapid_public_key()
        and (os.environ.get("ITW_VAPID_PRIVATE_KEY") or "").strip()
        and (os.environ.get("ITW_VAPID_SUBJECT") or "mailto:noreply@rorhoff.com").strip()
    )


def send_web_push(
    *,
    endpoint: str,
    p256dh: str,
    auth: str,
    title: str,
    body: str,
    url: str,
    tag: str | None = None,
) -> bool:
    if not push_configured():
        return False
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        log.warning("pywebpush not installed; skipping web push")
        return False

    payload: dict[str, Any] = {"title": title, "body": body, "url": url}
    if tag:
        payload["tag"] = tag

    try:
        webpush(
            subscription_info={
                "endpoint": endpoint,
                "keys": {"p256dh": p256dh, "auth": auth},
            },
            data=json.dumps(payload),
            vapid_private_key=os.environ["ITW_VAPID_PRIVATE_KEY"].strip(),
            vapid_claims={"sub": os.environ.get("ITW_VAPID_SUBJECT", "mailto:noreply@rorhoff.com").strip()},
        )
        return True
    except WebPushException as exc:
        log.warning("Web push failed endpoint=%s status=%s", endpoint[:80], getattr(exc, "response", None))
        return False
    except Exception:
        log.exception("Web push failed endpoint=%s", endpoint[:80])
        return False
