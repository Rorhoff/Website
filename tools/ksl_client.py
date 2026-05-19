"""
Fetch Utah listings from KSL Classifieds for the aggregator import.

Spike notes (2026-05):
- Legacy ``www.ksl.com/classifieds/api.php`` and ``/api/v1/listings`` return 404.
- Search HTML at ``classifieds.ksl.com/search?state=UT`` redirects to ``/v2/search``;
  listing IDs appear as ``/listing/<id>`` links in the SSR HTML (may 403 under heavy
  automated load — use polite delays and a identifying User-Agent).
- Per-listing detail pages expose schema.org Product JSON-LD + Open Graph tags; we do
  not scrape seller phone/email from KSL.

This module is importable from ``tools.sync_ksl_classifieds`` and unit-testable without DB.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx

log = logging.getLogger("ksl-client")

LISTING_ID_RE = re.compile(r"/listing/(\d+)")
CITY_UT_RE = re.compile(r"\sin\s+(.+?),\s*UT\s+on\s+KSL", re.IGNORECASE)
KSL_TAIL_RE = re.compile(
    r"\s+View a wide selection of.+$", re.IGNORECASE | re.DOTALL
)

# KSL browse taxonomy substring → our AD_CATEGORIES (classifieds_routes / SPA).
KSL_CATEGORY_MAP: list[tuple[str, str]] = [
    ("real estate", "Real Estate"),
    ("homes", "Real Estate"),
    ("apartments", "Real Estate"),
    ("vehicle", "Vehicles"),
    ("car", "Vehicles"),
    ("truck", "Vehicles"),
    ("motorcycle", "Vehicles"),
    ("atv", "Vehicles"),
    ("boat", "Vehicles"),
    ("snowmobile", "Vehicles"),
    ("trailer", "Vehicles"),
    ("electronics", "Electronics"),
    ("computer", "Electronics"),
    ("phone", "Electronics"),
    ("furniture", "Home and Garden"),
    ("home", "Home and Garden"),
    ("garden", "Home and Garden"),
    ("appliance", "Home and Garden"),
    ("clothing", "Clothing and Fashion"),
    ("fashion", "Clothing and Fashion"),
    ("shoe", "Clothing and Fashion"),
    ("jewelry", "Clothing and Fashion"),
    ("sport", "Sports and Outdoors"),
    ("outdoor", "Sports and Outdoors"),
    ("bike", "Sports and Outdoors"),
    ("pet", "Pets"),
    ("dog", "Pets"),
    ("cat", "Pets"),
    ("job", "Jobs"),
    ("service", "Services"),
    ("collectible", "Collectibles"),
]


@dataclass(frozen=True)
class KslListing:
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


def default_user_agent() -> str:
    contact = os.environ.get("KSL_IMPORT_CONTACT_EMAIL", "support@t1classifieds.com")
    return f"t1Classifieds-KSL-Import/1.0 (+https://t1classifieds.com; contact={contact})"


def map_ksl_category(ksl_taxonomy: str) -> tuple[str, str]:
    """Map KSL ``Category: Sub`` string to (category, sub_category)."""
    raw = (ksl_taxonomy or "").strip()
    if ":" in raw:
        cat_part, sub_part = raw.split(":", 1)
        sub = sub_part.strip() or "Other"
    else:
        cat_part, sub = raw, "Other"
    key = cat_part.lower()
    for needle, ours in KSL_CATEGORY_MAP:
        if needle in key:
            return ours, sub if sub != "Other" else cat_part.strip() or "Other"
    return "Other", sub if sub != "Other" else (cat_part.strip() or "Other")


def ksl_teaser(description: str, *, max_len: int = 280) -> str:
    text = KSL_TAIL_RE.sub("", (description or "").strip())
    if len(text) <= max_len:
        return text
    return text[: max_len - 1].rstrip() + "…"


def _parse_price(offers: dict[str, Any] | None, og_desc: str) -> str:
    if offers:
        price = offers.get("price")
        if price is not None:
            try:
                cents = float(price)
                if cents == int(cents):
                    return f"${int(cents):,}"
                return f"${cents:,.2f}"
            except (TypeError, ValueError):
                pass
    m = re.search(r"\$[\d,]+(?:\.\d{2})?", og_desc or "")
    return m.group(0) if m else ""


def _parse_taxonomy_from_html(html: str) -> str:
    m = re.search(r"<title>([^<]+)</title>", html, re.IGNORECASE)
    if not m:
        return ""
    title = m.group(1)
    parts = [p.strip() for p in title.split("|")]
    if len(parts) >= 3 and "ksl" in parts[-1].lower():
        return parts[-2]
    return ""


def _parse_json_ld(html: str) -> dict[str, Any] | None:
    for block in re.finditer(
        r'<script type="application/ld\+json">(.*?)</script>',
        html,
        re.DOTALL | re.IGNORECASE,
    ):
        try:
            data = json.loads(block.group(1))
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict) and data.get("@type") == "Product":
            return data
    return None


def _parse_og(html: str, prop: str) -> str:
    m = re.search(
        rf'<meta[^>]+property=["\']og:{re.escape(prop)}["\'][^>]+content=["\']([^"\']+)',
        html,
        re.IGNORECASE,
    )
    if m:
        return m.group(1).strip()
    m = re.search(
        rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:{re.escape(prop)}["\']',
        html,
        re.IGNORECASE,
    )
    return m.group(1).strip() if m else ""


def parse_listing_html(listing_id: str, html: str) -> KslListing | None:
    product = _parse_json_ld(html)
    og_title = _parse_og(html, "title")
    og_desc = _parse_og(html, "description")
    og_image = _parse_og(html, "image")

    if product:
        title = str(product.get("name") or og_title or "").strip()
        description = str(product.get("description") or og_desc or "").strip()
        source_url = str(product.get("url") or f"https://classifieds.ksl.com/listing/{listing_id}")
        offers = product.get("offers") if isinstance(product.get("offers"), dict) else None
        images = product.get("image")
        if not og_image and images:
            og_image = images[0] if isinstance(images, list) and images else str(images)
    else:
        title = og_title.strip()
        description = og_desc.strip()
        source_url = f"https://classifieds.ksl.com/listing/{listing_id}"
        offers = None

    if not title:
        return None

    taxonomy = _parse_taxonomy_from_html(html)
    category, sub_category = map_ksl_category(taxonomy)

    city_m = CITY_UT_RE.search(description)
    city = city_m.group(1).strip() if city_m else ""

    price = _normalize_price(_parse_price(offers, og_desc))
    teaser = ksl_teaser(description)

    return KslListing(
        source_listing_id=listing_id,
        source_url=source_url,
        title=title[:500],
        price=price,
        description=teaser,
        city=city[:120],
        state="Utah",
        category=category,
        sub_category=sub_category[:200],
        image_url=(og_image or None),
    )


def _normalize_price(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    if not s.startswith("$") and any(c.isdigit() for c in s):
        return f"${s}"
    return s


class KslClient:
    """Polite HTTP client for KSL search + listing pages."""

    def __init__(
        self,
        *,
        user_agent: str | None = None,
        delay_sec: float | None = None,
        timeout_sec: float = 30.0,
    ) -> None:
        self._user_agent = user_agent or default_user_agent()
        self._delay = delay_sec if delay_sec is not None else float(
            os.environ.get("KSL_REQUEST_DELAY_SEC", "0.45")
        )
        self._timeout = timeout_sec
        self._last_request_at = 0.0

    def _sleep_polite(self) -> None:
        if self._delay <= 0:
            return
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < self._delay:
            time.sleep(self._delay - elapsed)

    def _get(self, url: str, *, retries: int = 3) -> httpx.Response:
        last_err: Exception | None = None
        for attempt in range(retries):
            self._sleep_polite()
            try:
                with httpx.Client(
                    headers={"User-Agent": self._user_agent, "Accept": "text/html,application/json"},
                    timeout=self._timeout,
                    follow_redirects=True,
                ) as client:
                    resp = client.get(url)
                self._last_request_at = time.monotonic()
            except httpx.HTTPError as exc:
                last_err = exc
                time.sleep(1.5 * (attempt + 1))
                continue
            if resp.status_code in (403, 429, 503) and attempt < retries - 1:
                time.sleep(2.0 * (attempt + 1))
                continue
            return resp
        raise RuntimeError(f"KSL request failed for {url}") from last_err

    def fetch_search_listing_ids(
        self,
        *,
        max_pages: int = 50,
        state: str = "UT",
    ) -> list[str]:
        """Collect listing IDs from paginated Utah search HTML."""
        seen: list[str] = []
        seen_set: set[str] = set()
        for page in range(1, max_pages + 1):
            qs = urlencode({"state": state, "page": page})
            url = f"https://classifieds.ksl.com/v2/search?{qs}"
            if page == 1:
                url = f"https://classifieds.ksl.com/search?{qs}"
            resp = self._get(url)
            if resp.status_code != 200:
                log.warning("KSL search page %s returned %s", page, resp.status_code)
                break
            ids = LISTING_ID_RE.findall(resp.text)
            if not ids:
                break
            new_on_page = 0
            for lid in ids:
                if lid in seen_set:
                    continue
                seen_set.add(lid)
                seen.append(lid)
                new_on_page += 1
            log.info("KSL search page %s: %d ids (%d new)", page, len(ids), new_on_page)
            if new_on_page == 0:
                break
        return seen

    def fetch_listing(self, listing_id: str) -> KslListing | None:
        url = f"https://classifieds.ksl.com/listing/{listing_id}"
        resp = self._get(url)
        if resp.status_code == 404:
            return None
        if resp.status_code != 200:
            log.warning("KSL listing %s HTTP %s", listing_id, resp.status_code)
            return None
        return parse_listing_html(listing_id, resp.text)
