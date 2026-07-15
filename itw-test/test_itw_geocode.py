"""Unit tests for In the Wild geocoding result selection."""

from __future__ import annotations

from itw_geocode import pick_best_geocode_result


class TestPickBestGeocodeResult:
    def test_prefers_utah_city_over_new_york_peak(self):
        rows = [
            {
                "lat": "42.0620352",
                "lon": "-74.5093200",
                "class": "natural",
                "type": "peak",
                "importance": 0.42,
                "display_name": "Eagle Mountain, Ulster County, New York, United States",
            },
            {
                "lat": "40.3093488",
                "lon": "-112.0119825",
                "class": "boundary",
                "type": "administrative",
                "importance": 0.37,
                "display_name": "Eagle Mountain, Utah County, Utah, United States",
            },
        ]
        lat, lng = pick_best_geocode_result(rows)
        assert lat == 40.3093488
        assert lng == -112.0119825

    def test_proximity_bias_when_near_provided(self):
        rows = [
            {
                "lat": "42.0620352",
                "lon": "-74.5093200",
                "class": "place",
                "type": "town",
                "importance": 0.5,
                "display_name": "Town A",
            },
            {
                "lat": "40.5584882",
                "lon": "-111.9367107",
                "class": "place",
                "type": "city",
                "importance": 0.4,
                "display_name": "South Jordan, Utah",
            },
        ]
        lat, lng = pick_best_geocode_result(rows, near_lat=40.31, near_lng=-112.01)
        assert lat == 40.5584882
        assert lng == -111.9367107
