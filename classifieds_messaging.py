"""
Classifieds messaging + magic-link auth (Sprint 1 MVP).

Routes are registered on the main classifieds router via register_messaging_routes().
"""

from __future__ import annotations

import hashlib
import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

import email_service
from classifieds_privacy import buyer_display_name, seller_display_name
from database import SessionLocal
from models import (
    ClassifiedAd,
    ClassifiedConversation,
    ClassifiedMagicLinkToken,
    ClassifiedMessage,
    ClassifiedUser,
)

log = logging.getLogger("classifieds-messaging")

MAGIC_LINK_TTL = timedelta(
    hours=int(__import__("os").environ.get("MAGIC_LINK_TTL_HOURS", "24"))
)
MAGIC_LINK_RATE_PER_HOUR = 5
BUYER_MESSAGE_MAX = 500
SELLER_MESSAGE_MAX = 1000

PRESET_MESSAGES: dict[str, str] = {
    "is_available": "Is this still available?",
    "lowest_price": "What's your lowest price?",
    "more_photos": "Can you send more photos?",
    "location_area": "Where are you located? (general area)",
    "come_see": "When can I come see it?",
    "original_owner": "Are you the original owner?",
    "everything_shown": "Does it come with everything shown in the photos?",
    "will_ship": "Will you ship?",
    "buy_at_asking": "I'd like to buy this at asking price",
    "other": "",
}


def _token_hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _conversation_url(conversation_id: str) -> str:
    return f"{email_service.public_base_url()}/#/messages/{conversation_id}"


def _listing_thumb(ad: ClassifiedAd) -> str:
    imgs = list(ad.images or [])
    return imgs[0] if imgs else ""


# --- Pydantic bodies ---


class MagicLinkRequestBody(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    openAd: str | None = Field(default=None, max_length=36)
    openInbox: bool = False


class MagicLinkExchangeBody(BaseModel):
    token: str = Field(min_length=16, max_length=128)


class SendMessageBody(BaseModel):
    adId: str = Field(min_length=1, max_length=36)
    presetKey: str | None = Field(default=None, max_length=64)
    body: str | None = Field(default=None, max_length=BUYER_MESSAGE_MAX)


class ReplyBody(BaseModel):
    body: str = Field(min_length=1, max_length=SELLER_MESSAGE_MAX)


# --- Registration on parent router ---


def register_messaging_routes(
    router: APIRouter,
    *,
    classifieds_db: Any,
    get_current_classified_user: Any,
    create_session: Any,
    user_out: Any,
    is_aggregated_import: Any,
) -> None:
    """Attach messaging endpoints to the existing /api/classifieds router."""

    def _resolve_message_body(preset_key: str | None, body: str | None) -> tuple[str, str, str | None]:
        key = (preset_key or "").strip()
        custom = (body or "").strip()
        if key and key != "other":
            if key not in PRESET_MESSAGES:
                raise HTTPException(status_code=400, detail="Unknown preset message.")
            text = PRESET_MESSAGES[key]
            if not text:
                raise HTTPException(status_code=400, detail="Preset requires custom text.")
            return text, "preset", key
        if custom:
            if len(custom) > BUYER_MESSAGE_MAX:
                raise HTTPException(status_code=400, detail="Message too long.")
            return custom, "custom", key or None
        raise HTTPException(status_code=400, detail="Select a preset or enter a message.")

    def _find_or_create_user_by_email(db: Session, email: str) -> ClassifiedUser:
        normalized = email.strip().lower()
        user = db.scalars(
            select(ClassifiedUser).where(func.lower(ClassifiedUser.email) == normalized)
        ).first()
        if user is not None:
            return user
        uname = f"buyer_{secrets.token_hex(4)}"
        while db.scalars(select(ClassifiedUser).where(ClassifiedUser.username == uname)).first():
            uname = f"buyer_{secrets.token_hex(4)}"
        user = ClassifiedUser(
            username=uname,
            email=email.strip(),
            phone="",
            state="",
            password_hash=None,
            is_lightweight=True,
            email_verified_at=datetime.utcnow(),
        )
        db.add(user)
        db.flush()
        return user

    @router.post("/auth/magic-link")
    def request_magic_link(
        body: MagicLinkRequestBody,
        request: Request,
        db: Session = Depends(classifieds_db),
    ):
        email = body.email.strip()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise HTTPException(status_code=400, detail="Invalid email address.")
        since = datetime.utcnow() - timedelta(hours=1)
        recent = db.scalar(
            select(func.count())
            .select_from(ClassifiedMagicLinkToken)
            .where(
                func.lower(ClassifiedMagicLinkToken.email) == email.lower(),
                ClassifiedMagicLinkToken.created_at >= since,
            )
        )
        if int(recent or 0) >= MAGIC_LINK_RATE_PER_HOUR:
            raise HTTPException(
                status_code=429,
                detail="Too many sign-in emails. Try again in an hour.",
            )

        raw = secrets.token_urlsafe(32)
        redirect_bits: list[str] = []
        if body.openAd:
            redirect_bits.append(f"openAd={body.openAd.strip()}")
        if body.openInbox:
            redirect_bits.append("openInbox=true")
        redirect_path = "&".join(redirect_bits) if redirect_bits else ""

        seller_name: str | None = None
        if body.openAd:
            ad = db.get(ClassifiedAd, body.openAd.strip())
            if ad and ad.user_id:
                seller = db.get(ClassifiedUser, ad.user_id)
                if seller:
                    seller_name = seller_display_name(seller)

        row = ClassifiedMagicLinkToken(
            id=str(uuid.uuid4()),
            email=email,
            token_hash=_token_hash(raw),
            redirect_path=redirect_path,
            expires_at=datetime.utcnow() + MAGIC_LINK_TTL,
            ip_address=(request.client.host if request.client else None),
        )
        db.add(row)
        db.commit()

        base = email_service.public_base_url()
        qs = f"ml_token={raw}"
        if redirect_path:
            qs = f"{qs}&{redirect_path}"
        sign_in_url = f"{base}/?{qs}"

        email_service.send_magic_link_email(
            to=email, sign_in_url=sign_in_url, seller_first_name=seller_name
        )
        return {"ok": True}

    @router.post("/auth/magic-link/exchange")
    def exchange_magic_link(
        body: MagicLinkExchangeBody,
        db: Session = Depends(classifieds_db),
    ):
        th = _token_hash(body.token.strip())
        row = db.scalars(
            select(ClassifiedMagicLinkToken).where(ClassifiedMagicLinkToken.token_hash == th)
        ).first()
        if row is None or row.used_at is not None or row.expires_at < datetime.utcnow():
            raise HTTPException(status_code=400, detail="Invalid or expired sign-in link.")
        user = _find_or_create_user_by_email(db, row.email)
        if user.email_verified_at is None:
            user.email_verified_at = datetime.utcnow()
        row.used_at = datetime.utcnow()
        db.add(row)
        db.add(user)
        db.commit()
        session_token = create_session(db, user.id)
        payload: dict[str, Any] = {"token": session_token, "user": user_out(user)}
        if row.redirect_path:
            for part in row.redirect_path.split("&"):
                if part.startswith("openAd="):
                    payload["openAd"] = part[7:]
                elif part == "openInbox=true":
                    payload["openInbox"] = True
        return payload

    def _conversation_out(
        db: Session,
        conv: ClassifiedConversation,
        viewer: ClassifiedUser,
        *,
        include_thread: bool = False,
    ) -> dict[str, Any]:
        ad = db.get(ClassifiedAd, conv.listing_id)
        buyer = db.get(ClassifiedUser, conv.buyer_user_id)
        seller = db.get(ClassifiedUser, conv.seller_user_id)
        is_buyer = viewer.id == conv.buyer_user_id
        other = seller if is_buyer else buyer
        if is_buyer:
            other_party = seller_display_name(other) if other else "Seller"
        else:
            other_party = buyer_display_name(other) if other else "A buyer"
        last_msg = db.scalars(
            select(ClassifiedMessage)
            .where(ClassifiedMessage.conversation_id == conv.id)
            .order_by(ClassifiedMessage.created_at.desc())
            .limit(1)
        ).first()
        unread = db.scalar(
            select(func.count())
            .select_from(ClassifiedMessage)
            .where(
                ClassifiedMessage.conversation_id == conv.id,
                ClassifiedMessage.sender_user_id != viewer.id,
                ClassifiedMessage.is_read.is_(False),
            )
        )
        out: dict[str, Any] = {
            "id": conv.id,
            "listingId": conv.listing_id,
            "listingTitle": ad.title if ad else "",
            "listingThumb": _listing_thumb(ad) if ad else "",
            "otherPartyName": other_party,
            "lastMessagePreview": (last_msg.body[:120] if last_msg else ""),
            "lastMessageAt": int(conv.last_message_at.timestamp() * 1000),
            "unreadCount": int(unread or 0),
            "status": conv.status,
            "viewerRole": "buyer" if is_buyer else "seller",
        }
        if include_thread and ad:
            msgs = db.scalars(
                select(ClassifiedMessage)
                .where(ClassifiedMessage.conversation_id == conv.id)
                .order_by(ClassifiedMessage.created_at.asc())
            ).all()
            out["messages"] = [
                {
                    "id": m.id,
                    "senderUserId": m.sender_user_id,
                    "isMine": m.sender_user_id == viewer.id,
                    "senderLabel": "You"
                    if m.sender_user_id == viewer.id
                    else out["otherPartyName"],
                    "messageType": m.message_type,
                    "presetKey": m.preset_key,
                    "body": m.body,
                    "createdAt": int(m.created_at.timestamp() * 1000),
                }
                for m in msgs
            ]
            out["listingUrl"] = f"{email_service.public_base_url()}/?openAd={ad.id}"
        return out

    @router.get("/messages")
    def list_conversations(
        user: ClassifiedUser = Depends(get_current_classified_user),
        db: Session = Depends(classifieds_db),
    ):
        rows = db.scalars(
            select(ClassifiedConversation)
            .where(
                or_(
                    ClassifiedConversation.buyer_user_id == user.id,
                    ClassifiedConversation.seller_user_id == user.id,
                ),
                ClassifiedConversation.status == "active",
            )
            .order_by(ClassifiedConversation.last_message_at.desc())
        ).all()
        conversations = [_conversation_out(db, c, user) for c in rows]
        unread_total = sum(c["unreadCount"] for c in conversations)
        return {"conversations": conversations, "unreadCount": unread_total}

    @router.get("/messages/{conversation_id}")
    def get_conversation(
        conversation_id: str,
        user: ClassifiedUser = Depends(get_current_classified_user),
        db: Session = Depends(classifieds_db),
    ):
        conv = db.get(ClassifiedConversation, conversation_id)
        if conv is None:
            raise HTTPException(status_code=404, detail="Conversation not found.")
        if user.id not in (conv.buyer_user_id, conv.seller_user_id):
            raise HTTPException(status_code=403, detail="Not allowed.")
        db.execute(
            update(ClassifiedMessage)
            .where(
                ClassifiedMessage.conversation_id == conv.id,
                ClassifiedMessage.sender_user_id != user.id,
                ClassifiedMessage.is_read.is_(False),
            )
            .values(is_read=True)
        )
        db.commit()
        return _conversation_out(db, conv, user, include_thread=True)

    @router.post("/messages")
    def send_first_message(
        body: SendMessageBody,
        user: ClassifiedUser = Depends(get_current_classified_user),
        db: Session = Depends(classifieds_db),
        is_aggregated_import=is_aggregated_import,
    ):
        ad = db.get(ClassifiedAd, body.adId)
        if ad is None:
            raise HTTPException(status_code=404, detail="Ad not found.")
        if is_aggregated_import(ad):
            raise HTTPException(
                status_code=400,
                detail="Contact the seller on the original listing site.",
            )
        if ad.user_id is None:
            raise HTTPException(status_code=400, detail="Seller account unavailable.")
        if ad.user_id == user.id:
            raise HTTPException(status_code=400, detail="You cannot message your own ad.")
        seller = db.get(ClassifiedUser, ad.user_id)
        if seller is None:
            raise HTTPException(status_code=400, detail="Seller account unavailable.")

        text, msg_type, preset_key = _resolve_message_body(body.presetKey, body.body)
        conv = db.scalars(
            select(ClassifiedConversation).where(
                ClassifiedConversation.listing_id == ad.id,
                ClassifiedConversation.buyer_user_id == user.id,
            )
        ).first()
        now = datetime.utcnow()
        if conv is None:
            conv = ClassifiedConversation(
                id=str(uuid.uuid4()),
                listing_id=ad.id,
                buyer_user_id=user.id,
                seller_user_id=seller.id,
                status="active",
                created_at=now,
                last_message_at=now,
            )
            db.add(conv)
        msg = ClassifiedMessage(
            id=str(uuid.uuid4()),
            conversation_id=conv.id,
            sender_user_id=user.id,
            message_type=msg_type,
            preset_key=preset_key,
            body=text,
            is_read=False,
        )
        conv.last_message_at = now
        db.add(msg)
        db.add(conv)
        db.commit()

        if getattr(seller, "email_notifications_enabled", True):
            email_service.send_new_inquiry_to_seller(
                to=seller.email,
                listing_title=ad.title,
                buyer_name=buyer_display_name(user),
                message_preview=text,
                conversation_url=_conversation_url(conv.id),
            )
        return {"conversationId": conv.id, "messageId": msg.id}

    @router.post("/messages/{conversation_id}/reply")
    def reply_in_conversation(
        conversation_id: str,
        body: ReplyBody,
        user: ClassifiedUser = Depends(get_current_classified_user),
        db: Session = Depends(classifieds_db),
    ):
        conv = db.get(ClassifiedConversation, conversation_id)
        if conv is None:
            raise HTTPException(status_code=404, detail="Conversation not found.")
        if user.id not in (conv.buyer_user_id, conv.seller_user_id):
            raise HTTPException(status_code=403, detail="Not allowed.")
        if conv.status != "active":
            raise HTTPException(status_code=400, detail="Conversation is not active.")

        text = body.body.strip()
        max_len = SELLER_MESSAGE_MAX if user.id == conv.seller_user_id else BUYER_MESSAGE_MAX
        if len(text) > max_len:
            raise HTTPException(status_code=400, detail="Message too long.")

        now = datetime.utcnow()
        msg = ClassifiedMessage(
            id=str(uuid.uuid4()),
            conversation_id=conv.id,
            sender_user_id=user.id,
            message_type="custom",
            preset_key=None,
            body=text,
            is_read=False,
        )
        conv.last_message_at = now
        db.add(msg)
        db.add(conv)
        db.commit()

        ad = db.get(ClassifiedAd, conv.listing_id)
        listing_title = ad.title if ad else "your listing"
        notify_user_id = (
            conv.buyer_user_id if user.id == conv.seller_user_id else conv.seller_user_id
        )
        notify = db.get(ClassifiedUser, notify_user_id)
        if notify and getattr(notify, "email_notifications_enabled", True):
            if user.id == conv.seller_user_id:
                email_service.send_seller_reply_to_buyer(
                    to=notify.email,
                    seller_name=seller_display_name(user),
                    listing_title=listing_title,
                    message_preview=text,
                    conversation_url=_conversation_url(conv.id),
                )
            else:
                seller = db.get(ClassifiedUser, conv.seller_user_id)
                if seller:
                    email_service.send_new_inquiry_to_seller(
                        to=seller.email,
                        listing_title=listing_title,
                        buyer_name=buyer_display_name(user),
                        message_preview=text,
                        conversation_url=_conversation_url(conv.id),
                    )
        return {"messageId": msg.id}

    @router.post("/messages/{conversation_id}/share-contact")
    def share_contact_in_conversation(
        conversation_id: str,
        user: ClassifiedUser = Depends(get_current_classified_user),
        db: Session = Depends(classifieds_db),
    ):
        conv = db.get(ClassifiedConversation, conversation_id)
        if conv is None:
            raise HTTPException(status_code=404, detail="Conversation not found.")
        if user.id != conv.seller_user_id:
            raise HTTPException(
                status_code=403, detail="Only the seller can share contact info."
            )
        if conv.status != "active":
            raise HTTPException(status_code=400, detail="Conversation is not active.")

        buyer = db.get(ClassifiedUser, conv.buyer_user_id)
        if buyer is None:
            raise HTTPException(status_code=400, detail="Buyer account unavailable.")

        phone = (user.phone or "").strip()
        email_addr = (user.email or "").strip()
        seller_name = seller_display_name(user)
        body = (
            f"{seller_name} shared contact info:\n"
            f"Phone: {phone or '(not provided)'}\n"
            f"Email: {email_addr or '(not provided)'}"
        )

        now = datetime.utcnow()
        msg = ClassifiedMessage(
            id=str(uuid.uuid4()),
            conversation_id=conv.id,
            sender_user_id=user.id,
            message_type="contact_share",
            preset_key=None,
            body=body,
            is_read=False,
        )
        conv.last_message_at = now
        db.add(msg)
        db.add(conv)
        db.commit()

        ad = db.get(ClassifiedAd, conv.listing_id)
        listing_title = ad.title if ad else "your listing"
        if getattr(buyer, "email_notifications_enabled", True):
            email_service.send_contact_shared_to_buyer(
                to=buyer.email,
                seller_name=seller_name,
                phone=phone,
                email=email_addr,
                listing_title=listing_title,
                conversation_url=_conversation_url(conv.id),
            )
        return {"messageId": msg.id, "ok": True}
