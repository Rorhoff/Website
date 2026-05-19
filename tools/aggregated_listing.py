"""Normalized external listing row used by import sync jobs."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AggregatedListing:
    source: str
    source_listing_id: str
    source_url: str
    title: str
    price: str
    description: str
    city: str
    state: str
    category: str
    sub_category: str
    image_url: str | None
