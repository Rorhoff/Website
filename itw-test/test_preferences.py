"""Unit tests for In the Wild preference matching (no database)."""

import pytest

from itw_preferences import (
    gender_matches_preference,
    normalize_gender,
    normalize_looking_for,
    profile_preferences_complete,
    profiles_compatible,
    validate_birth_year,
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
