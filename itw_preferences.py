"""In the Wild preference matching — pure logic for discover filters."""

from __future__ import annotations

from datetime import datetime

VALID_GENDERS = frozenset({"man", "woman", "nonbinary", "other"})
VALID_LOOKING_FOR = frozenset({"men", "women", "everyone", "nonbinary"})


def normalize_gender(value: str) -> str:
    v = value.strip().lower()
    if v not in VALID_GENDERS:
        raise ValueError("Invalid gender selection")
    return v


def normalize_looking_for(value: str) -> str:
    v = value.strip().lower()
    if v not in VALID_LOOKING_FOR:
        raise ValueError("Invalid preference selection")
    return v


def profile_preferences_complete(gender: str, looking_for: str) -> bool:
    return bool(gender and looking_for)


def validate_birth_year(birth_year: int, *, current_year: int | None = None) -> None:
    year = current_year if current_year is not None else datetime.utcnow().year
    min_year = year - 100
    max_year = year - 18
    if birth_year < min_year or birth_year > max_year:
        raise ValueError("You must be 18 or older to use In the Wild")


def gender_matches_preference(gender: str, looking_for: str) -> bool:
    if looking_for == "everyone":
        return True
    if not gender:
        return False
    if looking_for == "men":
        return gender == "man"
    if looking_for == "women":
        return gender == "woman"
    if looking_for == "nonbinary":
        return gender in ("nonbinary", "other")
    return False


def profiles_compatible(
    a_gender: str,
    a_looking_for: str,
    b_gender: str,
    b_looking_for: str,
) -> bool:
    if not profile_preferences_complete(a_gender, a_looking_for):
        return False
    if not profile_preferences_complete(b_gender, b_looking_for):
        return False
    return gender_matches_preference(b_gender, a_looking_for) and gender_matches_preference(
        a_gender, b_looking_for
    )


def discover_visible(
    viewer_gender: str,
    viewer_looking_for: str,
    candidate_gender: str,
    candidate_looking_for: str,
) -> bool:
    """Whether a candidate may appear in the viewer's discover stack."""
    if not profile_preferences_complete(viewer_gender, viewer_looking_for):
        return False
    if not gender_matches_preference(candidate_gender, viewer_looking_for):
        return False
    if profile_preferences_complete(candidate_gender, candidate_looking_for):
        return gender_matches_preference(viewer_gender, candidate_looking_for)
    return True


def _normalize_interests(interests: list[str] | None) -> set[str]:
    return {i.strip().lower() for i in (interests or []) if i and i.strip()}


def interest_overlap_pct(
    a_interests: list[str] | None,
    b_interests: list[str] | None,
) -> tuple[int, list[str]]:
    """Jaccard similarity 0–100 plus shared interest labels (original casing from b)."""
    sa = _normalize_interests(a_interests)
    sb_raw = [i.strip() for i in (b_interests or []) if i and i.strip()]
    sb = {i.lower() for i in sb_raw}
    if not sa and not sb:
        return 50, []
    if not sa or not sb:
        return 0, []
    shared_keys = sa & sb
    union = sa | sb
    pct = round(len(shared_keys) / len(union) * 100)
    shared_display = [i for i in sb_raw if i.lower() in shared_keys]
    return pct, shared_display


def vicinity_score_pct(
    *,
    viewer_city: str,
    candidate_city: str,
    shared_planned_events: int = 0,
    same_check_in_event: bool = False,
) -> int:
    """City + shared event plans + same active check-in."""
    if same_check_in_event:
        return 100
    city_a = (viewer_city or "").strip().lower()
    city_b = (candidate_city or "").strip().lower()
    if city_a and city_b:
        city_pct = 100 if city_a == city_b else 0
    elif city_a or city_b:
        city_pct = 40
    else:
        city_pct = 50

    if shared_planned_events >= 2:
        event_pct = 100
    elif shared_planned_events == 1:
        event_pct = 85
    else:
        event_pct = city_pct

    return round(0.6 * city_pct + 0.4 * event_pct)


def compatibility_pct(interests_pct: int, vicinity_pct: int) -> int:
    return round(0.55 * interests_pct + 0.45 * vicinity_pct)
