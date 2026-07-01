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
