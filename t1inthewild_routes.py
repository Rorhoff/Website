"""
In the Wild REST API — event-based dating with venue-unlocked matches.

Mounted at /api/in-the-wild on rorhoff.com (SERVICE_MODE=full).
"""

from __future__ import annotations

import base64
import logging
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Request, UploadFile, status
from passlib.hash import bcrypt as bcrypt_hasher
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.orm import Session

import image_storage
import email_service
import itw_geocode
import itw_push
from credential_service import truncate_for_bcrypt
from database import SessionLocal
from itw_events import (
    EVENT_DISCOVERY_RADIUS_M,
    EVENT_DISCOVERY_RADIUS_MILES,
    event_within_radius,
    is_duplicate_submission,
)
from itw_preferences import (
    compatibility_pct,
    interest_overlap_pct,
    normalize_gender,
    normalize_looking_for,
    profile_preferences_complete,
    profiles_compatible,
    validate_birth_year as validate_birth_year_value,
    vicinity_score_pct,
)
from models import (
    T1IntheWildCheckIn,
    T1IntheWildEvent,
    T1IntheWildEventPlan,
    T1IntheWildEventPlanAlert,
    T1IntheWildLike,
    T1IntheWildMatch,
    T1IntheWildMessage,
    T1IntheWildPushSubscription,
    T1IntheWildSession,
    T1IntheWildUser,
    T1IntheWildUserBlock,
    T1IntheWildUserReport,
    T1IntheWildWaitlist,
)

log = logging.getLogger("webapi-testing")

router = APIRouter(prefix="/api/in-the-wild", tags=["in-the-wild"])

SESSION_HOURS = 24 * 30
MATCH_CHAT_HOURS = 6
PASS_COOLDOWN_DAYS = 30
USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{3,32}$")
MAX_AVATAR_BYTES = 4 * 1024 * 1024
_INLINE_AVATAR_MAX_BYTES = 512 * 1024
_DEV_LOUNGE_CATEGORY = "dev_lounge"
_SPOT_CATEGORY = "spot"
SPOT_MERGE_RADIUS_M = 80
SPOT_CHECKIN_HOURS = 4
SPOT_EVENT_RADIUS_M = 120
GPS_DISCOVERY_RADIUS_MILES = 25
GPS_DISCOVERY_RADIUS_M = int(GPS_DISCOVERY_RADIUS_MILES * 1609.344)
ID_VERIFY_REQUIRED_FOR_CHAT = False
VENUE_MATCH_PROXIMITY_M = 30.48  # ~100 feet


def _db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _now() -> datetime:
    return datetime.utcnow()


def _utc_naive(dt: datetime) -> datetime:
    """Normalize API datetimes to naive UTC for DB storage and comparisons."""
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _is_full_dev_mode() -> bool:
    return os.getenv("SERVICE_MODE", "full").lower() == "full"


def _validate_birth_year(birth_year: int) -> None:
    try:
        validate_birth_year_value(birth_year)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _validate_gender(value: str) -> str:
    try:
        return normalize_gender(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _validate_looking_for(value: str) -> str:
    try:
        return normalize_looking_for(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _profile_preferences_complete(u: T1IntheWildUser) -> bool:
    return profile_preferences_complete(u.gender, u.looking_for)


def _profiles_compatible(a: T1IntheWildUser, b: T1IntheWildUser) -> bool:
    return profiles_compatible(a.gender, a.looking_for, b.gender, b.looking_for)


def _shrink_avatar_for_inline(content: bytes, content_type: str) -> tuple[bytes, str]:
    import io

    from PIL import Image

    img = Image.open(io.BytesIO(content))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    img.thumbnail((800, 800), Image.Resampling.LANCZOS)
    quality = 85
    while quality >= 40:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        data = buf.getvalue()
        if len(data) <= _INLINE_AVATAR_MAX_BYTES:
            return data, "image/jpeg"
        quality -= 10
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=40, optimize=True)
    return buf.getvalue(), "image/jpeg"


def _hidden_user_ids(db: Session, user_id: str) -> set[str]:
    blocked = db.scalars(
        select(T1IntheWildUserBlock.blocked_id).where(T1IntheWildUserBlock.blocker_id == user_id)
    ).all()
    blockers = db.scalars(
        select(T1IntheWildUserBlock.blocker_id).where(T1IntheWildUserBlock.blocked_id == user_id)
    ).all()
    return set(blocked) | set(blockers)


def _require_admin(user: T1IntheWildUser) -> None:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")


def _require_id_verified(user: T1IntheWildUser) -> None:
    if not user.id_verified:
        raise HTTPException(
            status_code=403,
            detail="Verify your identity before messaging. Go to Profile → Identity verification.",
        )


def _match_other_user(match: T1IntheWildMatch, me_id: str, db: Session) -> T1IntheWildUser | None:
    other_id = match.user_b_id if match.user_a_id == me_id else match.user_a_id
    return db.get(T1IntheWildUser, other_id)


def _chat_send_eligibility(user: T1IntheWildUser, match: T1IntheWildMatch, db: Session) -> dict[str, Any]:
    other = _match_other_user(match, user.id, db)
    if not ID_VERIFY_REQUIRED_FOR_CHAT:
        return {
            "can_send": True,
            "can_read": True,
            "other_id_verified": bool(other and other.id_verified),
            "block_reason": None,
        }
    can_send = bool(user.id_verified and other and other.id_verified)
    reasons: list[str] = []
    if not user.id_verified:
        reasons.append("Verify your identity in Profile before sending messages.")
    if other and not other.id_verified:
        reasons.append("Your match must verify their identity before chat unlocks.")
    return {
        "can_send": can_send,
        "can_read": True,
        "other_id_verified": bool(other and other.id_verified),
        "block_reason": " ".join(reasons) if reasons else None,
    }


def _require_can_send_message(user: T1IntheWildUser, match: T1IntheWildMatch, db: Session) -> None:
    elig = _chat_send_eligibility(user, match, db)
    if not elig["can_send"]:
        raise HTTPException(status_code=403, detail=elig["block_reason"] or "Chat unavailable")


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    from itw_events import haversine_m

    return haversine_m(lat1, lon1, lat2, lon2)


def _sync_user_city_coords(user: T1IntheWildUser, db: Session) -> None:
    city = (user.city or "").strip()
    if not city:
        user.city_latitude = None
        user.city_longitude = None
        db.commit()
        return
    coords = itw_geocode.geocode_city(city)
    if coords:
        user.city_latitude, user.city_longitude = coords
    else:
        user.city_latitude = None
        user.city_longitude = None
    db.commit()
    db.refresh(user)


def _find_duplicate_event(
    db: Session,
    *,
    name: str,
    venue_name: str,
    city: str,
    starts_at: datetime,
) -> T1IntheWildEvent | None:
    candidates = db.scalars(
        select(T1IntheWildEvent).where(
            T1IntheWildEvent.is_active.is_(True),
            T1IntheWildEvent.ends_at >= _now() - timedelta(days=1),
        )
    ).all()
    for event in candidates:
        if is_duplicate_submission(
            existing_name=event.name,
            existing_venue=event.venue_name,
            existing_city=event.city,
            existing_starts=event.starts_at,
            submit_name=name,
            submit_venue=venue_name,
            submit_city=city,
            submit_starts=starts_at,
        ):
            return event
    return None


def _filter_events_for_user(
    events: list[T1IntheWildEvent],
    user: T1IntheWildUser | None,
    going_ids: set[str],
    *,
    gps_lat: float | None = None,
    gps_lng: float | None = None,
) -> tuple[list[T1IntheWildEvent], dict[str, Any]]:
    using_gps = gps_lat is not None and gps_lng is not None
    meta: dict[str, Any] = {
        "radius_miles": GPS_DISCOVERY_RADIUS_MILES if using_gps else EVENT_DISCOVERY_RADIUS_MILES,
        "city": (user.city or "").strip() if user else "",
        "needs_city": False,
        "geocode_ok": False,
        "using_gps": using_gps,
    }
    if using_gps:
        center_lat, center_lng = gps_lat, gps_lng
        meta["geocode_ok"] = True
        visible: list[T1IntheWildEvent] = []
        seen: set[str] = set()
        for event in events:
            if event.id in seen:
                continue
            include = (
                event.category == _DEV_LOUNGE_CATEGORY
                or event.id in going_ids
                or event_within_radius(
                    event.latitude, event.longitude, center_lat, center_lng, GPS_DISCOVERY_RADIUS_M
                )
            )
            if include:
                visible.append(event)
                seen.add(event.id)
        return visible, meta

    if not user or not (user.city or "").strip():
        meta["needs_city"] = True
        visible = [e for e in events if e.category == _DEV_LOUNGE_CATEGORY or e.id in going_ids]
        return visible, meta

    if user.city_latitude is None or user.city_longitude is None:
        meta["geocode_ok"] = False
        visible = [e for e in events if e.category == _DEV_LOUNGE_CATEGORY or e.id in going_ids]
        return visible, meta

    lat, lng = user.city_latitude, user.city_longitude
    meta["geocode_ok"] = True
    visible: list[T1IntheWildEvent] = []
    seen: set[str] = set()
    for event in events:
        if event.id in seen:
            continue
        include = (
            event.category == _DEV_LOUNGE_CATEGORY
            or event.id in going_ids
            or event_within_radius(event.latitude, event.longitude, lat, lng, EVENT_DISCOVERY_RADIUS_M)
        )
        if include:
            visible.append(event)
            seen.add(event.id)
    return visible, meta


def _profile_dict(u: T1IntheWildUser) -> dict[str, Any]:
    age = None
    if u.birth_year:
        age = _now().year - u.birth_year
    return {
        "id": u.id,
        "username": u.username,
        "display_name": u.display_name or u.username,
        "bio": u.bio,
        "avatar_url": u.avatar_url,
        "birth_year": u.birth_year,
        "age": age,
        "gender": u.gender,
        "looking_for": u.looking_for,
        "interests": u.interests or [],
        "city": u.city,
        "id_verified": u.id_verified,
        "background_verified": u.background_verified,
        "venue_match_alerts": u.venue_match_alerts,
        "is_admin": u.is_admin,
    }


def _event_dict(
    e: T1IntheWildEvent,
    *,
    is_going: bool = False,
    can_plan: bool = False,
    distance_miles: float | None = None,
) -> dict[str, Any]:
    out = {
        "id": e.id,
        "name": e.name,
        "description": e.description,
        "venue_name": e.venue_name,
        "city": e.city,
        "latitude": e.latitude,
        "longitude": e.longitude,
        "radius_m": e.radius_m,
        "category": e.category,
        "starts_at": e.starts_at.isoformat() if e.starts_at else None,
        "ends_at": e.ends_at.isoformat() if e.ends_at else None,
        "is_going": is_going,
        "can_plan": can_plan,
        "user_submitted": bool(e.created_by_user_id),
    }
    if distance_miles is not None:
        out["distance_miles"] = round(distance_miles, 1)
    return out


def _match_dict(m: T1IntheWildMatch, me_id: str, db: Session) -> dict[str, Any]:
    other_id = m.user_b_id if m.user_a_id == me_id else m.user_a_id
    other = db.get(T1IntheWildUser, other_id)
    event = db.get(T1IntheWildEvent, m.event_id)
    now = _now()
    status_val = m.status
    if status_val == "active" and m.chat_expires_at <= now:
        status_val = "expired"
    me = db.get(T1IntheWildUser, me_id)
    chat = _chat_send_eligibility(me, m, db) if me else {}
    return {
        "id": m.id,
        "other_user": _profile_dict(other) if other else None,
        "event": _event_dict(event) if event else None,
        "matched_at": m.matched_at.isoformat(),
        "chat_expires_at": m.chat_expires_at.isoformat(),
        "status": status_val,
        "seconds_remaining": max(0, int((m.chat_expires_at - now).total_seconds())),
        **chat,
    }


def _create_session(db: Session, user_id: str, request: Request) -> str:
    token = secrets.token_urlsafe(32)
    db.add(
        T1IntheWildSession(
            token=token,
            user_id=user_id,
            expires_at=_now() + timedelta(hours=SESSION_HOURS),
            user_agent=(request.headers.get("user-agent") or "")[:400],
            ip=(request.client.host if request.client else "")[:64],
        )
    )
    db.commit()
    return token


def _get_user(
    db: Session,
    authorization: str | None,
) -> T1IntheWildUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    sess = db.get(T1IntheWildSession, token)
    if not sess or sess.expires_at <= _now():
        raise HTTPException(status_code=401, detail="Session expired")
    user = db.get(T1IntheWildUser, sess.user_id)
    if not user or user.is_suspended:
        raise HTTPException(status_code=401, detail="Account unavailable")
    return user


def _mutual_like(db: Session, a_id: str, b_id: str) -> bool:
    like_ab = db.scalar(
        select(T1IntheWildLike).where(
            T1IntheWildLike.from_user_id == a_id,
            T1IntheWildLike.to_user_id == b_id,
            T1IntheWildLike.action == "like",
        )
    )
    like_ba = db.scalar(
        select(T1IntheWildLike).where(
            T1IntheWildLike.from_user_id == b_id,
            T1IntheWildLike.to_user_id == a_id,
            T1IntheWildLike.action == "like",
        )
    )
    return like_ab is not None and like_ba is not None


def _ordered_pair(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a < b else (b, a)


def _try_venue_matches(db: Session, user_id: str, event_id: str) -> list[str]:
    """Create matches when mutual likes + both opted in at same event. Returns new match ids."""
    my_checkin = db.scalar(
        select(T1IntheWildCheckIn).where(
            T1IntheWildCheckIn.user_id == user_id,
            T1IntheWildCheckIn.event_id == event_id,
            T1IntheWildCheckIn.open_to_meet.is_(True),
            T1IntheWildCheckIn.expires_at > _now(),
        )
    )
    if not my_checkin:
        return []

    others = db.scalars(
        select(T1IntheWildCheckIn).where(
            T1IntheWildCheckIn.event_id == event_id,
            T1IntheWildCheckIn.user_id != user_id,
            T1IntheWildCheckIn.open_to_meet.is_(True),
            T1IntheWildCheckIn.expires_at > _now(),
        )
    ).all()

    created: list[str] = []
    for other in others:
        if not _mutual_like(db, user_id, other.user_id):
            continue
        event = db.get(T1IntheWildEvent, event_id)
        skip_proximity = event and event.category == _DEV_LOUNGE_CATEGORY and _is_full_dev_mode()
        if not skip_proximity:
            if my_checkin.latitude is None or my_checkin.longitude is None:
                continue
            if other.latitude is None or other.longitude is None:
                continue
            dist = _haversine_m(
                my_checkin.latitude,
                my_checkin.longitude,
                other.latitude,
                other.longitude,
            )
            if dist > VENUE_MATCH_PROXIMITY_M:
                continue
        ua, ub = _ordered_pair(user_id, other.user_id)
        existing = db.scalar(
            select(T1IntheWildMatch).where(
                T1IntheWildMatch.user_a_id == ua,
                T1IntheWildMatch.user_b_id == ub,
                T1IntheWildMatch.event_id == event_id,
            )
        )
        if existing:
            continue
        match_id = str(uuid.uuid4())
        expires = _now() + timedelta(hours=MATCH_CHAT_HOURS)
        db.add(
            T1IntheWildMatch(
                id=match_id,
                user_a_id=ua,
                user_b_id=ub,
                event_id=event_id,
                status="active",
                matched_at=_now(),
                chat_expires_at=expires,
            )
        )
        created.append(match_id)
    if created:
        db.commit()
        _notify_venue_match_emails(db, created)
    return created


def _notify_venue_match_emails(db: Session, match_ids: list[str]) -> None:
    base_url = email_service.itw_public_base_url()
    for match_id in match_ids:
        match = db.get(T1IntheWildMatch, match_id)
        if not match:
            continue
        user_a = db.get(T1IntheWildUser, match.user_a_id)
        user_b = db.get(T1IntheWildUser, match.user_b_id)
        event = db.get(T1IntheWildEvent, match.event_id)
        if not user_a or not user_b or not event:
            continue
        event_name = event.name
        pairs = (
            (user_a, user_b.display_name or user_b.username),
            (user_b, user_a.display_name or user_a.username),
        )
        for recipient, other_name in pairs:
            try:
                email_service.send_itw_venue_match_email(
                    to=recipient.email,
                    recipient_name=recipient.display_name or recipient.username,
                    other_name=other_name,
                    event_name=event_name,
                    chat_hours=MATCH_CHAT_HOURS,
                )
            except Exception:
                log.exception("Venue match email failed for match=%s user=%s", match_id, recipient.id)
            if not recipient.venue_match_alerts:
                continue
            subs = db.scalars(
                select(T1IntheWildPushSubscription).where(
                    T1IntheWildPushSubscription.user_id == recipient.id
                )
            ).all()
            push_title = f"{other_name} is nearby!"
            push_body = (
                f"You and {other_name} are both within 100 feet at {event_name}. "
                "Say hello in person!"
            )
            push_url = f"{base_url}/#/matches"
            for sub in subs:
                itw_push.send_web_push(
                    endpoint=sub.endpoint,
                    p256dh=sub.p256dh,
                    auth=sub.auth,
                    title=push_title,
                    body=push_body,
                    url=push_url,
                    tag=f"itw-match-{match_id}",
                )


def _event_plan_eligible(event: T1IntheWildEvent) -> bool:
    if event.category in (_DEV_LOUNGE_CATEGORY, _SPOT_CATEGORY):
        return False
    return bool(event.is_active and event.ends_at > _now())


def _expire_other_checkins(db: Session, user_id: str, except_event_id: str) -> None:
    now = _now()
    rows = db.scalars(
        select(T1IntheWildCheckIn).where(
            T1IntheWildCheckIn.user_id == user_id,
            T1IntheWildCheckIn.event_id != except_event_id,
            T1IntheWildCheckIn.expires_at > now,
        )
    ).all()
    for row in rows:
        row.open_to_meet = False
        row.expires_at = now


def _find_or_create_spot_event(
    db: Session,
    lat: float,
    lng: float,
    venue_label: str,
    user: T1IntheWildUser,
) -> T1IntheWildEvent:
    now = _now()
    candidates = db.scalars(
        select(T1IntheWildEvent).where(
            T1IntheWildEvent.is_active.is_(True),
            T1IntheWildEvent.category == _SPOT_CATEGORY,
            T1IntheWildEvent.ends_at >= now,
        )
    ).all()
    for event in candidates:
        if _haversine_m(lat, lng, event.latitude, event.longitude) <= SPOT_MERGE_RADIUS_M:
            new_end = now + timedelta(hours=SPOT_CHECKIN_HOURS)
            if event.ends_at < new_end:
                event.ends_at = new_end
            return event

    geo = itw_geocode.reverse_geocode(lat, lng)
    custom = (venue_label or "").strip()
    name = (custom or geo.get("label") or "Open now").strip()[:200]
    venue = (custom or geo.get("venue_name") or name).strip()[:200]
    city = (geo.get("city") or (user.city or "")).strip()[:120]
    event = T1IntheWildEvent(
        id=str(uuid.uuid4()),
        name=name,
        description="Spontaneous check-in — open to meeting people here.",
        venue_name=venue,
        city=city,
        latitude=lat,
        longitude=lng,
        radius_m=SPOT_EVENT_RADIUS_M,
        category=_SPOT_CATEGORY,
        starts_at=now,
        ends_at=now + timedelta(hours=SPOT_CHECKIN_HOURS),
        is_active=True,
        created_by_user_id=user.id,
    )
    db.add(event)
    db.flush()
    return event


def _upsert_check_in(
    db: Session,
    user: T1IntheWildUser,
    event: T1IntheWildEvent,
    lat: float,
    lng: float,
) -> T1IntheWildCheckIn:
    now = _now()
    _expire_other_checkins(db, user.id, event.id)
    if event.category == _SPOT_CATEGORY:
        expires = now + timedelta(hours=SPOT_CHECKIN_HOURS)
    else:
        expires = min(event.ends_at + timedelta(hours=1), now + timedelta(hours=12))
    checkin = db.scalar(
        select(T1IntheWildCheckIn).where(
            T1IntheWildCheckIn.user_id == user.id,
            T1IntheWildCheckIn.event_id == event.id,
        )
    )
    if checkin:
        checkin.latitude = lat
        checkin.longitude = lng
        checkin.checked_in_at = now
        checkin.expires_at = expires
    else:
        checkin = T1IntheWildCheckIn(
            id=str(uuid.uuid4()),
            user_id=user.id,
            event_id=event.id,
            open_to_meet=False,
            latitude=lat,
            longitude=lng,
            checked_in_at=now,
            expires_at=expires,
        )
        db.add(checkin)
    return checkin


def _format_event_starts(event: T1IntheWildEvent) -> str:
    if not event.starts_at:
        return "soon"
    return event.starts_at.strftime("%b %d, %Y")


def _send_event_plan_overlap_emails(
    user_a: T1IntheWildUser,
    user_b: T1IntheWildUser,
    event: T1IntheWildEvent,
) -> None:
    starts = _format_event_starts(event)
    pairs = (
        (user_a, user_b.display_name or user_b.username),
        (user_b, user_a.display_name or user_a.username),
    )
    for recipient, other_name in pairs:
        try:
            email_service.send_itw_event_plan_overlap_email(
                to=recipient.email,
                recipient_name=recipient.display_name or recipient.username,
                other_name=other_name,
                event_name=event.name,
                event_starts=starts,
            )
        except Exception:
            log.exception(
                "Event plan overlap email failed event=%s user=%s",
                event.id,
                recipient.id,
            )


def _overlap_dict(event: T1IntheWildEvent, other: T1IntheWildUser) -> dict[str, Any]:
    return {
        "event": _event_dict(event),
        "other_user": _profile_dict(other),
    }


def _try_event_plan_overlaps(
    db: Session,
    user_id: str,
    event_id: str | None = None,
) -> list[dict[str, Any]]:
    """Notify mutual likes who share a planned event. Returns new overlaps for this user."""
    hidden = _hidden_user_ids(db, user_id)
    me = db.get(T1IntheWildUser, user_id)
    if not me:
        return []

    if event_id:
        event_ids = [event_id]
    else:
        event_ids = list(
            db.scalars(
                select(T1IntheWildEventPlan.event_id).where(T1IntheWildEventPlan.user_id == user_id)
            ).all()
        )

    created: list[dict[str, Any]] = []
    for eid in event_ids:
        if not db.scalar(
            select(T1IntheWildEventPlan.id).where(
                T1IntheWildEventPlan.user_id == user_id,
                T1IntheWildEventPlan.event_id == eid,
            )
        ):
            continue
        event = db.get(T1IntheWildEvent, eid)
        if not event or not _event_plan_eligible(event):
            continue

        others = db.scalars(
            select(T1IntheWildEventPlan.user_id).where(
                T1IntheWildEventPlan.event_id == eid,
                T1IntheWildEventPlan.user_id != user_id,
            )
        ).all()
        for other_id in others:
            if other_id in hidden:
                continue
            if not _mutual_like(db, user_id, other_id):
                continue
            ua, ub = _ordered_pair(user_id, other_id)
            existing = db.scalar(
                select(T1IntheWildEventPlanAlert.id).where(
                    T1IntheWildEventPlanAlert.user_a_id == ua,
                    T1IntheWildEventPlanAlert.user_b_id == ub,
                    T1IntheWildEventPlanAlert.event_id == eid,
                )
            )
            if existing:
                continue
            other = db.get(T1IntheWildUser, other_id)
            if not other or other.is_suspended:
                continue
            db.add(
                T1IntheWildEventPlanAlert(
                    id=str(uuid.uuid4()),
                    user_a_id=ua,
                    user_b_id=ub,
                    event_id=eid,
                    notified_at=_now(),
                )
            )
            db.commit()
            _send_event_plan_overlap_emails(me, other, event)
            created.append(_overlap_dict(event, other))
    return created


def _try_all_venue_matches(db: Session, user_id: str) -> list[str]:
    """Scan every active opted-in check-in for possible venue matches."""
    checkins = db.scalars(
        select(T1IntheWildCheckIn).where(
            T1IntheWildCheckIn.user_id == user_id,
            T1IntheWildCheckIn.open_to_meet.is_(True),
            T1IntheWildCheckIn.expires_at > _now(),
        )
    ).all()
    created: list[str] = []
    for checkin in checkins:
        created.extend(_try_venue_matches(db, user_id, checkin.event_id))
    return list(dict.fromkeys(created))


def _matches_by_ids(db: Session, match_ids: list[str], me_id: str) -> list[dict[str, Any]]:
    if not match_ids:
        return []
    rows = db.scalars(
        select(T1IntheWildMatch).where(T1IntheWildMatch.id.in_(match_ids))
    ).all()
    by_id = {m.id: m for m in rows}
    return [_match_dict(by_id[mid], me_id, db) for mid in match_ids if mid in by_id]


def _schema_ready(db: Session) -> tuple[bool, str | None]:
    try:
        db.scalar(select(T1IntheWildUser.id).limit(1))
        db.scalar(select(T1IntheWildEvent.id).limit(1))
        return True, None
    except ProgrammingError:
        db.rollback()
        return False, "Run bash deploy/migrate-t1inthewild-v1.sh on the server."
    except Exception:
        db.rollback()
        return False, "Database schema is out of date."


# --- Request bodies ---


class WaitlistBody(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    name: str = Field(default="", max_length=120)
    city: str = Field(default="", max_length=120)


class RegisterBody(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=128)
    username: str = Field(min_length=3, max_length=32)
    display_name: str = Field(default="", max_length=120)
    birth_year: int
    gender: str = Field(min_length=1, max_length=32)
    looking_for: str = Field(min_length=1, max_length=32)


class LoginBody(BaseModel):
    email: str
    password: str


class ProfilePatchBody(BaseModel):
    display_name: str | None = None
    bio: str | None = None
    avatar_url: str | None = None
    birth_year: int | None = None
    gender: str | None = None
    looking_for: str | None = None
    interests: list[str] | None = None
    city: str | None = None
    venue_match_alerts: bool | None = None


class PushSubscribeBody(BaseModel):
    endpoint: str = Field(min_length=8, max_length=4000)
    p256dh: str = Field(min_length=8, max_length=200)
    auth: str = Field(min_length=8, max_length=100)
    platform: str = Field(default="web", max_length=32)


class UserSubmitEventBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    venue_name: str = Field(min_length=1, max_length=200)
    city: str = Field(min_length=1, max_length=120)
    latitude: float | None = None
    longitude: float | None = None
    starts_at: datetime
    ends_at: datetime
    category: str = Field(default="community", max_length=32)


class SwipeBody(BaseModel):
    target_id: str
    action: str = Field(pattern="^(like|pass)$")


class CheckInBody(BaseModel):
    lat: float
    lng: float


class CheckInHereBody(BaseModel):
    lat: float
    lng: float
    venue_label: str = Field(default="", max_length=200)


class CheckInPatchBody(BaseModel):
    open_to_meet: bool


class MessageBody(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class BlockBody(BaseModel):
    blocked_id: str = Field(min_length=36, max_length=36)


class ReportBody(BaseModel):
    reported_id: str = Field(min_length=36, max_length=36)
    reason: str = Field(default="", max_length=500)


class AdminEventBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    venue_name: str = Field(default="", max_length=200)
    city: str = Field(default="", max_length=120)
    latitude: float
    longitude: float
    radius_m: int = Field(default=300, ge=50, le=500_000)
    category: str = Field(default="", max_length=32)
    starts_at: datetime
    ends_at: datetime
    is_active: bool = True


class AdminUserPatchBody(BaseModel):
    id_verified: bool | None = None
    is_suspended: bool | None = None
    is_admin: bool | None = None


class AdminReportPatchBody(BaseModel):
    action: str = Field(pattern="^(dismiss|suspend_reported)$")


# --- Routes ---


@router.get("/status")
def status(db: Session = Depends(_db)):
    ready, err = _schema_ready(db)
    event_count = 0
    if ready:
        event_count = db.scalar(select(func.count()).select_from(T1IntheWildEvent)) or 0
    return {
        "ok": True,
        "schemaReady": ready,
        "schemaError": err,
        "eventCount": event_count,
        "matchChatHours": MATCH_CHAT_HOURS,
    }


@router.post("/waitlist")
def waitlist(body: WaitlistBody, db: Session = Depends(_db)):
    ready, err = _schema_ready(db)
    if not ready:
        raise HTTPException(status_code=503, detail=err)
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email")
    existing = db.scalar(select(T1IntheWildWaitlist).where(T1IntheWildWaitlist.email == email))
    if existing:
        return {"ok": True, "message": "You're already on the list!"}
    db.add(
        T1IntheWildWaitlist(
            id=str(uuid.uuid4()),
            email=email,
            name=(body.name or "").strip()[:120],
            city=(body.city or "").strip()[:120],
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
    return {"ok": True, "message": "Thanks — we'll be in touch!"}


@router.post("/register")
def register(body: RegisterBody, request: Request, db: Session = Depends(_db)):
    ready, err = _schema_ready(db)
    if not ready:
        raise HTTPException(status_code=503, detail=err)
    email = body.email.strip().lower()
    username = body.username.strip()
    if not USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail="Username must be 3–32 chars (letters, numbers, underscore)")
    _validate_birth_year(body.birth_year)
    gender = _validate_gender(body.gender)
    looking_for = _validate_looking_for(body.looking_for)
    user_id = str(uuid.uuid4())
    user = T1IntheWildUser(
        id=user_id,
        email=email,
        username=username,
        password_hash=bcrypt_hasher.hash(truncate_for_bcrypt(body.password)),
        display_name=(body.display_name or username).strip()[:120],
        birth_year=body.birth_year,
        gender=gender,
        looking_for=looking_for,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email or username already taken")
    db.refresh(user)
    token = _create_session(db, user_id, request)
    return {"token": token, "profile": _profile_dict(user)}


@router.post("/login")
def login(body: LoginBody, request: Request, db: Session = Depends(_db)):
    ready, err = _schema_ready(db)
    if not ready:
        raise HTTPException(status_code=503, detail=err)
    email = body.email.strip().lower()
    user = db.scalars(select(T1IntheWildUser).where(func.lower(T1IntheWildUser.email) == email)).first()
    if not user or not bcrypt_hasher.verify(truncate_for_bcrypt(body.password), user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.is_suspended:
        raise HTTPException(status_code=403, detail="Account suspended")
    token = _create_session(db, user.id, request)
    return {"token": token, "profile": _profile_dict(user)}


@router.post("/logout")
def logout(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        sess = db.get(T1IntheWildSession, token)
        if sess:
            db.delete(sess)
            db.commit()
    return {"ok": True}


@router.get("/me")
def me(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    checkin = db.scalar(
        select(T1IntheWildCheckIn)
        .where(
            T1IntheWildCheckIn.user_id == user.id,
            T1IntheWildCheckIn.expires_at > _now(),
        )
        .order_by(T1IntheWildCheckIn.checked_in_at.desc())
        .limit(1)
    )
    profile = _profile_dict(user)
    if checkin:
        event = db.get(T1IntheWildEvent, checkin.event_id)
        profile["active_check_in"] = {
            "event_id": checkin.event_id,
            "event_name": event.name if event else "",
            "open_to_meet": checkin.open_to_meet,
            "checked_in_at": checkin.checked_in_at.isoformat(),
        }
    else:
        profile["active_check_in"] = None
    return profile


@router.patch("/me")
def patch_me(
    body: ProfilePatchBody,
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    if body.display_name is not None:
        user.display_name = body.display_name.strip()[:120]
    if body.bio is not None:
        user.bio = body.bio.strip()[:2000]
    if body.avatar_url is not None:
        user.avatar_url = body.avatar_url.strip()[:2000]
    if body.birth_year is not None:
        _validate_birth_year(body.birth_year)
        user.birth_year = body.birth_year
    if body.gender is not None:
        user.gender = _validate_gender(body.gender)
    if body.looking_for is not None:
        user.looking_for = _validate_looking_for(body.looking_for)
    if body.interests is not None:
        user.interests = [i.strip()[:64] for i in body.interests if i.strip()][:20]
    if body.city is not None:
        user.city = body.city.strip()[:120]
        user.city_latitude = None
        user.city_longitude = None
    if body.venue_match_alerts is not None:
        user.venue_match_alerts = body.venue_match_alerts
    db.commit()
    if body.city is not None and user.city:
        _sync_user_city_coords(user, db)
    else:
        db.refresh(user)
    return _profile_dict(user)


@router.get("/events")
def list_events(
    authorization: Annotated[str | None, Header()] = None,
    lat: float | None = Query(default=None, ge=-90, le=90),
    lng: float | None = Query(default=None, ge=-180, le=180),
    db: Session = Depends(_db),
):
    ready, err = _schema_ready(db)
    if not ready:
        raise HTTPException(status_code=503, detail=err)
    if (lat is None) != (lng is None):
        raise HTTPException(status_code=400, detail="Provide both lat and lng, or neither")
    now = _now()
    events = db.scalars(
        select(T1IntheWildEvent)
        .where(
            T1IntheWildEvent.is_active.is_(True),
            T1IntheWildEvent.ends_at >= now - timedelta(hours=12),
        )
        .order_by(T1IntheWildEvent.starts_at)
    ).all()
    user: T1IntheWildUser | None = None
    going_ids: set[str] = set()
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        sess = db.get(T1IntheWildSession, token)
        if sess and sess.expires_at > now:
            user = db.get(T1IntheWildUser, sess.user_id)
            if user and user.city and (user.city_latitude is None or user.city_longitude is None):
                _sync_user_city_coords(user, db)
            going_ids = set(
                db.scalars(
                    select(T1IntheWildEventPlan.event_id).where(
                        T1IntheWildEventPlan.user_id == sess.user_id
                    )
                ).all()
            )
    visible, meta = _filter_events_for_user(events, user, going_ids, gps_lat=lat, gps_lng=lng)
    if lat is not None and lng is not None:
        center_lat, center_lng = lat, lng
    elif user and user.city_latitude is not None and user.city_longitude is not None:
        center_lat, center_lng = user.city_latitude, user.city_longitude
    else:
        center_lat, center_lng = None, None
    out_events = []
    for e in visible:
        dist_miles = None
        if center_lat is not None and center_lng is not None:
            dist_miles = _haversine_m(center_lat, center_lng, e.latitude, e.longitude) / 1609.344
        out_events.append(
            _event_dict(
                e,
                is_going=e.id in going_ids,
                can_plan=_event_plan_eligible(e),
                distance_miles=dist_miles,
            )
        )
    out_events.sort(key=lambda row: row.get("distance_miles") if row.get("distance_miles") is not None else 1e9)
    return {"events": out_events, "filter": meta}


@router.post("/events")
def submit_event(
    body: UserSubmitEventBody,
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    starts_at = _utc_naive(body.starts_at)
    ends_at = _utc_naive(body.ends_at)
    if ends_at <= starts_at:
        raise HTTPException(status_code=400, detail="End time must be after start time")
    if ends_at <= _now():
        raise HTTPException(status_code=400, detail="Event must end in the future")

    duplicate = _find_duplicate_event(
        db,
        name=body.name,
        venue_name=body.venue_name,
        city=body.city,
        starts_at=starts_at,
    )
    if duplicate:
        return {
            "ok": True,
            "already_exists": True,
            "message": "This event is already on the list.",
            "event": _event_dict(duplicate, can_plan=_event_plan_eligible(duplicate)),
        }

    lat, lng = body.latitude, body.longitude
    if lat is None or lng is None:
        coords = itw_geocode.geocode_city(f"{body.venue_name}, {body.city}")
        if not coords:
            coords = itw_geocode.geocode_city(body.city)
        if not coords:
            raise HTTPException(
                status_code=400,
                detail="Could not locate that city. Try adding latitude and longitude.",
            )
        lat, lng = coords

    event = T1IntheWildEvent(
        id=str(uuid.uuid4()),
        name=body.name.strip()[:200],
        description=body.description.strip()[:5000],
        venue_name=body.venue_name.strip()[:200],
        city=body.city.strip()[:120],
        latitude=lat,
        longitude=lng,
        radius_m=300,
        category=(body.category or "community").strip()[:32],
        starts_at=starts_at,
        ends_at=ends_at,
        is_active=True,
        created_by_user_id=user.id,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return {
        "ok": True,
        "already_exists": False,
        "message": "Event added — you and others nearby can mark that you're going.",
        "event": _event_dict(event, can_plan=_event_plan_eligible(event)),
    }


@router.get("/event-plans")
def list_event_plans(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    plans = db.scalars(
        select(T1IntheWildEventPlan)
        .where(T1IntheWildEventPlan.user_id == user.id)
        .order_by(T1IntheWildEventPlan.created_at.desc())
    ).all()
    out = []
    for plan in plans:
        event = db.get(T1IntheWildEvent, plan.event_id)
        if not event:
            continue
        out.append(
            {
                "event_id": plan.event_id,
                "created_at": plan.created_at.isoformat(),
                "event": _event_dict(event, is_going=True, can_plan=_event_plan_eligible(event)),
            }
        )
    return {"plans": out}


@router.post("/events/{event_id}/plan")
def add_event_plan(
    event_id: str,
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    event = db.get(T1IntheWildEvent, event_id)
    if not event or not event.is_active:
        raise HTTPException(status_code=404, detail="Event not found")
    if not _event_plan_eligible(event):
        raise HTTPException(status_code=400, detail="This event cannot be added to your plans")
    existing = db.scalar(
        select(T1IntheWildEventPlan).where(
            T1IntheWildEventPlan.user_id == user.id,
            T1IntheWildEventPlan.event_id == event_id,
        )
    )
    if not existing:
        db.add(
            T1IntheWildEventPlan(
                id=str(uuid.uuid4()),
                user_id=user.id,
                event_id=event_id,
            )
        )
        db.commit()
    overlaps = _try_event_plan_overlaps(db, user.id, event_id)
    return {
        "ok": True,
        "is_going": True,
        "event": _event_dict(event, is_going=True, can_plan=True),
        "new_overlaps": overlaps,
    }


@router.delete("/events/{event_id}/plan")
def remove_event_plan(
    event_id: str,
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    plan = db.scalar(
        select(T1IntheWildEventPlan).where(
            T1IntheWildEventPlan.user_id == user.id,
            T1IntheWildEventPlan.event_id == event_id,
        )
    )
    if plan:
        db.delete(plan)
        db.commit()
    event = db.get(T1IntheWildEvent, event_id)
    return {
        "ok": True,
        "is_going": False,
        "event": _event_dict(event, is_going=False, can_plan=_event_plan_eligible(event))
        if event
        else None,
    }


@router.get("/discover")
def discover(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
    limit: int = 10,
):
    user = _get_user(db, authorization)
    limit = min(max(limit, 1), 20)
    if not _profile_preferences_complete(user):
        return {
            "profiles": [],
            "needs_preferences": True,
            "message": "Set your gender and who you're looking for in Profile to start discovering.",
        }
    cutoff = _now() - timedelta(days=PASS_COOLDOWN_DAYS)
    seen_ids = db.scalars(
        select(T1IntheWildLike.to_user_id).where(
            T1IntheWildLike.from_user_id == user.id,
            or_(
                T1IntheWildLike.action == "like",
                and_(T1IntheWildLike.action == "pass", T1IntheWildLike.created_at >= cutoff),
            ),
        )
    ).all()
    exclude = _hidden_user_ids(db, user.id) | set(seen_ids) | {user.id}
    q = select(T1IntheWildUser).where(
        T1IntheWildUser.is_suspended.is_(False),
        T1IntheWildUser.id.notin_(exclude) if exclude else True,
    )
    candidates = db.scalars(q.limit(limit * 8)).all()
    compatible = [u for u in candidates if _profiles_compatible(user, u)][:limit]
    if not compatible:
        return {"profiles": [], "needs_preferences": False}

    candidate_ids = [u.id for u in compatible]
    viewer_plan_ids = set(
        db.scalars(
            select(T1IntheWildEventPlan.event_id).where(T1IntheWildEventPlan.user_id == user.id)
        ).all()
    )
    plan_rows = db.execute(
        select(T1IntheWildEventPlan.user_id, T1IntheWildEventPlan.event_id).where(
            T1IntheWildEventPlan.user_id.in_(candidate_ids)
        )
    ).all()
    plans_by_user: dict[str, set[str]] = {uid: set() for uid in candidate_ids}
    for uid, event_id in plan_rows:
        plans_by_user.setdefault(uid, set()).add(event_id)

    now = _now()
    checkin_rows = db.execute(
        select(T1IntheWildCheckIn.user_id, T1IntheWildCheckIn.event_id).where(
            T1IntheWildCheckIn.user_id.in_([user.id, *candidate_ids]),
            T1IntheWildCheckIn.expires_at > now,
        )
    ).all()
    checkin_event_by_user = {uid: eid for uid, eid in checkin_rows}
    viewer_checkin_event = checkin_event_by_user.get(user.id)

    profiles: list[dict[str, Any]] = []
    for u in compatible:
        profile = _profile_dict(u)
        interest_pct, shared_interests = interest_overlap_pct(user.interests, u.interests)
        shared_plans = len(viewer_plan_ids & plans_by_user.get(u.id, set()))
        same_event = bool(
            viewer_checkin_event
            and checkin_event_by_user.get(u.id) == viewer_checkin_event
        )
        vicinity_pct = vicinity_score_pct(
            viewer_city=user.city or "",
            candidate_city=u.city or "",
            shared_planned_events=shared_plans,
            same_check_in_event=same_event,
        )
        profile["interest_match_pct"] = interest_pct
        profile["vicinity_pct"] = vicinity_pct
        profile["compatibility_pct"] = compatibility_pct(interest_pct, vicinity_pct)
        profile["shared_interests"] = shared_interests
        profiles.append(profile)

    return {"profiles": profiles, "needs_preferences": False}


@router.post("/swipe")
def swipe(
    body: SwipeBody,
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    if not _profile_preferences_complete(user):
        raise HTTPException(
            status_code=400,
            detail="Complete your gender and preferences in Profile before swiping.",
        )
    if body.target_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot swipe on yourself")
    target = db.get(T1IntheWildUser, body.target_id)
    if not target or target.is_suspended:
        raise HTTPException(status_code=404, detail="Profile not found")
    if not _profiles_compatible(user, target):
        raise HTTPException(status_code=400, detail="This profile is not in your discovery preferences")
    existing = db.scalar(
        select(T1IntheWildLike).where(
            T1IntheWildLike.from_user_id == user.id,
            T1IntheWildLike.to_user_id == body.target_id,
        )
    )
    if existing:
        existing.action = body.action
        existing.created_at = _now()
    else:
        db.add(
            T1IntheWildLike(
                id=str(uuid.uuid4()),
                from_user_id=user.id,
                to_user_id=body.target_id,
                action=body.action,
            )
        )
    db.commit()
    mutual = body.action == "like" and _mutual_like(db, user.id, body.target_id)
    new_ids: list[str] = []
    new_overlaps: list[dict[str, Any]] = []
    if mutual:
        new_ids = _try_all_venue_matches(db, user.id)
        new_overlaps = _try_event_plan_overlaps(db, user.id)
    return {
        "ok": True,
        "mutual_like": mutual,
        "message": "Like saved — meet at an event to connect!" if mutual and not new_ids else None,
        "new_matches": _matches_by_ids(db, new_ids, user.id),
        "new_overlaps": new_overlaps,
    }


@router.get("/likes/pending")
def pending_likes(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    likes = db.scalars(
        select(T1IntheWildLike).where(
            T1IntheWildLike.from_user_id == user.id,
            T1IntheWildLike.action == "like",
        )
    ).all()
    out = []
    for like in likes:
        other = db.get(T1IntheWildUser, like.to_user_id)
        if not other:
            continue
        out.append({
            "user": _profile_dict(other),
            "mutual": _mutual_like(db, user.id, like.to_user_id),
            "liked_at": like.created_at.isoformat(),
        })
    return {"likes": out}


@router.post("/events/{event_id}/check-in")
def check_in(
    event_id: str,
    body: CheckInBody,
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    event = db.get(T1IntheWildEvent, event_id)
    if not event or not event.is_active:
        raise HTTPException(status_code=404, detail="Event not found")
    now = _now()
    if event.ends_at < now - timedelta(hours=1):
        raise HTTPException(status_code=400, detail="Event has ended")
    dist = _haversine_m(body.lat, body.lng, event.latitude, event.longitude)
    skip_geofence = event.category == _DEV_LOUNGE_CATEGORY and _is_full_dev_mode()
    if not skip_geofence and dist > event.radius_m:
        raise HTTPException(
            status_code=400,
            detail=f"You must be within {event.radius_m}m of the venue to check in",
        )
    checkin = _upsert_check_in(db, user, event, body.lat, body.lng)
    db.commit()
    new_ids: list[str] = []
    if checkin.open_to_meet:
        new_ids = _try_venue_matches(db, user.id, event_id)
    return {
        "ok": True,
        "check_in": {
            "event_id": event_id,
            "open_to_meet": checkin.open_to_meet,
            "checked_in_at": checkin.checked_in_at.isoformat(),
        },
        "event": _event_dict(event),
        "new_matches": _matches_by_ids(db, new_ids, user.id),
    }


@router.post("/check-in/here")
def check_in_here(
    body: CheckInHereBody,
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    event = _find_or_create_spot_event(db, body.lat, body.lng, body.venue_label, user)
    checkin = _upsert_check_in(db, user, event, body.lat, body.lng)
    db.commit()
    new_ids: list[str] = []
    if checkin.open_to_meet:
        new_ids = _try_venue_matches(db, user.id, event.id)
    return {
        "ok": True,
        "check_in": {
            "event_id": event.id,
            "event_name": event.name,
            "open_to_meet": checkin.open_to_meet,
            "checked_in_at": checkin.checked_in_at.isoformat(),
        },
        "event": _event_dict(event),
        "new_matches": _matches_by_ids(db, new_ids, user.id),
    }


@router.patch("/check-in")
def patch_check_in(
    body: CheckInPatchBody,
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    checkin = db.scalar(
        select(T1IntheWildCheckIn)
        .where(
            T1IntheWildCheckIn.user_id == user.id,
            T1IntheWildCheckIn.expires_at > _now(),
        )
        .order_by(T1IntheWildCheckIn.checked_in_at.desc())
        .limit(1)
    )
    if not checkin:
        raise HTTPException(status_code=400, detail="Check in to an event first")
    checkin.open_to_meet = body.open_to_meet
    db.commit()
    new_ids: list[str] = []
    if body.open_to_meet:
        new_ids = _try_venue_matches(db, user.id, checkin.event_id)
    return {
        "ok": True,
        "open_to_meet": checkin.open_to_meet,
        "new_matches": _matches_by_ids(db, new_ids, user.id),
    }


@router.delete("/check-in")
def leave_check_in(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    checkin = db.scalar(
        select(T1IntheWildCheckIn)
        .where(
            T1IntheWildCheckIn.user_id == user.id,
            T1IntheWildCheckIn.expires_at > _now(),
        )
        .order_by(T1IntheWildCheckIn.checked_in_at.desc())
        .limit(1)
    )
    if checkin:
        checkin.open_to_meet = False
        checkin.expires_at = _now()
        db.commit()
    return {"ok": True}


@router.get("/matches")
def list_matches(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    matches = db.scalars(
        select(T1IntheWildMatch).where(
            or_(
                T1IntheWildMatch.user_a_id == user.id,
                T1IntheWildMatch.user_b_id == user.id,
            )
        ).order_by(T1IntheWildMatch.matched_at.desc())
    ).all()
    return {"matches": [_match_dict(m, user.id, db) for m in matches]}


@router.get("/matches/{match_id}/messages")
def list_messages(
    match_id: str,
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    match = db.get(T1IntheWildMatch, match_id)
    if not match or user.id not in (match.user_a_id, match.user_b_id):
        raise HTTPException(status_code=404, detail="Match not found")
    if match.chat_expires_at <= _now():
        raise HTTPException(status_code=410, detail="Chat window expired — say hi in person next time!")
    msgs = db.scalars(
        select(T1IntheWildMessage)
        .where(T1IntheWildMessage.match_id == match_id)
        .order_by(T1IntheWildMessage.created_at)
    ).all()
    return {
        "messages": [
            {
                "id": m.id,
                "sender_id": m.sender_id,
                "body": m.body,
                "created_at": m.created_at.isoformat(),
                "mine": m.sender_id == user.id,
            }
            for m in msgs
        ],
        "chat_expires_at": match.chat_expires_at.isoformat(),
        **_chat_send_eligibility(user, match, db),
    }


@router.post("/matches/{match_id}/messages")
def send_message(
    match_id: str,
    body: MessageBody,
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    match = db.get(T1IntheWildMatch, match_id)
    if not match or user.id not in (match.user_a_id, match.user_b_id):
        raise HTTPException(status_code=404, detail="Match not found")
    if match.chat_expires_at <= _now():
        raise HTTPException(status_code=410, detail="Chat window expired")
    _require_can_send_message(user, match, db)
    msg = T1IntheWildMessage(
        id=str(uuid.uuid4()),
        match_id=match_id,
        sender_id=user.id,
        body=body.body.strip(),
    )
    db.add(msg)
    db.commit()
    return {
        "id": msg.id,
        "sender_id": msg.sender_id,
        "body": msg.body,
        "created_at": msg.created_at.isoformat(),
        "mine": True,
    }


# --- Avatar upload ---


@router.post("/uploads/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    content = await file.read()
    if len(content) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=400, detail="Image too large (max 4 MB)")
    ct = (file.content_type or "").lower()
    if not ct or ct == "application/octet-stream":
        ct = "image/jpeg"
    if not image_storage.allowed_content_type(ct):
        raise HTTPException(status_code=400, detail="Unsupported image type")

    url: str | None = None
    if image_storage.storage_enabled():
        ext_map = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}
        ext = ext_map.get(ct, "jpg")
        key = f"itw/{user.id}/avatar.{ext}"
        try:
            url = image_storage.upload_image_at_key(key, content, ct)
        except Exception:
            log.exception("In the Wild avatar S3 upload failed for user=%s", user.id)
            url = None

    if url is None:
        if len(content) > _INLINE_AVATAR_MAX_BYTES:
            try:
                content, ct = _shrink_avatar_for_inline(content, ct)
            except Exception:
                log.exception("Avatar resize failed for user=%s", user.id)
                raise HTTPException(status_code=503, detail="Could not process image")
        b64 = base64.b64encode(content).decode("ascii")
        url = f"data:{ct};base64,{b64}"

    user.avatar_url = url
    db.commit()
    return {"url": url}


# --- Block / report ---


@router.post("/blocks")
def create_block(
    body: BlockBody,
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    if body.blocked_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot block yourself")
    if db.get(T1IntheWildUser, body.blocked_id) is None:
        raise HTTPException(status_code=404, detail="User not found")
    existing = db.scalar(
        select(T1IntheWildUserBlock).where(
            T1IntheWildUserBlock.blocker_id == user.id,
            T1IntheWildUserBlock.blocked_id == body.blocked_id,
        )
    )
    if not existing:
        db.add(
            T1IntheWildUserBlock(
                id=str(uuid.uuid4()),
                blocker_id=user.id,
                blocked_id=body.blocked_id,
            )
        )
        db.commit()
    return {"ok": True}


@router.post("/reports")
def create_report(
    body: ReportBody,
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    if body.reported_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot report yourself")
    if db.get(T1IntheWildUser, body.reported_id) is None:
        raise HTTPException(status_code=404, detail="User not found")
    existing = db.scalar(
        select(T1IntheWildUserReport).where(
            T1IntheWildUserReport.reporter_id == user.id,
            T1IntheWildUserReport.reported_id == body.reported_id,
        )
    )
    if existing:
        return {"ok": True, "message": "Report already submitted"}
    db.add(
        T1IntheWildUserReport(
            id=str(uuid.uuid4()),
            reporter_id=user.id,
            reported_id=body.reported_id,
            reason=(body.reason or "").strip()[:500],
        )
    )
    db.commit()
    return {"ok": True, "message": "Report submitted — thank you"}


# --- Identity verification (stub; Stripe Identity in v0.2) ---


@router.get("/verification/status")
def verification_status(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    return {
        "id_verified": user.id_verified,
        "background_verified": user.background_verified,
        "can_message": True,
        "requires_both_verified": ID_VERIFY_REQUIRED_FOR_CHAT,
    }


@router.get("/notifications/config")
def notifications_config():
    return {
        "push_enabled": itw_push.push_configured(),
        "vapid_public_key": itw_push.vapid_public_key(),
        "proximity_feet": 100,
    }


@router.post("/notifications/push/subscribe")
def subscribe_push(
    body: PushSubscribeBody,
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    existing = db.scalar(
        select(T1IntheWildPushSubscription).where(
            T1IntheWildPushSubscription.endpoint == body.endpoint
        )
    )
    if existing:
        existing.user_id = user.id
        existing.p256dh = body.p256dh
        existing.auth = body.auth
        existing.platform = body.platform.strip()[:32] or "web"
    else:
        db.add(
            T1IntheWildPushSubscription(
                id=str(uuid.uuid4()),
                user_id=user.id,
                endpoint=body.endpoint,
                p256dh=body.p256dh,
                auth=body.auth,
                platform=body.platform.strip()[:32] or "web",
            )
        )
    user.venue_match_alerts = True
    db.commit()
    return {"ok": True}


@router.delete("/notifications/push/subscribe")
def unsubscribe_push(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    subs = db.scalars(
        select(T1IntheWildPushSubscription).where(
            T1IntheWildPushSubscription.user_id == user.id
        )
    ).all()
    for sub in subs:
        db.delete(sub)
    db.commit()
    return {"ok": True}


@router.post("/verification/id/start")
def start_id_verification(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    if user.id_verified:
        return {"status": "verified", "message": "Your identity is already verified."}
    return {
        "status": "pending",
        "message": (
            "Stripe Identity verification is coming soon. During beta, an admin can verify "
            "your account manually after review."
        ),
    }


# --- Admin ---


@router.get("/admin/stats")
def admin_stats(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    _require_admin(user)
    return {
        "users": db.scalar(select(func.count()).select_from(T1IntheWildUser)) or 0,
        "events": db.scalar(select(func.count()).select_from(T1IntheWildEvent)) or 0,
        "activeMatches": db.scalar(
            select(func.count()).select_from(T1IntheWildMatch).where(
                T1IntheWildMatch.chat_expires_at > _now()
            )
        )
        or 0,
        "reports": db.scalar(
            select(func.count())
            .select_from(T1IntheWildUserReport)
            .where(T1IntheWildUserReport.status == "pending")
        )
        or 0,
        "waitlist": db.scalar(select(func.count()).select_from(T1IntheWildWaitlist)) or 0,
    }


@router.get("/admin/events")
def admin_list_events(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    _require_admin(user)
    events = db.scalars(select(T1IntheWildEvent).order_by(T1IntheWildEvent.starts_at.desc())).all()
    return {"events": [_event_dict(e) for e in events]}


@router.post("/admin/events")
def admin_create_event(
    body: AdminEventBody,
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    _require_admin(user)
    starts_at = _utc_naive(body.starts_at)
    ends_at = _utc_naive(body.ends_at)
    if ends_at <= starts_at:
        raise HTTPException(status_code=400, detail="ends_at must be after starts_at")
    ev = T1IntheWildEvent(
        id=str(uuid.uuid4()),
        name=body.name.strip(),
        description=body.description.strip(),
        venue_name=body.venue_name.strip(),
        city=body.city.strip(),
        latitude=body.latitude,
        longitude=body.longitude,
        radius_m=body.radius_m,
        category=body.category.strip(),
        starts_at=starts_at,
        ends_at=ends_at,
        is_active=body.is_active,
    )
    db.add(ev)
    db.commit()
    return _event_dict(ev)


@router.patch("/admin/events/{event_id}")
def admin_update_event(
    event_id: str,
    body: AdminEventBody,
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    _require_admin(user)
    ev = db.get(T1IntheWildEvent, event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    ev.name = body.name.strip()
    ev.description = body.description.strip()
    ev.venue_name = body.venue_name.strip()
    ev.city = body.city.strip()
    ev.latitude = body.latitude
    ev.longitude = body.longitude
    ev.radius_m = body.radius_m
    ev.category = body.category.strip()
    ev.starts_at = _utc_naive(body.starts_at)
    ev.ends_at = _utc_naive(body.ends_at)
    ev.is_active = body.is_active
    db.commit()
    return _event_dict(ev)


@router.delete("/admin/events/{event_id}")
def admin_delete_event(
    event_id: str,
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    _require_admin(user)
    ev = db.get(T1IntheWildEvent, event_id)
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    db.delete(ev)
    db.commit()
    return {"ok": True}


@router.get("/admin/users")
def admin_list_users(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
    q: str = "",
    limit: int = 50,
):
    user = _get_user(db, authorization)
    _require_admin(user)
    limit = min(max(limit, 1), 100)
    stmt = select(T1IntheWildUser).order_by(T1IntheWildUser.created_at.desc())
    if q.strip():
        term = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(T1IntheWildUser.username).like(term),
                func.lower(T1IntheWildUser.email).like(term),
                func.lower(T1IntheWildUser.display_name).like(term),
            )
        )
    rows = db.scalars(stmt.limit(limit)).all()
    out = []
    for u in rows:
        p = _profile_dict(u)
        p["email"] = u.email
        out.append(p)
    return {"users": out}


@router.get("/admin/reports")
def admin_list_reports(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    user = _get_user(db, authorization)
    _require_admin(user)
    reports = db.scalars(
        select(T1IntheWildUserReport).order_by(T1IntheWildUserReport.created_at.desc()).limit(100)
    ).all()
    out = []
    for r in reports:
        reporter = db.get(T1IntheWildUser, r.reporter_id)
        reported = db.get(T1IntheWildUser, r.reported_id)
        out.append({
            "id": r.id,
            "reason": r.reason,
            "status": r.status,
            "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
            "created_at": r.created_at.isoformat(),
            "reporter": _profile_dict(reporter) if reporter else None,
            "reported": _profile_dict(reported) if reported else None,
        })
    return {"reports": out}


@router.patch("/admin/reports/{report_id}")
def admin_patch_report(
    report_id: str,
    body: AdminReportPatchBody,
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    admin = _get_user(db, authorization)
    _require_admin(admin)
    report = db.get(T1IntheWildUserReport, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if report.status != "pending":
        return {
            "ok": True,
            "message": "Report already reviewed",
            "status": report.status,
        }
    now = _now()
    if body.action == "dismiss":
        report.status = "dismissed"
        report.reviewed_at = now
    elif body.action == "suspend_reported":
        target = db.get(T1IntheWildUser, report.reported_id)
        if target:
            target.is_suspended = True
        report.status = "actioned"
        report.reviewed_at = now
    db.commit()
    return {"ok": True, "status": report.status}


@router.patch("/admin/users/{user_id}")
def admin_patch_user(
    user_id: str,
    body: AdminUserPatchBody,
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(_db),
):
    admin = _get_user(db, authorization)
    _require_admin(admin)
    target = db.get(T1IntheWildUser, user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if body.id_verified is not None:
        target.id_verified = body.id_verified
    if body.is_suspended is not None:
        target.is_suspended = body.is_suspended
    if body.is_admin is not None:
        target.is_admin = body.is_admin
    db.commit()
    return _profile_dict(target)
