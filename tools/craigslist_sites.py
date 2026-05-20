"""
Primary Craigslist regional site per US state (matches ``static/classifieds/cities.js`` keys).

One metro subdomain per state — not exhaustive coverage, but gives each state a
representative for-sale feed for the daily import cap.
"""

from __future__ import annotations

# State display name → https://{subdomain}.craigslist.org
STATE_CRAIGSLIST_SITE: dict[str, str] = {
    "Alabama": "https://mobile.craigslist.org",
    "Alaska": "https://anchorage.craigslist.org",
    "Arizona": "https://phoenix.craigslist.org",
    "Arkansas": "https://littlerock.craigslist.org",
    "California": "https://losangeles.craigslist.org",
    "Colorado": "https://denver.craigslist.org",
    "Connecticut": "https://hartford.craigslist.org",
    "Delaware": "https://delaware.craigslist.org",
    "Florida": "https://miami.craigslist.org",
    "Georgia": "https://atlanta.craigslist.org",
    "Hawaii": "https://honolulu.craigslist.org",
    "Idaho": "https://boise.craigslist.org",
    "Illinois": "https://chicago.craigslist.org",
    "Indiana": "https://indianapolis.craigslist.org",
    "Iowa": "https://desmoines.craigslist.org",
    "Kansas": "https://wichita.craigslist.org",
    "Kentucky": "https://louisville.craigslist.org",
    "Louisiana": "https://neworleans.craigslist.org",
    "Maine": "https://maine.craigslist.org",
    "Maryland": "https://baltimore.craigslist.org",
    "Massachusetts": "https://boston.craigslist.org",
    "Michigan": "https://detroit.craigslist.org",
    "Minnesota": "https://minneapolis.craigslist.org",
    "Mississippi": "https://jackson.craigslist.org",
    "Missouri": "https://kansascity.craigslist.org",
    "Montana": "https://billings.craigslist.org",
    "Nebraska": "https://omaha.craigslist.org",
    "Nevada": "https://lasvegas.craigslist.org",
    "New Hampshire": "https://nh.craigslist.org",
    "New Jersey": "https://newjersey.craigslist.org",
    "New Mexico": "https://albuquerque.craigslist.org",
    "New York": "https://newyork.craigslist.org",
    "North Carolina": "https://charlotte.craigslist.org",
    "North Dakota": "https://fargo.craigslist.org",
    "Ohio": "https://columbus.craigslist.org",
    "Oklahoma": "https://oklahomacity.craigslist.org",
    "Oregon": "https://portland.craigslist.org",
    "Pennsylvania": "https://philadelphia.craigslist.org",
    "Rhode Island": "https://providence.craigslist.org",
    "South Carolina": "https://charleston.craigslist.org",
    "South Dakota": "https://siouxfalls.craigslist.org",
    "Tennessee": "https://nashville.craigslist.org",
    "Texas": "https://houston.craigslist.org",
    "Utah": "https://saltlakecity.craigslist.org",
    "Vermont": "https://vermont.craigslist.org",
    "Virginia": "https://richmond.craigslist.org",
    "Washington": "https://seattle.craigslist.org",
    "West Virginia": "https://charlestonwv.craigslist.org",
    "Wisconsin": "https://milwaukee.craigslist.org",
    "Wyoming": "https://wyoming.craigslist.org",
}


def states_to_sync() -> list[tuple[str, str]]:
    """Return (state_name, site_base_url) pairs in stable order."""
    return sorted(STATE_CRAIGSLIST_SITE.items(), key=lambda x: x[0])
