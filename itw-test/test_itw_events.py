"""Unit tests for In the Wild event dedupe and radius helpers."""

from __future__ import annotations

from datetime import datetime

from itw_events import (
    EVENT_DISCOVERY_RADIUS_M,
    event_within_radius,
    is_duplicate_submission,
    normalize_event_identity,
)


class TestEventIdentity:
    def test_normalize_strips_and_lowers(self):
        assert normalize_event_identity("  Jazz Night ", " The Depot ", " Portland ") == (
            "jazz night",
            "the depot",
            "portland",
        )

    def test_duplicate_same_day(self):
        starts = datetime(2026, 8, 1, 19, 0, 0)
        assert is_duplicate_submission(
            existing_name="Jazz Night",
            existing_venue="The Depot",
            existing_city="Portland",
            existing_starts=starts,
            submit_name="jazz night",
            submit_venue="the depot",
            submit_city="portland",
            submit_starts=datetime(2026, 8, 1, 21, 0, 0),
        )

    def test_not_duplicate_different_day(self):
        assert not is_duplicate_submission(
            existing_name="Jazz Night",
            existing_venue="The Depot",
            existing_city="Portland",
            existing_starts=datetime(2026, 8, 1, 19, 0, 0),
            submit_name="Jazz Night",
            submit_venue="The Depot",
            submit_city="Portland",
            submit_starts=datetime(2026, 8, 2, 19, 0, 0),
        )


class TestEventRadius:
    def test_within_50_miles_portland_center(self):
        # ~3 miles apart
        assert event_within_radius(45.5152, -122.6784, 45.5238, -122.6810, EVENT_DISCOVERY_RADIUS_M)

    def test_outside_50_miles(self):
        # Portland vs Denver
        assert not event_within_radius(45.5152, -122.6784, 39.7392, -104.9903, EVENT_DISCOVERY_RADIUS_M)
