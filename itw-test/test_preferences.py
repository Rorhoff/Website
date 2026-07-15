"""Unit tests for In the Wild preference matching (no database)."""

import pytest

from itw_preferences import (
    compatibility_pct,
    gender_matches_preference,
    interest_overlap_pct,
    normalize_gender,
    normalize_looking_for,
    profile_preferences_complete,
    profiles_compatible,
    discover_visible,
    validate_birth_year,
    vicinity_score_pct,
)


class TestNormalize:
    def test_normalize_gender_valid(self):
        assert normalize_gender("Man") == "man"
        assert normalize_gender(" woman ") == "woman"

    def test_normalize_gender_invalid(self):
        with pytest.raises(ValueError, match="Invalid gender"):
            normalize_gender("alien")

    def test_normalize_looking_for_valid(self):
        assert normalize_looking_for("Everyone") == "everyone"

    def test_normalize_looking_for_invalid(self):
        with pytest.raises(ValueError, match="Invalid preference"):
            normalize_looking_for("aliens")


class TestBirthYear:
    def test_valid_adult(self):
        validate_birth_year(1995, current_year=2026)

    def test_too_young(self):
        with pytest.raises(ValueError, match="18 or older"):
            validate_birth_year(2010, current_year=2026)

    def test_too_old(self):
        with pytest.raises(ValueError, match="18 or older"):
            validate_birth_year(1800, current_year=2026)


class TestGenderMatchesPreference:
    @pytest.mark.parametrize(
        "gender,looking_for,expected",
        [
            ("man", "everyone", True),
            ("woman", "everyone", True),
            ("man", "men", True),
            ("woman", "men", False),
            ("woman", "women", True),
            ("man", "women", False),
            ("nonbinary", "nonbinary", True),
            ("other", "nonbinary", True),
            ("man", "nonbinary", False),
            ("", "women", False),
        ],
    )
    def test_matches(self, gender, looking_for, expected):
        assert gender_matches_preference(gender, looking_for) is expected


class TestProfilePreferencesComplete:
    def test_complete_when_both_set(self):
        assert profile_preferences_complete("man", "women") is True

    def test_incomplete_when_missing(self):
        assert profile_preferences_complete("man", "") is False
        assert profile_preferences_complete("", "women") is False


class TestProfilesCompatible:
    def test_man_seeking_women_with_woman_seeking_men(self):
        assert profiles_compatible("man", "women", "woman", "men")

    def test_man_seeking_women_with_woman_seeking_women(self):
        assert not profiles_compatible("man", "women", "woman", "women")

    def test_everyone_matches_nonbinary(self):
        assert profiles_compatible("man", "everyone", "nonbinary", "men")

    def test_incomplete_profile(self):
        assert not profiles_compatible("man", "", "woman", "men")
        assert not profiles_compatible("man", "women", "woman", "")

    def test_nonbinary_seeking_nonbinary(self):
        assert profiles_compatible("nonbinary", "nonbinary", "other", "nonbinary")


class TestDiscoverVisible:
    def test_shows_candidate_matching_viewer_preference_without_theirs(self):
        assert discover_visible("man", "women", "woman", "")

    def test_hides_when_candidate_gender_not_in_viewer_preference(self):
        assert not discover_visible("man", "women", "man", "men")

    def test_requires_mutual_when_candidate_has_preferences(self):
        assert discover_visible("man", "women", "woman", "men")
        assert not discover_visible("man", "women", "woman", "women")

    def test_everyone_sees_nonbinary_candidate(self):
        assert discover_visible("man", "everyone", "nonbinary", "")

    def test_shows_candidate_with_no_gender_set(self):
        assert discover_visible("man", "women", "", "")


class TestCompatibilityScoring:
    def test_interest_overlap_jaccard(self):
        pct, shared = interest_overlap_pct(
            ["Hiking", "Coffee", "Live Music"],
            ["coffee", "yoga", "Live music"],
        )
        assert pct == 50
        assert "coffee" in [s.lower() for s in shared]
        assert "Live music" in shared

    def test_interest_overlap_empty_both_neutral(self):
        assert interest_overlap_pct([], []) == (50, [])

    def test_vicinity_same_city(self):
        assert vicinity_score_pct(viewer_city="Salt Lake City", candidate_city="salt lake city") == 100

    def test_vicinity_shared_event_plan(self):
        score = vicinity_score_pct(
            viewer_city="Denver",
            candidate_city="Boulder",
            shared_planned_events=1,
        )
        assert score >= 34

    def test_vicinity_same_check_in(self):
        assert vicinity_score_pct(
            viewer_city="",
            candidate_city="",
            same_check_in_event=True,
        ) == 100

    def test_compatibility_blend(self):
        assert compatibility_pct(80, 60) == 71
