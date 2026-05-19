"""
Fetch recent Salt Lake Craigslist for-sale listings (HTML search page).

Uses curl_cffi when available (same approach as KSL). Parses ``cl-static-search-result``
rows — no per-listing detail fetch in v1 (title + price from search are enough for teasers).
"""

from __future__ import annotations

import logging
import os
import re
import time
from html import unescape
from typing import Any
from urllib.parse import urljoin

from tools.aggregated_listing import AggregatedListing

try:
    from curl_cffi.requests import Session as CurlSession
except ImportError:  # pragma: no cover
    CurlSession = None  # type: ignore[misc, assignment]

import httpx

log = logging.getLogger("craigslist-client")

RESULT_RE = re.compile(
    r'<li class="cl-static-search-result"[^>]*>(.*?)</li>', re.DOTALL | re.IGNORECASE
)
LINK_RE = re.compile(
    r'href="(https?://[^"]+/[a-z]+/d/[^"]+/(\d+)\.html)"', re.IGNORECASE
)
TITLE_RE = re.compile(r'class="title"[^>]*>([^<]+)', re.IGNORECASE)
PRICE_RE = re.compile(r'class="price"[^>]*>([^<]+)', re.IGNORECASE)
# Optional neighborhood in a dedicated element (not title parentheses).
NEIGHBORHOOD_RE = re.compile(
    r'class="location"[^>]*>([^<]+)', re.IGNORECASE
)

# First path segment after domain → our browse category.
CL_PREFIX_CATEGORY: dict[str, str] = {
    "ctd": "Vehicles",
    "mcy": "Vehicles",
    "boa": "Vehicles",
    "gra": "Vehicles",
    "rvs": "Vehicles",
    "atq": "Collectibles",
    "clt": "Collectibles",
    "elc": "Electronics",
    "cmp": "Electronics",
    "syp": "Electronics",
    "grd": "Home and Garden",
    "for": "Home and Garden",
    "fua": "Home and Garden",
    "hsh": "Home and Garden",
    "apa": "Real Estate",
    "reo": "Real Estate",
    "reb": "Real Estate",
    "lbd": "Jobs",
    "jjj": "Jobs",
    "ofc": "Jobs",
    "biz": "Services",
    "cfs": "Services",
    "lbs": "Pets",
    "pta": "Pets",
    "clo": "Clothing and Fashion",
    "sgl": "Sports and Outdoors",
    "spo": "Sports and Outdoors",
    "bik": "Sports and Outdoors",
}


def _site_base() -> str:
    return os.environ.get(
        "CRAIGSLIST_SITE", "https://saltlakecity.craigslist.org"
    ).rstrip("/")


def _search_path() -> str:
    return os.environ.get("CRAIGSLIST_SEARCH_PATH", "/search/sss")


def _max_default() -> int:
    try:
        return max(1, int(os.environ.get("CRAIGSLIST_IMPORT_MAX_LISTINGS", "10")))
    except ValueError:
        return 10


def _category_from_url(url: str) -> tuple[str, str]:
    m = re.search(r"\.craigslist\.org/([a-z]+)/d/", url)
    prefix = m.group(1) if m else ""
    cat = CL_PREFIX_CATEGORY.get(prefix, "Other")
    return cat, prefix.upper() if prefix else "Other"


def _teaser(title: str, price: str, *, max_len: int = 280) -> str:
    bits = [b for b in (title.strip(), price.strip()) if b]
    text = " — ".join(bits)
    if len(text) <= max_len:
        return text
    return text[: max_len - 1].rstrip() + "…"


def _parse_result_html(chunk: str, *, base: str) -> AggregatedListing | None:
    link_m = LINK_RE.search(chunk)
    if not link_m:
        return None
    source_url = link_m.group(1)
    listing_id = link_m.group(2)
    title_m = TITLE_RE.search(chunk)
    price_m = PRICE_RE.search(chunk)
    title = unescape(title_m.group(1).strip()) if title_m else "Craigslist listing"
    price = unescape(price_m.group(1).strip()) if price_m else ""
    city = ""
    hood_m = NEIGHBORHOOD_RE.search(chunk)
    if hood_m:
        city = unescape(hood_m.group(1).strip())
    category, sub = _category_from_url(source_url)
    return AggregatedListing(
        source="craigslist",
        source_listing_id=listing_id,
        source_url=source_url,
        title=title[:500],
        price=price[:100],
        description=_teaser(title, price),
        city=city[:120],
        state="Utah",
        category=category,
        sub_category=sub[:200],
        image_url=None,
    )


class CraigslistClient:
    def __init__(self, *, delay_sec: float | None = None, timeout_sec: float = 30.0) -> None:
        self._delay = delay_sec if delay_sec is not None else float(
            os.environ.get("CRAIGSLIST_REQUEST_DELAY_SEC", "0.6")
        )
        self._timeout = timeout_sec
        self._curl: Any = None
        self._httpx: httpx.Client | None = None
        self._last = 0.0
        self._use_curl = CurlSession is not None and os.environ.get(
            "CRAIGSLIST_IMPORT_USE_HTTPX", ""
        ).strip().lower() not in ("1", "true", "yes")

    def close(self) -> None:
        if self._curl is not None:
            self._curl.close()
            self._curl = None
        if self._httpx is not None:
            self._httpx.close()
            self._httpx = None

    def _sleep(self) -> None:
        if self._delay <= 0:
            return
        elapsed = time.monotonic() - self._last
        if elapsed < self._delay:
            time.sleep(self._delay - elapsed)

    def _get(self, url: str) -> tuple[int, str]:
        self._sleep()
        if self._use_curl:
            if self._curl is None:
                assert CurlSession is not None
                imp = os.environ.get("CRAIGSLIST_IMPORT_IMPERSONATE", "chrome124")
                self._curl = CurlSession(impersonate=imp)
                log.info("Craigslist HTTP backend: curl_cffi impersonate=%s", imp)
            raw = self._curl.get(url, timeout=self._timeout)
        else:
            if self._httpx is None:
                self._httpx = httpx.Client(
                    headers={
                        "User-Agent": (
                            "Mozilla/5.0 (compatible; t1Classifieds-Craigslist-Import/1.0)"
                        )
                    },
                    timeout=self._timeout,
                    follow_redirects=True,
                )
                log.info("Craigslist HTTP backend: httpx")
            raw = self._httpx.get(url)
        self._last = time.monotonic()
        return raw.status_code, raw.text

    def fetch_listings(self, *, limit: int | None = None) -> list[AggregatedListing]:
        cap = limit if limit is not None else _max_default()
        base = _site_base()
        url = urljoin(base + "/", _search_path().lstrip("/"))
        status, html = self._get(url)
        if status != 200:
            log.warning("Craigslist search returned HTTP %s for %s", status, url)
            return []
        out: list[AggregatedListing] = []
        seen: set[str] = set()
        for chunk in RESULT_RE.findall(html):
            row = _parse_result_html(chunk, base=base)
            if row is None or row.source_listing_id in seen:
                continue
            seen.add(row.source_listing_id)
            out.append(row)
            if len(out) >= cap:
                break
        log.info("Craigslist parsed %d listings (cap=%d)", len(out), cap)
        return out
