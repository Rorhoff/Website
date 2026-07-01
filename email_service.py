"""Transactional email via AWS SES (optional in dev)."""

from __future__ import annotations

import logging
import os
from typing import Any

log = logging.getLogger("classifieds-email")

_HEADER_HTML = (
    '<div style="color:#1E2A4A;font-size:24px;font-weight:bold;">t1Classifieds</div>'
)
_FOOTER_HTML = (
    "<p style=\"color:#64748b;font-size:12px;line-height:1.5;\">"
    "t1Classifieds, operated by RedA1, LLC<br>"
    "12760 S Park Ave, Ste 1127, Riverton, UT 84065<br><br>"
    "Replies to this email are not monitored. Respond in the t1Classifieds app."
    "</p>"
)


def public_base_url() -> str:
    raw = (os.environ.get("CLASSIFIEDS_PUBLIC_URL") or "https://t1classifieds.com").strip()
    return raw.rstrip("/")


def email_enabled() -> bool:
    if os.environ.get("EMAIL_DEV_LOG_ONLY", "").strip().lower() in ("1", "true", "yes"):
        return False
    return bool(os.environ.get("AWS_SES_REGION") or os.environ.get("CLASSIFIEDS_EMAIL_FROM"))


def _from_address() -> str:
    return (os.environ.get("CLASSIFIEDS_EMAIL_FROM") or "noreply@t1classifieds.com").strip()


def _wrap_html(body_html: str) -> str:
    return (
        f'<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;">'
        f"{_HEADER_HTML}<div style=\"margin:24px 0;\">{body_html}</div>{_FOOTER_HTML}</div>"
    )


def _button(href: str, label: str) -> str:
    return (
        f'<p style="margin:24px 0;">'
        f'<a href="{href}" style="display:inline-block;background:#F59E0B;color:#1E2A4A;'
        f'font-weight:700;text-decoration:none;padding:12px 20px;border-radius:8px;">'
        f"{label}</a></p>"
    )


def send_email(*, to: str, subject: str, html_body: str, text_body: str) -> bool:
    to = to.strip()
    if not to:
        return False
    if os.environ.get("EMAIL_DEV_LOG_ONLY", "").strip().lower() in ("1", "true", "yes"):
        log.info("EMAIL_DEV_LOG_ONLY to=%s subject=%s\n%s", to, subject, text_body)
        return True
    region = (os.environ.get("AWS_SES_REGION") or "us-west-1").strip()
    try:
        import boto3
    except ImportError:
        log.warning("boto3 not installed; cannot send email to %s", to)
        return False
    client = boto3.client("ses", region_name=region)
    try:
        client.send_email(
            Source=_from_address(),
            Destination={"ToAddresses": [to]},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {
                    "Html": {"Data": _wrap_html(html_body), "Charset": "UTF-8"},
                    "Text": {"Data": text_body, "Charset": "UTF-8"},
                },
            },
        )
        log.info("SES sent subject=%r to=%s", subject, to)
        return True
    except Exception as exc:
        log.error("SES send failed to=%s subject=%s: %s", to, subject, exc)
        log.exception("SES send failed (full traceback)")
        return False


def send_password_reset_email(*, to: str, reset_url: str) -> bool:
    subject = "Reset your t1Classifieds password"
    text = (
        "Use the link below to choose a new password (expires in 1 hour):\n\n"
        f"{reset_url}\n\n"
        "If you did not request this, ignore this email. Your password will not change."
    )
    html = (
        "<p>Use the button below to choose a new password.</p>"
        f"{_button(reset_url, 'Reset password')}"
        '<p style="color:#64748b;font-size:14px;">'
        "This link expires in 1 hour and works once."
        "</p>"
    )
    return send_email(to=to, subject=subject, html_body=html, text_body=text)


def send_magic_link_email(*, to: str, sign_in_url: str, seller_first_name: str | None) -> bool:
    seller = (seller_first_name or "the seller").strip()
    subject = f"Sign in to t1Classifieds to message {seller}"
    text = (
        f"Click the link below to sign in (expires in 24 hours):\n\n{sign_in_url}\n\n"
        "If you did not request this, ignore this email."
    )
    html = (
        f"<p>Sign in to send a message to <strong>{seller}</strong>.</p>"
        f"{_button(sign_in_url, 'Sign in')}"
        "<p style=\"color:#64748b;font-size:14px;\">This link expires in 24 hours and works once.</p>"
    )
    return send_email(to=to, subject=subject, html_body=html, text_body=text)


def send_new_inquiry_to_seller(
    *,
    to: str,
    listing_title: str,
    buyer_name: str,
    message_preview: str,
    conversation_url: str,
) -> bool:
    subject = f"New inquiry on your listing: {listing_title}"
    text = (
        f"{buyer_name} sent a message about \"{listing_title}\":\n\n"
        f"{message_preview}\n\n"
        f"Reply in the app: {conversation_url}\n\n"
        "Never share financial info or wire money."
    )
    html = (
        f"<p><strong>{buyer_name}</strong> sent a message about "
        f"<strong>{listing_title}</strong>:</p>"
        f'<p style="background:#f8fafc;padding:12px;border-radius:8px;">'
        f"{message_preview}</p>"
        f"{_button(conversation_url, 'Reply in app')}"
        '<p style="color:#64748b;font-size:13px;">'
        "Never share financial info or wire money. "
        '<a href="https://t1classifieds.com/classifieds/safety.html">Safety tips</a>'
        "</p>"
    )
    return send_email(to=to, subject=subject, html_body=html, text_body=text)


def send_seller_reply_to_buyer(
    *,
    to: str,
    seller_name: str,
    listing_title: str,
    message_preview: str,
    conversation_url: str,
) -> bool:
    subject = f"{seller_name} replied about {listing_title}"
    text = (
        f"{seller_name} replied about \"{listing_title}\":\n\n"
        f"{message_preview}\n\nView reply: {conversation_url}"
    )
    html = (
        f"<p><strong>{seller_name}</strong> replied about "
        f"<strong>{listing_title}</strong>:</p>"
        f'<p style="background:#f8fafc;padding:12px;border-radius:8px;">'
        f"{message_preview}</p>"
        f"{_button(conversation_url, 'View reply')}"
    )
    return send_email(to=to, subject=subject, html_body=html, text_body=text)


def send_contact_shared_to_buyer(
    *,
    to: str,
    seller_name: str,
    phone: str,
    email: str,
    listing_title: str,
    conversation_url: str,
) -> bool:
    subject = f"{seller_name} shared their contact info"
    text = (
        f"{seller_name} shared contact info for \"{listing_title}\":\n\n"
        f"Phone: {phone or '(not provided)'}\n"
        f"Email: {email}\n\n"
        f"View conversation: {conversation_url}\n\n"
        "Never share financial info or wire money."
    )
    html = (
        f"<p><strong>{seller_name}</strong> shared contact info for "
        f"<strong>{listing_title}</strong>:</p>"
        f"<p>Phone: {phone or '(not provided)'}<br>Email: {email}</p>"
        f"{_button(conversation_url, 'View conversation')}"
        '<p style="color:#64748b;font-size:13px;">'
        "Never share financial info or wire money."
        "</p>"
    )
    return send_email(to=to, subject=subject, html_body=html, text_body=text)


# --- In the Wild (portfolio app) ---

_ITW_HEADER_HTML = (
    '<div style="color:#059669;font-size:24px;font-weight:bold;">In the Wild</div>'
    '<div style="color:#64748b;font-size:14px;margin-top:4px;">Match where you actually are.</div>'
)
_ITW_FOOTER_HTML = (
    "<p style=\"color:#64748b;font-size:12px;line-height:1.5;\">"
    "Replies to this email are not monitored. Open the app to chat."
    "</p>"
)


def itw_public_base_url() -> str:
    raw = (os.environ.get("ITW_PUBLIC_URL") or "https://rorhoff.com/in-the-wild").strip()
    return raw.rstrip("/")


def _itw_from_address() -> str:
    return (
        os.environ.get("ITW_EMAIL_FROM")
        or os.environ.get("CLASSIFIEDS_EMAIL_FROM")
        or "noreply@rorhoff.com"
    ).strip()


def _wrap_itw_html(body_html: str) -> str:
    return (
        f'<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;">'
        f"{_ITW_HEADER_HTML}<div style=\"margin:24px 0;\">{body_html}</div>{_ITW_FOOTER_HTML}</div>"
    )


def _itw_button(href: str, label: str) -> str:
    return (
        f'<p style="margin:24px 0;">'
        f'<a href="{href}" style="display:inline-block;background:#059669;color:#ffffff;'
        f'font-weight:700;text-decoration:none;padding:12px 20px;border-radius:8px;">'
        f"{label}</a></p>"
    )


def send_itw_email(*, to: str, subject: str, html_body: str, text_body: str) -> bool:
    to = to.strip()
    if not to:
        return False
    if os.environ.get("EMAIL_DEV_LOG_ONLY", "").strip().lower() in ("1", "true", "yes"):
        log.info("ITW EMAIL_DEV_LOG_ONLY to=%s subject=%s\n%s", to, subject, text_body)
        return True
    region = (os.environ.get("AWS_SES_REGION") or "us-west-1").strip()
    try:
        import boto3
    except ImportError:
        log.warning("boto3 not installed; cannot send In the Wild email to %s", to)
        return False
    client = boto3.client("ses", region_name=region)
    try:
        client.send_email(
            Source=_itw_from_address(),
            Destination={"ToAddresses": [to]},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {
                    "Html": {"Data": _wrap_itw_html(html_body), "Charset": "UTF-8"},
                    "Text": {"Data": text_body, "Charset": "UTF-8"},
                },
            },
        )
        log.info("ITW SES sent subject=%r to=%s", subject, to)
        return True
    except Exception as exc:
        log.error("ITW SES send failed to=%s subject=%s: %s", to, subject, exc)
        log.exception("ITW SES send failed (full traceback)")
        return False


def send_itw_venue_match_email(
    *,
    to: str,
    recipient_name: str,
    other_name: str,
    event_name: str,
    chat_hours: int = 6,
) -> bool:
    matches_url = f"{itw_public_base_url()}/#/matches"
    subject = f"You're both at {event_name}!"
    text = (
        f"Hi {recipient_name},\n\n"
        f"You and {other_name} are both at {event_name} with Open to Meeting on. "
        f"Say hello in person — you have {chat_hours} hours to coordinate in the app.\n\n"
        f"Open matches: {matches_url}\n"
    )
    html = (
        f"<p>Hi <strong>{recipient_name}</strong>,</p>"
        f"<p>You and <strong>{other_name}</strong> are both at "
        f"<strong>{event_name}</strong> with &quot;Open to Meeting&quot; on.</p>"
        f"<p>Say hello in person — you have <strong>{chat_hours} hours</strong> "
        f"to coordinate in the app.</p>"
        f"{_itw_button(matches_url, 'Open matches')}"
    )
    return send_itw_email(to=to, subject=subject, html_body=html, text_body=text)


# --- In the Wild (portfolio app) ---

_ITW_HEADER_HTML = (
    '<div style="color:#059669;font-size:24px;font-weight:bold;">In the Wild</div>'
    '<div style="color:#64748b;font-size:14px;margin-top:4px;">Match where you actually are.</div>'
)
_ITW_FOOTER_HTML = (
    "<p style=\"color:#64748b;font-size:12px;line-height:1.5;\">"
    "Replies to this email are not monitored. Open the app to chat."
    "</p>"
)


def itw_public_base_url() -> str:
    raw = (os.environ.get("ITW_PUBLIC_URL") or "https://rorhoff.com/in-the-wild").strip()
    return raw.rstrip("/")


def _itw_from_address() -> str:
    return (
        os.environ.get("ITW_EMAIL_FROM")
        or os.environ.get("CLASSIFIEDS_EMAIL_FROM")
        or "noreply@rorhoff.com"
    ).strip()


def _wrap_itw_html(body_html: str) -> str:
    return (
        f'<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;">'
        f"{_ITW_HEADER_HTML}<div style=\"margin:24px 0;\">{body_html}</div>{_ITW_FOOTER_HTML}</div>"
    )


def _itw_button(href: str, label: str) -> str:
    return (
        f'<p style="margin:24px 0;">'
        f'<a href="{href}" style="display:inline-block;background:#059669;color:#ffffff;'
        f'font-weight:700;text-decoration:none;padding:12px 20px;border-radius:8px;">'
        f"{label}</a></p>"
    )


def send_itw_email(*, to: str, subject: str, html_body: str, text_body: str) -> bool:
    to = to.strip()
    if not to:
        return False
    if os.environ.get("EMAIL_DEV_LOG_ONLY", "").strip().lower() in ("1", "true", "yes"):
        log.info("ITW EMAIL_DEV_LOG_ONLY to=%s subject=%s\n%s", to, subject, text_body)
        return True
    region = (os.environ.get("AWS_SES_REGION") or "us-west-1").strip()
    try:
        import boto3
    except ImportError:
        log.warning("boto3 not installed; cannot send In the Wild email to %s", to)
        return False
    client = boto3.client("ses", region_name=region)
    try:
        client.send_email(
            Source=_itw_from_address(),
            Destination={"ToAddresses": [to]},
            Message={
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {
                    "Html": {"Data": _wrap_itw_html(html_body), "Charset": "UTF-8"},
                    "Text": {"Data": text_body, "Charset": "UTF-8"},
                },
            },
        )
        log.info("ITW SES sent subject=%r to=%s", subject, to)
        return True
    except Exception as exc:
        log.error("ITW SES send failed to=%s subject=%s: %s", to, subject, exc)
        log.exception("ITW SES send failed (full traceback)")
        return False


def send_itw_venue_match_email(
    *,
    to: str,
    recipient_name: str,
    other_name: str,
    event_name: str,
    chat_hours: int = 6,
) -> bool:
    matches_url = f"{itw_public_base_url()}/#/matches"
    subject = f"You're both at {event_name}!"
    text = (
        f"Hi {recipient_name},\n\n"
        f"You and {other_name} are both at {event_name} with Open to Meeting on. "
        f"Say hello in person — you have {chat_hours} hours to coordinate in the app.\n\n"
        f"Open matches: {matches_url}\n"
    )
    html = (
        f"<p>Hi <strong>{recipient_name}</strong>,</p>"
        f"<p>You and <strong>{other_name}</strong> are both at "
        f"<strong>{event_name}</strong> with &quot;Open to Meeting&quot; on.</p>"
        f"<p>Say hello in person — you have <strong>{chat_hours} hours</strong> "
        f"to coordinate in the app.</p>"
        f"{_itw_button(matches_url, 'Open matches')}"
    )
    return send_itw_email(to=to, subject=subject, html_body=html, text_body=text)
