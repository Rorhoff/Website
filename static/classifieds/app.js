/**
 * Classifieds SPA client. API base: /api/classifieds (see classifieds_routes.py).
 * Token: localStorage CLASSIFIED_TOKEN_KEY; sent as Authorization: Bearer.
 * Images: uploaded one-by-one to /uploads (returns a public URL) before the ad payload
 *   is POSTed; falls back to inline base64 when the server has no storage configured.
 * When adding endpoints, mirror paths here and in FastAPI router.
 */
const CLASSIFIED_TOKEN_KEY = "classified_api_session";
const PROFILE_ACTIVE_KEY = "classified_profile_active";
const PROFILE_TAB_KEY = "classified_profile_tab"; // "profile" | "postAd"

const registerForm = document.getElementById("registerForm");
const loginForm = document.getElementById("loginForm");
const profileForm = document.getElementById("profileForm");
const adForm = document.getElementById("adForm");
const adPriceInput = document.getElementById("adPrice");
const authSection = document.getElementById("authSection");
const profileSection = document.getElementById("profileSection");
const postAdSection = document.getElementById("postAdSection");
const myAdsSection = document.getElementById("myAdsSection");
const myAdsList = document.getElementById("myAdsList");
const myAdsHint = document.getElementById("myAdsHint");
const deleteAdModal = document.getElementById("deleteAdModal");
const deleteAdRefundBreakdown = document.getElementById("deleteAdRefundBreakdown");
const deleteAdCancelBtn = document.getElementById("deleteAdCancelBtn");
const deleteAdConfirmBtn = document.getElementById("deleteAdConfirmBtn");
let pendingDeleteAdId = null;
const refreshMyAdsBtn = document.getElementById("refreshMyAdsBtn");
const profileTabsNav = document.getElementById("profileTabs");
const profileTabButtons = profileTabsNav
  ? Array.from(profileTabsNav.querySelectorAll(".profile-tab"))
  : [];
const menuWrapper = document.getElementById("menuWrapper");
const menuToggleBtn = document.getElementById("menuToggleBtn");
const menuPanel = document.getElementById("menuPanel");
const enterProfileBtn = document.getElementById("enterProfileBtn");
const exitProfileBtn = document.getElementById("exitProfileBtn");
const logoutBtn = document.getElementById("logoutBtn");
const profileStateSelect = document.getElementById("profileState");
const profileEmailInput = document.getElementById("profileEmail");
const profilePhoneInput = document.getElementById("profilePhone");
const adStateSelect = document.getElementById("adState");
const adCitySelect = document.getElementById("adCity");
const adCityOtherInput = document.getElementById("adCityOther");
const adContactNameInput = document.getElementById("adContactName");
const adImagesInput = document.getElementById("adImages");
const adsList = document.getElementById("adsList");
const adsBrowseSection = document.getElementById("adsBrowseSection");
const adsSectionTitle = document.getElementById("adsSectionTitle");
// (adsFiltersWrap removed in prod-v1.11 — the filter controls moved into
// #filterModal opened from the topbar filter button.)
const homeCategoryFilter = document.getElementById("homeCategoryFilter");
const HOME_CATEGORY_FILTER_KEY = "classified_home_category_filter";

// Keep this in sync with the <select id="adCategory"> options in index.html — the browse
// filter offers the same choices plus an "All categories" sentinel.
const AD_CATEGORIES = [
  "Clothing and Fashion",
  "Collectibles",
  "Electronics",
  "Home and Garden",
  "Jobs",
  "Pets",
  "Real Estate",
  "Services",
  "Sports and Outdoors",
  "Vehicles",
];

// Sub-categories shown after the user picks a category in the Post Ad form. Edit freely —
// the backend stores subCategory as an arbitrary string, so adding/renaming entries here
// only affects what's offered to new posters. Existing ads keep whatever string was saved.
const AD_SUB_CATEGORIES = {
  "Clothing and Fashion": [
    "Men's Clothing", "Women's Clothing", "Kids & Baby", "Shoes",
    "Bags & Accessories", "Jewelry & Watches", "Other",
  ],
  "Collectibles": [
    "Coins & Currency", "Stamps", "Trading Cards", "Antiques",
    "Memorabilia", "Art", "Other",
  ],
  "Electronics": [
    "Phones & Accessories", "Computers & Laptops", "TVs & Home Theater",
    "Cameras & Photo", "Audio & Headphones", "Video Games & Consoles",
    "Smart Home", "Other",
  ],
  "Home and Garden": [
    "Furniture", "Appliances", "Tools", "Kitchen & Dining",
    "Bedding & Bath", "Garden & Outdoor", "Decor", "Other",
  ],
  "Jobs": [
    "Full-time", "Part-time", "Contract", "Internship", "Remote", "Gig", "Other",
  ],
  "Pets": [
    "Dogs", "Cats", "Birds", "Fish & Aquariums", "Reptiles & Amphibians",
    "Small Animals", "Pet Supplies", "Other",
  ],
  "Real Estate": [
    "For Sale - House", "For Sale - Condo/Townhome", "For Rent - House",
    "For Rent - Apartment", "Land", "Commercial", "Vacation Rental", "Other",
  ],
  "Services": [
    "Cleaning", "Handyman & Home Repair", "Lawn & Landscaping",
    "Tutoring & Lessons", "Photography & Video", "Moving & Hauling",
    "Pet Services", "Computer & Tech", "Beauty & Wellness",
    "Legal & Financial", "Other",
  ],
  "Sports and Outdoors": [
    "Bicycles", "Camping & Hiking", "Fitness & Exercise",
    "Hunting & Fishing", "Team Sports", "Water Sports",
    "Winter Sports", "Other",
  ],
  "Vehicles": [
    "Cars", "Trucks", "SUVs", "Motorcycles", "RVs & Campers",
    "Boats & Watercraft", "Trailers", "ATVs & UTVs", "Parts & Accessories", "Other",
  ],
};

function populateHomeCategoryFilter() {
  if (!homeCategoryFilter) return;
  const saved = localStorage.getItem(HOME_CATEGORY_FILTER_KEY) || "";
  homeCategoryFilter.innerHTML =
    '<option value="">All categories</option>' +
    AD_CATEGORIES.map(
      (c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`
    ).join("");
  // Restore the user's last-used filter on reload — if the stored category no longer exists
  // (renamed/removed), the select silently falls back to "All categories" since the value
  // simply won't match any <option>.
  if (saved) homeCategoryFilter.value = saved;
}
populateHomeCategoryFilter();

// Wire the Post Ad sub-category dropdown to refresh whenever the user changes the category.
// Without this, the sub-category select is permanently stuck on "Select category first" and
// the form can't be submitted (subCategory is a required field).
function wireAdSubCategorySelect() {
  const catSelect = document.getElementById("adCategory");
  const subSelect = document.getElementById("adSubCategory");
  if (!catSelect || !subSelect) return;

  function repopulate() {
    const cat = catSelect.value;
    const options = AD_SUB_CATEGORIES[cat] || [];
    if (!options.length) {
      subSelect.innerHTML = '<option value="">Select category first</option>';
      subSelect.disabled = true;
      return;
    }
    subSelect.disabled = false;
    subSelect.innerHTML =
      '<option value="">Select a sub category</option>' +
      options
        .map((s) => `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`)
        .join("");
  }

  catSelect.addEventListener("change", repopulate);
  repopulate();
}
wireAdSubCategorySelect();

// Cascading state -> city dropdown on the Post Ad form. Data lives in
// window.CITIES_BY_STATE (loaded from cities.js). When the state changes we
// repopulate the city dropdown with that state's curated city list plus an
// "Other (type city)..." sentinel — selecting it reveals a free-text input
// so smaller towns aren't locked out. We DO NOT mark the free-text input
// `required` in HTML; instead the form-submit handler enforces "city must
// be non-empty" so the user only fails validation when they actually try
// to post.
const AD_CITY_OTHER_SENTINEL = "__other__";

function wireAdCitySelect() {
  if (!adStateSelect || !adCitySelect || !adCityOtherInput) return;
  const cityMap = window.CITIES_BY_STATE || {};

  function repopulate() {
    const state = adStateSelect.value;
    const list = cityMap[state] || [];
    if (!state || !list.length) {
      adCitySelect.innerHTML = '<option value="">Select a state first</option>';
      adCitySelect.disabled = true;
      adCityOtherInput.hidden = true;
      adCityOtherInput.value = "";
      adCityOtherInput.required = false;
      return;
    }
    adCitySelect.disabled = false;
    // Alpha-sort here so the source data in cities.js can stay in
    // population order (easier to maintain) without surprising users.
    const sorted = [...list].sort((a, b) => a.localeCompare(b));
    adCitySelect.innerHTML =
      '<option value="">Select a city</option>' +
      sorted
        .map((c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`)
        .join("") +
      `<option value="${AD_CITY_OTHER_SENTINEL}">Other (type city)…</option>`;
    // Hide the free-text input by default; it shows only when the user
    // explicitly chooses "Other…".
    adCityOtherInput.hidden = true;
    adCityOtherInput.value = "";
    adCityOtherInput.required = false;
  }

  function onCityChange() {
    const isOther = adCitySelect.value === AD_CITY_OTHER_SENTINEL;
    adCityOtherInput.hidden = !isOther;
    adCityOtherInput.required = isOther;
    if (isOther) {
      adCityOtherInput.focus();
    } else {
      adCityOtherInput.value = "";
    }
  }

  adStateSelect.addEventListener("change", repopulate);
  adCitySelect.addEventListener("change", onCityChange);
  repopulate();
}
wireAdCitySelect();

// Auto-format the price field as soon as the user tabs/clicks away. Calling
// formatPrice on input would fight the user mid-typing (e.g. eating digits
// they paused on), so we only canonicalize on blur. Submit re-runs it as a
// final guard in case someone tabs straight from "100$" to the submit button.
if (adPriceInput) {
  adPriceInput.addEventListener("blur", () => {
    const next = formatPrice(adPriceInput.value);
    if (next !== adPriceInput.value) adPriceInput.value = next;
  });
}
const authStatus = document.getElementById("authStatus");
const profileHint = document.getElementById("profileHint");
const toast = document.getElementById("toast");

let sessionToken = localStorage.getItem(CLASSIFIED_TOKEN_KEY);
let cachedUser = null;

function setSessionToken(token) {
  sessionToken = token || null;
  if (sessionToken) {
    localStorage.setItem(CLASSIFIED_TOKEN_KEY, sessionToken);
  } else {
    localStorage.removeItem(CLASSIFIED_TOKEN_KEY);
  }
}

function getCurrentUser() {
  return cachedUser?.username ?? null;
}

function getCurrentUserRecord() {
  return cachedUser;
}

function isProfileActive() {
  return localStorage.getItem(PROFILE_ACTIVE_KEY) === "true";
}

function setProfileActive(active) {
  localStorage.setItem(PROFILE_ACTIVE_KEY, active ? "true" : "false");
}

const PROFILE_TABS = ["profile", "postAd", "myAds"];

function getActiveProfileTab() {
  const stored = localStorage.getItem(PROFILE_TAB_KEY);
  return PROFILE_TABS.includes(stored) ? stored : "profile";
}

function setActiveProfileTab(tab) {
  const normalized = PROFILE_TABS.includes(tab) ? tab : "profile";
  localStorage.setItem(PROFILE_TAB_KEY, normalized);
}

function applyProfileTabUI() {
  // Show/hide the three panes and update the tab strip's aria-selected state. Called from
  // updateAuthUI() and from the tab click handlers — both flows should converge here so
  // the visible pane and the highlighted tab stay in sync. When the My Ads tab becomes
  // visible we fire-and-forget renderMyAds() so the user always sees fresh data without
  // having to hit Refresh.
  const profileActive = Boolean(getCurrentUserRecord()) && isProfileActive();
  if (profileTabsNav) profileTabsNav.hidden = !profileActive;
  const activeTab = getActiveProfileTab();
  if (profileSection) profileSection.hidden = !profileActive || activeTab !== "profile";
  if (postAdSection) postAdSection.hidden = !profileActive || activeTab !== "postAd";
  if (myAdsSection) myAdsSection.hidden = !profileActive || activeTab !== "myAds";
  profileTabButtons.forEach((btn) => {
    const selected = btn.dataset.tab === activeTab;
    btn.setAttribute("aria-selected", selected ? "true" : "false");
  });
  if (profileActive && activeTab === "myAds") {
    renderMyAds().catch(() => { /* renderMyAds surfaces errors via the hint line */ });
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  setTimeout(() => {
    toast.hidden = true;
  }, 2200);
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Canonicalize prices to "$<value>". Mirrors classifieds_routes._normalize_price
// so the field looks the same whether the value is freshly typed (formatted on
// blur), freshly saved (server-side), or read back from a legacy row (server-
// side fallback in _ad_out). We strip a leading or trailing "$" + adjacent
// whitespace, then re-prepend "$" only when the remaining string contains a
// digit — that keeps free-form values like "Free" or "Negotiable" intact.
function formatPrice(raw) {
  if (raw == null) return "";
  let s = String(raw).trim();
  if (!s) return "";
  s = s.replace(/^\s*\$\s*/, "").replace(/\s*\$\s*$/, "").trim();
  if (!s) return "";
  return /\d/.test(s) ? `$${s}` : s;
}

function closeMenu() {
  menuPanel.hidden = true;
}

function setAuthSectionVisibility(isVisible) {
  authSection.hidden = !isVisible;
  authSection.style.display = isVisible ? "grid" : "none";
}

function detailMessage(payload, fallback) {
  const detail = payload?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (typeof d === "object" && d?.msg ? d.msg : JSON.stringify(d)))
      .join("; ");
  }
  return fallback || "Request failed.";
}

async function classifiedsApi(path, { method = "GET", jsonBody, withAuth = true } = {}) {
  const headers = {};
  if (jsonBody !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (withAuth && sessionToken) {
    headers.Authorization = `Bearer ${sessionToken}`;
  }
  const r = await fetch(`/api/classifieds${path}`, {
    method,
    headers,
    body: jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined,
    credentials: "same-origin",
  });
  let payload = {};
  try {
    payload = await r.json();
  } catch {
    payload = {};
  }
  if (!r.ok) {
    const msg = detailMessage(payload, r.statusText || `HTTP ${r.status}`);
    const err = new Error(msg);
    err.status = r.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

async function refreshMe() {
  if (!sessionToken) {
    cachedUser = null;
    return null;
  }
  try {
    cachedUser = await classifiedsApi("/me");
    return cachedUser;
  } catch {
    cachedUser = null;
    setSessionToken(null);
    return null;
  }
}

function updateAuthUI() {
  const currentUser = getCurrentUser();
  const userRecord = getCurrentUserRecord();
  const profileActive = Boolean(userRecord) && isProfileActive();

  setAuthSectionVisibility(!currentUser);
  menuWrapper.hidden = !userRecord;
  applyProfileTabUI(); // owns visibility of #profileSection and #postAdSection + tab strip
  adForm.querySelector("button").disabled = !profileActive;
  enterProfileBtn.hidden = profileActive;
  exitProfileBtn.hidden = !profileActive;
  logoutBtn.hidden = !userRecord;

  if (userRecord) {
    authStatus.textContent = `${userRecord.username} (${userRecord.state})`;
    profileHint.textContent = "Use the top-right menu to enter your profile.";
    profileStateSelect.value = userRecord.state;
    adStateSelect.value = userRecord.state;
    // Programmatic assignment of a <select>'s .value does NOT fire a
    // "change" event, so the cascading city dropdown stays empty until
    // the user touches the state field. Fire it manually so the city
    // list is ready immediately after the profile loads.
    adStateSelect.dispatchEvent(new Event("change"));
    if (profileEmailInput) profileEmailInput.value = userRecord.email || "";
    if (profilePhoneInput) profilePhoneInput.value = userRecord.phone || "";
  } else {
    authStatus.textContent = "Not logged in";
    profileHint.textContent = "Log in, then use the top-right menu to enter your profile.";
    closeMenu();
  }

  const showAdsBrowse = Boolean(userRecord) && !isProfileActive();
  if (adsBrowseSection) {
    adsBrowseSection.hidden = !showAdsBrowse;
    adsBrowseSection.style.display = showAdsBrowse ? "" : "none";
  }
  // Topbar filter button only makes sense when the browse list is what the user
  // is looking at. In profile mode (My Ads / Post Ad / Profile tabs), hide it so
  // it can't be tapped while it'd have no visible effect.
  const filterBtn = document.getElementById("topbarFilterBtn");
  if (filterBtn) filterBtn.hidden = !showAdsBrowse;
}

// --- Browse list pagination (server + infinite scroll) -----------------
// Backend returns `{ ads, hasMore }` keyed off OFFSET — fine until a state's
// total catalog balloons into millions of concurrent rows per state at which point
// we'd graduate to composite keyset paging (see classifieds_list_ads docstring).
const ADS_PAGE_SIZE = 48;
let browseNextOffset = 0;
let browseHasMorePages = false;
let browseInfiniteLoading = false;
let adsInfiniteObserver = null;

function getBrowseFilterSelections() {
  return {
    category: homeCategoryFilter ? homeCategoryFilter.value.trim() : "",
    subCategory: homeSubCategoryFilter ? homeSubCategoryFilter.value.trim() : "",
  };
}

function browseAdsQueryString(offset) {
  const { category, subCategory } = getBrowseFilterSelections();
  const qs = new URLSearchParams();
  qs.set("limit", String(ADS_PAGE_SIZE));
  qs.set("offset", String(offset));
  if (category) qs.set("category", category);
  if (subCategory) qs.set("subCategory", subCategory);
  return qs.toString();
}

function isImportedAd(ad) {
  const src = ad && ad.listingSource;
  return Boolean(ad && (ad.isImported || (src && src !== "user")));
}

function importSourceShortLabel(ad) {
  if (!ad) return "External";
  if (ad.listingSource === "ksl") return "KSL";
  if (ad.listingSource === "craigslist") return "Craigslist";
  return "External";
}

function importViewOnLabel(ad) {
  return `View on ${importSourceShortLabel(ad)}`;
}

const IMPORT_AGGREGATION_DISCLAIMER =
  "Some Utah listings are aggregated from KSL and Craigslist with links to the originals. We do not claim ownership of those listings.";

function descriptionForImportedAd(ad) {
  const base = (ad?.description || "").trim();
  if (!isImportedAd(ad)) return base;
  const viaLine = `Via ${importSourceShortLabel(ad)}.`;
  let text = base;
  if (!/^via\s/i.test(text)) {
    text = text ? `${viaLine}\n\n${text}` : viaLine;
  }
  if (!text.includes("do not claim ownership")) {
    text = `${text}\n\n${IMPORT_AGGREGATION_DISCLAIMER}`;
  }
  return text.trim();
}

function renderBrowseTileMarkup(ad) {
  const firstImage = (ad.images || []).find(Boolean) || "";
  const goldClass = isGoldActive(ad) && !isImportedAd(ad) ? " ad-tile--gold" : "";
  const kslClass = isImportedAd(ad) ? " ad-tile--ksl" : "";
  const imageHtml = firstImage
    ? `<img class="ad-tile-image" src="${escapeHTML(firstImage)}" alt="${escapeHTML(ad.title || "Ad")}" loading="lazy" />`
    : `<div class="ad-tile-empty">${escapeHTML(ad.title || "No image")}</div>`;
  const priceLabel = formatPrice(ad.price);
  const viaNote = isImportedAd(ad) ? ` — Via ${importSourceShortLabel(ad)}` : "";
  const aria = `${ad.title || "Ad"} — ${priceLabel}${viaNote}`;
  return `
      <button type="button" class="ad-tile${goldClass}${kslClass}" data-detail-ad-id="${escapeHTML(ad.id)}" aria-label="${escapeHTML(aria)}">
        ${imageHtml}
        <span class="ad-tile-price">${escapeHTML(priceLabel)}</span>
      </button>
    `;
}

function teardownAdsInfiniteScroll() {
  if (adsInfiniteObserver) {
    adsInfiniteObserver.disconnect();
    adsInfiniteObserver = null;
  }
}

function attachAdsInfiniteScroll() {
  const sentinel = document.getElementById("adsInfiniteSentinel");
  if (!sentinel) return;
  teardownAdsInfiniteScroll();
  if (!browseHasMorePages || !sessionToken || isProfileActive()) return;
  adsInfiniteObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        if (!browseHasMorePages || browseInfiniteLoading) continue;
        if (isProfileActive() || !getCurrentUserRecord()) continue;
        loadMoreBrowseAds();
      }
    },
    /* Begin loading shortly before the user hits the sentinel so mobile scroll
       feels continuous; root:null → viewport-relative. */
    { root: null, rootMargin: "480px 0px", threshold: 0 },
  );
  adsInfiniteObserver.observe(sentinel);
}

function setInfiniteStatusUi() {
  const el = document.getElementById("adsInfiniteStatus");
  if (!el) return;
  if (!getCurrentUserRecord() || isProfileActive()) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  if (browseInfiniteLoading) {
    el.hidden = false;
    el.textContent = "Loading more listings…";
    return;
  }
  if (!browseHasMorePages && browseNextOffset > 0 && lastRenderedBrowseList.length > 0) {
    /* optional — don't nag if only one tiny page existed */
    el.hidden = false;
    el.textContent =
      browseNextOffset >= ADS_PAGE_SIZE ? "You've reached the end of the listings." : "";
    if (!el.textContent) el.hidden = true;
    return;
  }
  el.hidden = true;
  el.textContent = "";
}

async function loadMoreBrowseAds() {
  if (
    browseInfiniteLoading ||
    !browseHasMorePages ||
    !getCurrentUserRecord() ||
    isProfileActive()
  ) {
    return;
  }
  browseInfiniteLoading = true;
  setInfiniteStatusUi();
  try {
    const qs = browseAdsQueryString(browseNextOffset);
    const payload = await classifiedsApi(`/ads?${qs}`);
    const pageAds =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload.ads || []
        : Array.isArray(payload)
          ? payload
          : [];
    const hasMore = Boolean(payload && typeof payload === "object" && payload.hasMore);
    browseHasMorePages = hasMore;
    lastRenderedBrowseList = lastRenderedBrowseList.concat(pageAds);
    browseNextOffset += pageAds.length;
    adsList.insertAdjacentHTML("beforeend", pageAds.map((a) => renderBrowseTileMarkup(a)).join(""));
  } catch {
    showToast("Could not load more listings.");
  } finally {
    browseInfiniteLoading = false;
    setInfiniteStatusUi();
    teardownAdsInfiniteScroll();
    attachAdsInfiniteScroll();
  }
}

async function renderAds() {
  const userRecord = getCurrentUserRecord();
  if (!userRecord || isProfileActive()) {
    adsList.innerHTML = "";
    teardownAdsInfiniteScroll();
    browseHasMorePages = false;
    browseNextOffset = 0;
    lastRenderedBrowseList = [];
    const st = document.getElementById("adsInfiniteStatus");
    if (st) {
      st.hidden = true;
      st.textContent = "";
    }
    if (adsActiveFilterEl) adsActiveFilterEl.hidden = true;
    return;
  }

  teardownAdsInfiniteScroll();
  browseInfiniteLoading = false;
  browseHasMorePages = false;
  browseNextOffset = 0;
  lastRenderedBrowseList = [];

  try {
    if (adsSectionTitle) adsSectionTitle.textContent = userRecord.state;
    browseInfiniteLoading = true;
    setInfiniteStatusUi();

    const qs = browseAdsQueryString(0);
    const payload = await classifiedsApi(`/ads?${qs}`);
    const ads =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? payload.ads || []
        : Array.isArray(payload)
          ? payload
          : [];
    const hasMore = Boolean(payload && typeof payload === "object" && payload.hasMore);

    lastRenderedBrowseList = [...ads];
    browseNextOffset = ads.length;
    browseHasMorePages = hasMore;

    const selectedCategory = getBrowseFilterSelections().category;
    const selectedSubCategory = getBrowseFilterSelections().subCategory;

    if (adsActiveFilterEl) {
      if (selectedCategory || selectedSubCategory) {
        const bits = [];
        if (selectedCategory) bits.push(escapeHTML(selectedCategory));
        if (selectedSubCategory) bits.push(escapeHTML(selectedSubCategory));
        adsActiveFilterEl.innerHTML =
          `Filtered: ${bits.join(" / ")}` +
          ` &middot; <a href="#" id="adsClearFilterLink">Clear</a>`;
        adsActiveFilterEl.hidden = false;
      } else {
        adsActiveFilterEl.innerHTML = "";
        adsActiveFilterEl.hidden = true;
      }
    }

    if (!ads.length) {
      adsList.innerHTML = `<p>${
        selectedCategory || selectedSubCategory
          ? `No matching ads in ${escapeHTML(userRecord.state)} right now.`
          : `No ads posted yet for ${escapeHTML(userRecord.state)}.`
      }</p>`;
      browseHasMorePages = false;
      teardownAdsInfiniteScroll();
      return;
    }

    adsList.innerHTML = ads.map((ad) => renderBrowseTileMarkup(ad)).join("");
    attachAdsInfiniteScroll();
  } catch (error) {
    adsList.innerHTML = `<p class="hint">Could not load ads: ${escapeHTML(error.message)}</p>`;
    teardownAdsInfiniteScroll();
    browseHasMorePages = false;
    browseNextOffset = 0;
    lastRenderedBrowseList = [];
  } finally {
    browseInfiniteLoading = false;
    setInfiniteStatusUi();
  }
}

async function renderMyAds() {
  // Renders the current user's own ads (any state) into the "My Ads" tab.
  if (!myAdsList) return;
  const userRecord = getCurrentUserRecord();
  if (!userRecord) {
    myAdsList.innerHTML = "";
    if (myAdsHint) myAdsHint.textContent = "Log in to see your ads.";
    return;
  }
  if (myAdsHint) myAdsHint.textContent = "Loading…";
  try {
    const ads = await classifiedsApi("/me/ads");
    ads.sort((a, b) => b.createdAt - a.createdAt);
    // Cache the My Ads list for swipe navigation, mirroring renderAds.
    lastRenderedMyAdsList = ads;
    if (!ads.length) {
      if (myAdsHint) myAdsHint.textContent = "You haven't posted any ads yet.";
      myAdsList.innerHTML = "";
      return;
    }
    if (myAdsHint) {
      myAdsHint.textContent = `You have ${ads.length} ad${ads.length === 1 ? "" : "s"} posted.`;
    }
    // My Ads cards: compact, click-to-expand. We deliberately *don't* render the
    // full description — it lives in the detail modal that opens on click, same
    // modal the public browse uses (data-detail-ad-id triggers it). Actions are
    // pinned bottom-right via flex `margin-top: auto` so the card height can vary
    // with title length without the buttons drifting around the viewport.
    myAdsList.innerHTML = ads
      .map((ad) => {
        const gold = isGoldActive(ad);
        const goldClass = gold ? " my-ad-card--gold" : "";
        const boostLabel = gold ? "Extend ★" : "Gold ★";
        const boostBtn = goldConfig?.enabled
          ? `<button type="button" class="my-ad-boost" data-boost-ad-id="${escapeHTML(ad.id)}">${boostLabel}</button>`
          : "";
        // Repost button is intentionally rendered as a disabled-looking stub
        // until the $3/month re-list subscription ships. We deliberately do not
        // set the `disabled` attribute so the click handler can still fire on
        // mobile (where there is no hover tooltip) and surface a toast that
        // explains how to unlock the feature.
        const repostBtn = `<button type="button" class="my-ad-repost" data-repost-ad-id="${escapeHTML(ad.id)}" aria-disabled="true" title="Reposting unlocks with the $3/month Pro Re-list subscription (coming soon).">Repost</button>`;
        const firstImage = (ad.images || []).find(Boolean) || "";
        const thumbHtml = firstImage
          ? `<img class="my-ad-thumb" src="${escapeHTML(firstImage)}" alt="${escapeHTML(ad.title || "Ad image")}" loading="lazy" />`
          : `<div class="my-ad-thumb my-ad-thumb--empty">No image</div>`;
        return `
      <article class="my-ad-card${goldClass}" data-ad-id="${escapeHTML(ad.id)}" data-detail-ad-id="${escapeHTML(ad.id)}" tabindex="0" role="button" aria-label="View details for ${escapeHTML(ad.title || "ad")}">
        <div class="my-ad-header">
          <span class="my-ad-title">${escapeHTML(ad.title)} ${goldBadgeHTML(ad)}</span>
          <span class="my-ad-price">${escapeHTML(formatPrice(ad.price))}</span>
        </div>
        ${thumbHtml}
        <p class="meta">
          ${escapeHTML(ad.category)} / ${escapeHTML(ad.subCategory)} in ${escapeHTML([ad.city, ad.state].filter(Boolean).join(", "))}
        </p>
        <p class="meta">Posted ${new Date(ad.createdAt).toLocaleString()}</p>
        <div class="my-ad-actions">
          ${boostBtn}
          ${repostBtn}
          <button type="button" class="my-ad-delete" data-ad-id="${escapeHTML(ad.id)}">Delete</button>
        </div>
      </article>
    `;
      })
      .join("");
  } catch (error) {
    myAdsList.innerHTML = "";
    if (myAdsHint) {
      myAdsHint.textContent = `Could not load your ads: ${error.message || "unknown error"}`;
    }
  }
}

if (myAdsList) {
  myAdsList.addEventListener("click", async (event) => {
    // Repost stub — surface a toast so mobile users (no hover tooltips) still
    // understand why nothing happens. Wired before the delete handler so the
    // event doesn't fall through to the card-click detail modal.
    const repostBtn = event.target.closest(".my-ad-repost");
    if (repostBtn) {
      event.stopPropagation();
      showToast("Reposting unlocks with the $3/mo Pro Re-list subscription (coming soon).");
      return;
    }

    const btn = event.target.closest(".my-ad-delete");
    if (!btn) return;
    const adId = btn.dataset.adId;
    if (!adId) return;
    event.stopPropagation();
    openDeleteAdModal(adId).catch(() => {
      showToast("Could not open delete dialog.");
    });
  });
}

if (refreshMyAdsBtn) {
  refreshMyAdsBtn.addEventListener("click", () => {
    renderMyAds().catch(() => { /* error surfaced via hint */ });
  });
}

if (homeCategoryFilter) {
  homeCategoryFilter.addEventListener("change", () => {
    // Persist so the user's preference survives a reload, then re-render. We re-fetch from
    // the server inside renderAds() but that's cheap and ensures freshly-posted ads can
    // appear when a less restrictive filter is picked.
    localStorage.setItem(HOME_CATEGORY_FILTER_KEY, homeCategoryFilter.value || "");
    // Rebuild the sub-category list whenever the parent category changes. Done
    // inside the change handler (rather than in the modal's open hook) so the
    // sub-category options always match the currently-selected category.
    populateHomeSubCategoryFilter();
    renderAds().catch(() => { /* surfaced via adsList content */ });
  });
}

// --- Filter modal (opened from the topbar filter button) ---------------------
const homeSubCategoryFilter = document.getElementById("homeSubCategoryFilter");
const HOME_SUB_CATEGORY_FILTER_KEY = "classified_home_sub_category_filter";
const filterModal = document.getElementById("filterModal");
const topbarBrandBtn = document.getElementById("topbarBrandBtn");
const topbarFilterBtn = document.getElementById("topbarFilterBtn");
const topbarFilterDot = document.getElementById("topbarFilterDot");
const filterApplyBtn = document.getElementById("filterApplyBtn");
const filterClearBtn = document.getElementById("filterClearBtn");
const filterCloseBtn = document.getElementById("filterCloseBtn");
const adsActiveFilterEl = document.getElementById("adsActiveFilter");

function populateHomeSubCategoryFilter() {
  // Sub-category options cascade from the parent category. We keep the saved
  // sub-category in localStorage so it survives a reload, but if the parent
  // category changes (or is cleared to "All categories"), we drop the saved
  // sub-category since it would no longer match any option.
  if (!homeSubCategoryFilter) return;
  const parentCat = homeCategoryFilter ? homeCategoryFilter.value : "";
  if (!parentCat) {
    homeSubCategoryFilter.innerHTML = '<option value="">Pick a category first</option>';
    homeSubCategoryFilter.value = "";
    homeSubCategoryFilter.disabled = true;
    localStorage.removeItem(HOME_SUB_CATEGORY_FILTER_KEY);
    return;
  }
  const opts = AD_SUB_CATEGORIES[parentCat] || [];
  const saved = localStorage.getItem(HOME_SUB_CATEGORY_FILTER_KEY) || "";
  homeSubCategoryFilter.innerHTML =
    '<option value="">All sub-categories</option>' +
    opts.map((s) => `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join("");
  homeSubCategoryFilter.disabled = false;
  if (saved && opts.includes(saved)) {
    homeSubCategoryFilter.value = saved;
  } else {
    homeSubCategoryFilter.value = "";
    if (saved) localStorage.removeItem(HOME_SUB_CATEGORY_FILTER_KEY);
  }
}
populateHomeSubCategoryFilter();

function updateFilterBadge() {
  // Show the red dot on the topbar filter button whenever any filter is active,
  // so users have a visual reminder that the list they're seeing is narrowed
  // down (and they're not just looking at an empty state).
  const anyActive = Boolean(
    (homeCategoryFilter && homeCategoryFilter.value) ||
      (homeSubCategoryFilter && homeSubCategoryFilter.value)
  );
  if (topbarFilterDot) topbarFilterDot.hidden = !anyActive;
}
updateFilterBadge();

function openFilterModal() {
  if (!filterModal) return;
  // Re-sync the sub-category options against the currently-saved category in
  // case the AD_SUB_CATEGORIES table was changed since the user last opened it.
  populateHomeSubCategoryFilter();
  filterModal.hidden = false;
}

function closeFilterModal() {
  if (!filterModal) return;
  filterModal.hidden = true;
}

if (topbarFilterBtn) {
  topbarFilterBtn.addEventListener("click", () => openFilterModal());
}

// Clicking "T1Classifieds" is the home affordance: leave profile mode and show
// the browse grid for the user's state (same listings as Exit Profile).
// Active category filters are kept; only profile UI is dismissed.
if (topbarBrandBtn) {
  const goToBrowseFromBrand = async () => {
    closeAdDetail();
    closeFilterModal();
    closeMenu();
    if (isProfileActive()) {
      setProfileActive(false);
      updateAuthUI();
    }
    try {
      await renderAds();
    } catch {
      showToast("Could not load listings.");
      return;
    }
    adsBrowseSection?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  topbarBrandBtn.addEventListener("click", () => {
    goToBrowseFromBrand().catch(() => {});
  });
  topbarBrandBtn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      goToBrowseFromBrand().catch(() => {});
    }
  });
}

if (filterCloseBtn) filterCloseBtn.addEventListener("click", () => closeFilterModal());

if (filterApplyBtn) {
  filterApplyBtn.addEventListener("click", () => {
    if (homeSubCategoryFilter) {
      localStorage.setItem(
        HOME_SUB_CATEGORY_FILTER_KEY,
        homeSubCategoryFilter.value || ""
      );
    }
    if (homeCategoryFilter) {
      localStorage.setItem(HOME_CATEGORY_FILTER_KEY, homeCategoryFilter.value || "");
    }
    updateFilterBadge();
    closeFilterModal();
    renderAds().catch(() => {});
  });
}

if (filterClearBtn) {
  filterClearBtn.addEventListener("click", () => {
    if (homeCategoryFilter) homeCategoryFilter.value = "";
    if (homeSubCategoryFilter) {
      homeSubCategoryFilter.value = "";
      homeSubCategoryFilter.disabled = true;
      homeSubCategoryFilter.innerHTML = '<option value="">Pick a category first</option>';
    }
    localStorage.removeItem(HOME_CATEGORY_FILTER_KEY);
    localStorage.removeItem(HOME_SUB_CATEGORY_FILTER_KEY);
    updateFilterBadge();
    closeFilterModal();
    renderAds().catch(() => {});
  });
}

// Dismiss the modal by clicking the dimmed backdrop (anywhere outside .modal-card).
if (filterModal) {
  filterModal.addEventListener("click", (event) => {
    if (event.target === filterModal) closeFilterModal();
  });
}

// "Clear" link inside the active-filter summary row above the ad grid. Lives
// off document because the summary <p> is replaced on each render; binding on
// the element directly would lose the listener after the first re-render.
document.addEventListener("click", (event) => {
  const link = event.target.closest && event.target.closest("#adsClearFilterLink");
  if (!link) return;
  event.preventDefault();
  if (filterClearBtn) filterClearBtn.click();
});

function filesToDataUrls(fileList) {
  const files = Array.from(fileList);
  return Promise.all(
    files.map(
      (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("Failed to read image file."));
          reader.readAsDataURL(file);
        })
    )
  );
}

// Upload one image to /api/classifieds/uploads and return the public URL.
// Throws an Error with message "STORAGE_DISABLED" when the env has no bucket configured
// so the caller can fall back to inline data URLs (current dev-mode behavior).
async function uploadOneImage(file) {
  const fd = new FormData();
  fd.append("file", file);
  const headers = {};
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  const r = await fetch("/api/classifieds/uploads", {
    method: "POST",
    headers,
    body: fd,
    credentials: "same-origin",
  });
  if (r.status === 503) {
    throw new Error("STORAGE_DISABLED");
  }
  let payload = {};
  try { payload = await r.json(); } catch {}
  if (!r.ok) {
    throw new Error(detailMessage(payload, `Upload failed (HTTP ${r.status}).`));
  }
  if (!payload || typeof payload.url !== "string") {
    throw new Error("Upload succeeded but response had no url.");
  }
  return payload.url;
}

// Prefer object-storage uploads (R2/S3) when the env is configured; otherwise fall back
// to inline base64 so local/dev without storage env vars keeps working unchanged.
async function imagesForAd(fileList) {
  const files = Array.from(fileList);
  try {
    const urls = [];
    for (const file of files) {
      urls.push(await uploadOneImage(file));
    }
    return urls;
  } catch (err) {
    if (err && err.message === "STORAGE_DISABLED") {
      return filesToDataUrls(files);
    }
    throw err;
  }
}

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(registerForm);
  const username = String(formData.get("username")).trim().toLowerCase();
  const state = String(formData.get("state")).trim();
  const password = String(formData.get("password"));
  const email = String(formData.get("email")).trim();
  const phone = String(formData.get("phone")).trim();
  // The HTML `required` attribute already gates the submit, but we also read
  // and send the checkbox value so the server can enforce it (and timestamp
  // when ToS was accepted) for users hitting the endpoint directly via curl.
  const tosAccepted = formData.get("tosAccepted") === "on";

  if (!state) {
    showToast("Please select your state.");
    return;
  }
  if (!tosAccepted) {
    showToast(
      "Please confirm the Terms of Service (including refund and arbitration sections), Privacy Policy, and photo ownership."
    );
    return;
  }

  try {
    const data = await classifiedsApi("/register", {
      method: "POST",
      withAuth: false,
      jsonBody: { username, state, password, email, phone, tosAccepted },
    });
    setSessionToken(data.token);
    cachedUser = data.user;
    // Save credentials to the browser's password manager BEFORE we reset the
    // form — once .reset() runs the inputs are empty and Chrome's heuristic
    // "did the form submit succeed?" detector can miss them.
    await rememberCredentials(username, password);
    registerForm.reset();
    setProfileActive(false);
    updateAuthUI();
    await renderAds();
    showToast("Account created. You are logged in.");
    reopenSharedAdIfAny();
  } catch (error) {
    showToast(error.message || "Registration failed.");
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const username = String(formData.get("username")).trim().toLowerCase();
  const password = String(formData.get("password"));

  try {
    const data = await classifiedsApi("/login", {
      method: "POST",
      withAuth: false,
      jsonBody: { username, password },
    });
    setSessionToken(data.token);
    cachedUser = data.user;
    setProfileActive(false);
    await rememberCredentials(username, password);
    loginForm.reset();
    updateAuthUI();
    await renderAds();
    showToast("Logged in successfully.");
    reopenSharedAdIfAny();
  } catch (error) {
    showToast(error.message || "Login failed.");
  }
});

async function rememberCredentials(username, password) {
  // Use the Credential Management API to explicitly ask the browser's password
  // manager to save the just-used credential. This is what triggers Chrome's
  // "Save password?" prompt on SPAs where the actual form submit is captured
  // by JS (the browser's own heuristic detector often misses fetch-based
  // submits, especially for registration). Feature-detected so unsupported
  // browsers (older Safari, Firefox without flag) gracefully no-op.
  //
  // Only works on a secure context (HTTPS or localhost). Failures here are
  // intentionally swallowed — the user is already logged in; missing a
  // "Save password?" prompt is a minor UX miss, not a flow-breaking error.
  if (!window.PasswordCredential || !username || !password) return;
  try {
    const cred = new window.PasswordCredential({
      id: username,
      password: password,
      name: username,
    });
    await navigator.credentials.store(cred);
  } catch {
    /* unsupported, denied by user, or not in a secure context — ignore */
  }
}

function reopenSharedAdIfAny() {
  // After a successful login/register, if the visitor originally arrived via
  // a shared ?ad=<id> link (or that param is still in the URL), re-open the
  // modal so the now-authed viewer gets the seller's contact info (which the
  // anonymous view intentionally suppresses).
  const params = new URLSearchParams(window.location.search);
  const sharedAdId = params.get("ad") || lastSharedAdId;
  if (sharedAdId) {
    openAdDetail(sharedAdId).catch(() => { /* error surfaced inside modal */ });
    lastSharedAdId = null;
  }
}

menuToggleBtn.addEventListener("click", () => {
  menuPanel.hidden = !menuPanel.hidden;
});

profileTabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    setActiveProfileTab(btn.dataset.tab);
    applyProfileTabUI();
  });
});

document.addEventListener("click", (event) => {
  if (!menuWrapper.contains(event.target)) {
    closeMenu();
  }
});

enterProfileBtn.addEventListener("click", async () => {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    showToast("Log in first.");
    return;
  }
  setProfileActive(true);
  closeMenu();
  updateAuthUI();
  await renderAds();
  showToast("Profile mode enabled.");
});

exitProfileBtn.addEventListener("click", async () => {
  setProfileActive(false);
  closeMenu();
  updateAuthUI();
  await renderAds();
  showToast("Exited profile mode.");
});

logoutBtn.addEventListener("click", async () => {
  try {
    await classifiedsApi("/logout", { method: "POST" });
  } catch {
    /* still clear client */
  }
  setSessionToken(null);
  cachedUser = null;
  setProfileActive(false);
  closeMenu();
  updateAuthUI();
  await renderAds();
  showToast("Logged out.");
});

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const currentUser = getCurrentUser();
  const newState = String(new FormData(profileForm).get("state")).trim();
  const email = String(new FormData(profileForm).get("email")).trim();
  const phone = String(new FormData(profileForm).get("phone")).trim();
  if (!currentUser || !newState) return;

  try {
    cachedUser = await classifiedsApi("/me", {
      method: "PATCH",
      jsonBody: { state: newState, email, phone },
    });
    adStateSelect.value = newState;
    updateAuthUI();
    await renderAds();
    showToast("Profile updated.");
  } catch (error) {
    showToast(error.message || "Could not update profile.");
  }
});

adForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const userRecord = getCurrentUserRecord();
  if (!userRecord) {
    showToast("Please log in first.");
    return;
  }
  if (!isProfileActive()) {
    showToast("Enter profile mode before posting.");
    return;
  }

  const formData = new FormData(adForm);
  const title = String(formData.get("title")).trim();
  const state = String(formData.get("state")).trim();
  const category = String(formData.get("category")).trim();
  const subCategory = String(formData.get("subCategory")).trim();
  // Run the same canonicalization the server does so the optimistic view and
  // the persisted record agree, and so a user typing "100$" immediately sees
  // "$100" on their freshly-posted tile.
  const price = formatPrice(formData.get("price"));
  const description = String(formData.get("description")).trim();
  // Required public-facing seller name (prod-v1.13). No fallback to the
  // login username — we reject the submission and prompt the user instead.
  const contactName = String(formData.get("contactName") || "").trim();
  // City: from the dropdown unless the user selected "Other…", in which
  // case the free-text input has the value. Both paths normalize to a
  // single trimmed string the API will accept.
  let city = String(formData.get("city") || "").trim();
  if (city === AD_CITY_OTHER_SENTINEL) {
    city = String(formData.get("cityOther") || "").trim();
  }
  const files = adImagesInput.files ? Array.from(adImagesInput.files) : [];

  if (!state || !category || !subCategory) {
    showToast("State, category, and sub category are required.");
    return;
  }
  if (!city) {
    showToast("City is required.");
    return;
  }
  if (!contactName) {
    showToast("Display name is required.");
    return;
  }
  if (files.length < 1 || files.length > 10) {
    showToast("Please upload between 1 and 10 pictures.");
    return;
  }

  try {
    const images = await imagesForAd(files);
    await classifiedsApi("/ads", {
      method: "POST",
      jsonBody: {
        title,
        state,
        city,
        category,
        subCategory,
        price,
        description,
        images,
        contactName,
      },
    });
    adForm.reset();
    adStateSelect.value = getCurrentUserRecord()?.state || "";
    // adForm.reset() clears the city dropdown but leaves it disabled with
    // the placeholder; re-fire the cascade so it repopulates against the
    // restored state value (or stays "Select a state first" if the user has
    // no saved state on their profile).
    adStateSelect.dispatchEvent(new Event("change"));
    await renderAds();
    // Keep the My Ads tab in sync even when the user posts from the Post Ad tab.
    await renderMyAds().catch(() => {});
    showToast("Ad posted.");
  } catch (error) {
    showToast(error.message || "Could not post ad.");
  }
});

// --- Gold-frame paywall (Stripe Checkout). See stripe_service.py + classifieds_routes.py.
// goldConfig is fetched once at init; if Stripe isn't configured the Boost button is hidden
// everywhere (no half-broken state). Surge prices are quoted live per ad, so the modal
// always shows what Stripe will actually charge.

let goldConfig = null; // { enabled, publishableKey, tiers: [...] } | null when not loaded

async function loadGoldConfig() {
  try {
    const r = await fetch("/api/classifieds/gold/config", { credentials: "same-origin" });
    if (!r.ok) return;
    goldConfig = await r.json();
  } catch {
    goldConfig = null;
  }
}

function isGoldActive(ad) {
  return typeof ad?.goldUntil === "number" && ad.goldUntil > Date.now();
}

function goldBadgeHTML(ad) {
  if (!isGoldActive(ad)) return "";
  const until = new Date(ad.goldUntil);
  return `<span class="gold-badge" title="Gold until ${until.toLocaleString()}">★ Gold</span>`;
}

function formatUSD(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

const GOLD_REFUND_BLOCK_MESSAGES = {
  below_minimum_refund: "The prorated refund would be under $1.00, so no card refund is issued.",
  gold_purchase_too_recent:
    "Gold was activated recently. Wait at least 15 minutes after boosting before a refund-eligible delete.",
  refund_rate_limit: "Too many Gold refunds on your account in the last 24 hours.",
  already_refunded: "This Gold purchase was already refunded.",
  no_payment_snapshot: "No refundable Gold payment is on file for this ad.",
  gold_expired: "Gold has already expired on this ad.",
};

function goldRefundBlockedMessage(code) {
  if (!code) return "No Gold refund applies to this deletion.";
  return GOLD_REFUND_BLOCK_MESSAGES[code] || `No refund: ${code}`;
}

function renderDeleteRefundBreakdown(preview) {
  if (!deleteAdRefundBreakdown) return;
  const bd = preview?.breakdown;
  if (!bd) {
    deleteAdRefundBreakdown.hidden = true;
    deleteAdRefundBreakdown.innerHTML = "";
    return;
  }
  if (!preview.eligible) {
    deleteAdRefundBreakdown.hidden = false;
    deleteAdRefundBreakdown.innerHTML = `<p class="delete-refund-blocked">${escapeHTML(
      goldRefundBlockedMessage(preview.blockedReason)
    )}</p>`;
    return;
  }
  const basisLabel =
    bd.prorationBasis === "days_remaining"
      ? `Prorated by ${bd.daysRemaining} of ${bd.totalDays} days remaining`
      : `Prorated excluding ${bd.daysUsed} of ${bd.totalDays} days used`;
  deleteAdRefundBreakdown.hidden = false;
  deleteAdRefundBreakdown.innerHTML = `
    <p class="hint" style="margin:0.5rem 0 0;">Gold refund estimate (card):</p>
    <table class="delete-refund-table" aria-label="Gold refund breakdown">
      <tbody>
        <tr><td>Gold payment</td><td>${formatUSD(bd.grossPaidCents)}</td></tr>
        <tr><td>Stripe processing fee (${escapeHTML(bd.stripeFeeLabel)})</td><td>−${formatUSD(bd.stripeFeeCents)}</td></tr>
        <tr><td>Refundable pool</td><td>${formatUSD(bd.netAfterFeeCents)}</td></tr>
        <tr><td>${escapeHTML(basisLabel)}</td><td></td></tr>
        <tr class="delete-refund-total"><td>Estimated refund</td><td>${formatUSD(preview.refundCents)}</td></tr>
      </tbody>
    </table>
    <p class="hint" style="margin:0.35rem 0 0;font-size:0.82rem;">Minimum refund is ${formatUSD(bd.minimumRefundCents)}. Final amount posts via Stripe in a few business days.</p>
  `;
}

function closeDeleteAdModal() {
  pendingDeleteAdId = null;
  if (deleteAdModal) deleteAdModal.hidden = true;
  if (deleteAdRefundBreakdown) {
    deleteAdRefundBreakdown.hidden = true;
    deleteAdRefundBreakdown.innerHTML = "";
  }
  if (deleteAdConfirmBtn) {
    deleteAdConfirmBtn.disabled = false;
    deleteAdConfirmBtn.textContent = "Delete permanently";
  }
}

async function openDeleteAdModal(adId) {
  pendingDeleteAdId = adId;
  const ad = lastRenderedMyAdsList.find((a) => a.id === adId);
  const goldActive = ad && isGoldActive(ad);
  renderDeleteRefundBreakdown(null);
  if (deleteAdModal) deleteAdModal.hidden = false;
  if (goldActive && goldConfig?.enabled) {
    try {
      const preview = await classifiedsApi(
        `/ads/${encodeURIComponent(adId)}/gold-refund-preview`
      );
      renderDeleteRefundBreakdown(preview);
    } catch (err) {
      if (deleteAdRefundBreakdown) {
        deleteAdRefundBreakdown.hidden = false;
        deleteAdRefundBreakdown.innerHTML = `<p class="delete-refund-blocked">${escapeHTML(
          err.message || "Could not load refund estimate."
        )}</p>`;
      }
    }
  } else if (deleteAdRefundBreakdown) {
    deleteAdRefundBreakdown.hidden = true;
  }
}

async function confirmDeleteAd() {
  const adId = pendingDeleteAdId;
  if (!adId || !deleteAdConfirmBtn) return;
  deleteAdConfirmBtn.disabled = true;
  deleteAdConfirmBtn.textContent = "Deleting…";
  try {
    const result = await classifiedsApi(`/ads/${encodeURIComponent(adId)}`, {
      method: "DELETE",
    });
    closeDeleteAdModal();
    await renderMyAds();
    await renderAds();
    const refundCents = result?.goldRefundCents;
    if (typeof refundCents === "number" && refundCents > 0) {
      showToast(
        `Ad deleted. ${formatUSD(refundCents)} refund for unused Gold time is processing on your card.`
      );
    } else {
      showToast("Ad deleted.");
    }
  } catch (error) {
    deleteAdConfirmBtn.disabled = false;
    deleteAdConfirmBtn.textContent = "Delete permanently";
    showToast(error.message || "Could not delete ad.");
  }
}

if (deleteAdCancelBtn) {
  deleteAdCancelBtn.addEventListener("click", closeDeleteAdModal);
}
if (deleteAdConfirmBtn) {
  deleteAdConfirmBtn.addEventListener("click", () => {
    confirmDeleteAd().catch(() => {});
  });
}
if (deleteAdModal) {
  deleteAdModal.addEventListener("click", (e) => {
    if (e.target === deleteAdModal) closeDeleteAdModal();
  });
}

// Builds (and caches) the boost modal DOM. Returns the root <div>.
let _boostModal = null;
function ensureBoostModal() {
  if (_boostModal) return _boostModal;
  const root = document.createElement("div");
  root.className = "boost-modal-backdrop";
  root.hidden = true;
  root.innerHTML = `
    <div class="boost-modal" role="dialog" aria-modal="true" aria-labelledby="boostModalTitle">
      <button type="button" class="boost-modal-close" aria-label="Close">&times;</button>
      <h3 id="boostModalTitle">Boost this ad to Gold</h3>
      <p class="hint" id="boostModalBucketHint"></p>
      <div class="boost-tier-list" id="boostTierList"></div>
      <p class="hint">You'll be redirected to Stripe to complete payment. The ad becomes gold
      automatically once payment confirms.</p>
    </div>
  `;
  document.body.appendChild(root);
  root.addEventListener("click", (event) => {
    if (event.target === root || event.target.classList.contains("boost-modal-close")) {
      closeBoostModal();
    }
  });
  _boostModal = root;
  return root;
}

function closeBoostModal() {
  if (_boostModal) _boostModal.hidden = true;
}

async function openBoostModal(adId) {
  if (!goldConfig?.enabled) {
    showToast("Payments are not configured on this environment.");
    return;
  }
  const root = ensureBoostModal();
  const list = root.querySelector("#boostTierList");
  const bucketHint = root.querySelector("#boostModalBucketHint");
  list.innerHTML = '<p class="hint">Loading current prices…</p>';
  bucketHint.textContent = "";
  root.hidden = false;
  let quote;
  try {
    quote = await classifiedsApi(`/gold/quote/${encodeURIComponent(adId)}`);
  } catch (err) {
    list.innerHTML = `<p class="hint">Could not load prices: ${escapeHTML(err.message || "unknown error")}</p>`;
    return;
  }
  const active = quote.tiers[0]?.activeInBucket ?? 0;
  const mult = quote.tiers[0]?.multiplier ?? 1;
  bucketHint.textContent =
    `Pricing for ${quote.category} in ${quote.state}. ` +
    (active === 0
      ? "No other gold ads here — base price."
      : `${active} other gold ad${active === 1 ? "" : "s"} active here — surge ×${mult}.`);
  list.innerHTML = quote.tiers
    .map((t) => {
      const surge = t.multiplier > 1 ? ` <span class="hint">(×${t.multiplier} surge)</span>` : "";
      return `
        <button type="button" class="boost-tier-btn" data-tier-id="${escapeHTML(t.tierId)}" data-ad-id="${escapeHTML(adId)}">
          <span class="boost-tier-label">${escapeHTML(t.label)}</span>
          <span class="boost-tier-price">${formatUSD(t.priceUsdCents)}${surge}</span>
        </button>
      `;
    })
    .join("");
}

async function startBoostCheckout(adId, tierId, btn) {
  if (!adId || !tierId) return;
  btn.disabled = true;
  btn.classList.add("is-loading");
  try {
    const payload = await classifiedsApi("/gold/checkout", {
      method: "POST",
      jsonBody: { adId, tierId },
    });
    if (!payload?.url) throw new Error("Checkout did not return a URL.");
    window.location.href = payload.url;
  } catch (err) {
    btn.disabled = false;
    btn.classList.remove("is-loading");
    showToast(err.message || "Could not start checkout.");
  }
}

// Click delegation for "Boost to Gold" buttons on My Ads cards and the modal tier picker.
document.addEventListener("click", (event) => {
  const boostBtn = event.target.closest("[data-boost-ad-id]");
  if (boostBtn) {
    const adId = boostBtn.dataset.boostAdId;
    if (adId) openBoostModal(adId);
    return;
  }
  const tierBtn = event.target.closest(".boost-tier-btn");
  if (tierBtn) {
    startBoostCheckout(tierBtn.dataset.adId, tierBtn.dataset.tierId, tierBtn);
  }
});

// On return from Stripe Checkout, the URL carries ?gold=success or ?gold=cancel. We toast,
// then clean the URL so a reload doesn't keep re-toasting. The webhook (not this handler)
// is what actually flips the ad to gold; the success toast is just UX.
function handleGoldReturnParams() {
  const params = new URLSearchParams(window.location.search);
  const gold = params.get("gold");
  if (!gold) return;
  if (gold === "success") {
    showToast("Payment received. Your ad will appear as gold within a few seconds.");
  } else if (gold === "cancel") {
    showToast("Checkout canceled. Your ad was not boosted and your card was not charged.");
  }
  params.delete("gold");
  params.delete("ad_id");
  const clean = window.location.pathname + (params.toString() ? `?${params}` : "");
  window.history.replaceState({}, "", clean);
}

// === Ad detail modal ===
// The browse list renders compact image-first tiles; the full ad (description, all
// images, seller contact info) lives behind this modal so the grid stays scannable.
// Markup is pre-rendered in index.html (#adDetailModal) — we just populate fields
// from a single GET /ads/{id} fetch on each open.
const adDetailModal = document.getElementById("adDetailModal");
const detailModalCard = document.getElementById("detailModalCard");
const detailHeroImage = document.getElementById("detailHeroImage");
const detailThumbnails = document.getElementById("detailThumbnails");
const detailTitleEl = document.getElementById("detailTitle");
const detailPriceEl = document.getElementById("detailPrice");
const detailMetaEl = document.getElementById("detailPhone"); // legacy id, repurposed for meta
const detailContactEl = document.getElementById("detailContact");
const detailDescriptionEl = document.getElementById("detailDescription");
const closeAdDetailBtn = document.getElementById("closeAdDetailBtn");
const shareAdBtn = document.getElementById("shareAdBtn");
const detailAnonCta = document.getElementById("detailAnonCta");
const detailAnonCtaBtn = document.getElementById("detailAnonCtaBtn");
const detailModalActions = document.getElementById("detailModalActions");
const detailReportBtn = document.getElementById("detailReportBtn");
const detailKslBlock = document.getElementById("detailKslBlock");
const detailKslLink = document.getElementById("detailKslLink");

// Tracks which ad the modal is currently rendering, so the Share button and
// the post-login modal-refresh hook know which ID to act on.
let currentDetailAdId = null;
// Snapshot of the most recently fetched ad so the Share button can pull
// title/description without round-tripping the network again.
let currentDetailAd = null;
// Sticky reference to the ad ID an anonymous visitor arrived on (via ?ad=…).
// Survives closeAdDetail's URL cleanup so the post-login refresh hook can
// still reopen the ad after the visitor signs up from the in-modal CTA.
let lastSharedAdId = null;

// --- Swipe navigation through the detail modal -------------------------
// When the user opens an ad from the browse grid or My Ads view, we cache
// the list it came from and the current ad's index in that list so a
// horizontal swipe (or arrow key) can advance to the next/previous ad
// without forcing the user to close the modal, scroll, and tap again.
// Deep-link opens (?ad=<id>) leave this empty so swipe is a no-op there
// — we don't have a meaningful "next ad" without a list context.
let currentDetailNavList = [];
let currentDetailNavIndex = -1;
// Last list rendered into the browse grid / My Ads grid, so click
// handlers (which fire after rendering) can pass the right list to
// openAdDetail without rebuilding it from scratch.
let lastRenderedBrowseList = [];
let lastRenderedMyAdsList = [];

function shareUrlForAd(adId) {
  // Build the deep-link from the user's current origin + path so it works
  // for both rorhoff.com/classifieds (dev) and t1classifieds.com (prod)
  // without hardcoding either domain.
  const { origin, pathname } = window.location;
  return `${origin}${pathname}?ad=${encodeURIComponent(adId)}`;
}

async function shareCurrentAd() {
  if (!currentDetailAdId) return;
  const url = shareUrlForAd(currentDetailAdId);
  const title = currentDetailAd?.title || "Classifieds listing";
  // Keep the share message generic — the ad title is already visible in
  // the link preview (Open Graph + per-ad <title> set in applySeoForAd),
  // so appending it here just creates noise on platforms like iMessage
  // that show both the text and the preview card.
  const text = "Check out this listing!";

  // Prefer the native share sheet on supported devices (mobile + some
  // desktops). Web Share rejects with AbortError if the user dismisses
  // the sheet — that's fine, we just stay quiet.
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;
      // Fall through to clipboard fallback for any other Web Share error.
    }
  }

  // Clipboard fallback. Requires HTTPS or localhost; most users are on
  // HTTPS in production so this is the common path on desktop.
  try {
    await navigator.clipboard.writeText(url);
    showToast("Link copied to clipboard.");
    return;
  } catch {
    // Last-ditch fallback: prompt() lets the user select+copy manually.
    try {
      window.prompt("Copy this link:", url);
    } catch {
      showToast("Could not share link.");
    }
  }
}

if (shareAdBtn) {
  shareAdBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    shareCurrentAd();
  });
}

if (detailAnonCtaBtn) {
  detailAnonCtaBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    closeAdDetail();
    // Scroll the login form into view so the path forward is obvious. Falls
    // back to a no-op on browsers that don't support scrollIntoView options.
    const authSection = document.getElementById("authSection");
    if (authSection) {
      try {
        authSection.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {
        authSection.scrollIntoView();
      }
    }
  });
}

if (detailReportBtn) {
  detailReportBtn.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!currentDetailAdId) return;
    if (!getCurrentUserRecord()) {
      showToast("Log in to report a listing.");
      return;
    }
    const ok = window.confirm(
      "Report this listing as spam, a scam, or otherwise inappropriate?\n\n" +
        "Repeated reports from different users will automatically remove the ad."
    );
    if (!ok) return;
    detailReportBtn.disabled = true;
    detailReportBtn.textContent = "Reporting…";
    try {
      const result = await classifiedsApi(
        `/ads/${encodeURIComponent(currentDetailAdId)}/report`,
        { method: "POST" }
      );
      if (result?.removed) {
        showToast("Listing removed. Thanks for flagging it.");
        closeAdDetail();
        // Refresh the public browse list so the removed ad disappears
        // immediately for this user without a manual reload.
        renderAds().catch(() => {});
      } else if (result?.alreadyReported) {
        showToast("You already reported this listing — thanks.");
        detailReportBtn.textContent = "Reported";
      } else {
        showToast("Report submitted. Thanks for helping keep listings safe.");
        detailReportBtn.textContent = "Reported";
      }
    } catch (err) {
      detailReportBtn.disabled = false;
      detailReportBtn.textContent = "Report this listing";
      showToast(err?.message || "Could not submit report.");
    }
  });
}

function closeAdDetail() {
  if (!adDetailModal) return;
  adDetailModal.hidden = true;
  // Drop the hero src so the next open doesn't briefly show the previous ad's image.
  if (detailHeroImage) {
    detailHeroImage.removeAttribute("src");
    detailHeroImage.alt = "";
  }
  if (detailThumbnails) detailThumbnails.innerHTML = "";
  if (detailContactEl) {
    detailContactEl.hidden = true;
    detailContactEl.innerHTML = "";
  }
  if (detailAnonCta) detailAnonCta.hidden = true;
  if (detailKslBlock) detailKslBlock.hidden = true;
  if (detailKslLink) detailKslLink.removeAttribute("href");
  detailModalCard?.classList.remove("gold-frame-active");
  currentDetailAdId = null;
  currentDetailAd = null;
  currentDetailNavList = [];
  currentDetailNavIndex = -1;
  // Reset the page title + meta description back to the homepage defaults
  // so the address bar / share previews don't keep showing the previous ad
  // after the modal closes.
  if (typeof resetSeoToDefaults === "function") resetSeoToDefaults();
  // Clean ?ad= out of the URL so a refresh doesn't immediately reopen the modal.
  const params = new URLSearchParams(window.location.search);
  if (params.has("ad")) {
    params.delete("ad");
    const clean = window.location.pathname + (params.toString() ? `?${params}` : "");
    window.history.replaceState({}, "", clean);
  }
}

function renderDetailContact(ad) {
  // Contact block intentionally surfaces only username + phone. Email was
  // dropped in prod-v1.8 to keep seller PII to a minimum (also, every seller
  // already provides a required phone number at registration, so this never
  // leaves the buyer without a way to reach them).
  if (!detailContactEl) return;
  const phone = (ad.authorPhone || "").trim();
  // Build a tel: link by stripping non-digits but preserving a leading + for intl numbers.
  const telHref = phone ? phone.replace(/(?!^\+)[^\d]/g, "") : "";
  const rows = [];
  rows.push(
    `<div class="contact-row"><span class="contact-label">Seller</span><span>${escapeHTML(ad.author || "(unknown)")}</span></div>`
  );
  if (phone) {
    rows.push(
      `<div class="contact-row"><span class="contact-label">Phone</span><a class="contact-link" href="tel:${escapeHTML(telHref)}">${escapeHTML(phone)}</a></div>`
    );
  } else {
    rows.push(`<p class="contact-empty">Seller has not shared a phone number.</p>`);
  }
  detailContactEl.innerHTML = rows.join("");
  detailContactEl.hidden = false;
}

async function openAdDetail(adId, navList = null) {
  if (!adDetailModal || !adId) return;
  currentDetailAdId = adId;
  currentDetailAd = null;
  // If the caller provided a list context (browse grid, My Ads), remember
  // it + the current position so swipe / arrow-key handlers can advance
  // to the neighbour. Deep links / share opens pass nothing and end up
  // with a no-op swipe — fine, there's no meaningful "next" without a
  // list of peers to navigate through.
  if (Array.isArray(navList) && navList.length) {
    currentDetailNavList = navList;
    currentDetailNavIndex = navList.findIndex(
      (a) => String(a && a.id) === String(adId),
    );
  } else {
    currentDetailNavList = [];
    currentDetailNavIndex = -1;
  }
  adDetailModal.hidden = false;
  // Reflect the open ad in the URL so the address-bar copy and the Share
  // button produce the same link, and so reloading the page reopens the
  // same ad.
  const params = new URLSearchParams(window.location.search);
  if (params.get("ad") !== adId) {
    params.set("ad", adId);
    const next = window.location.pathname + `?${params}`;
    window.history.replaceState({}, "", next);
  }
  // Reset to a loading state — instant feedback, content fills in once fetch resolves.
  if (detailTitleEl) detailTitleEl.textContent = "Loading…";
  if (detailPriceEl) detailPriceEl.textContent = "";
  if (detailMetaEl) detailMetaEl.textContent = "";
  if (detailDescriptionEl) detailDescriptionEl.textContent = "";
  if (detailHeroImage) {
    detailHeroImage.removeAttribute("src");
    detailHeroImage.alt = "";
  }
  if (detailThumbnails) detailThumbnails.innerHTML = "";
  if (detailContactEl) {
    detailContactEl.hidden = true;
    detailContactEl.innerHTML = "";
  }
  if (detailAnonCta) detailAnonCta.hidden = true;
  if (detailKslBlock) detailKslBlock.hidden = true;
  detailModalCard?.classList.remove("gold-frame-active");
  // Scroll the modal back to top in case the previous detail left it scrolled.
  if (detailModalCard) detailModalCard.scrollTop = 0;

  let ad;
  try {
    ad = await classifiedsApi(`/ads/${encodeURIComponent(adId)}`);
  } catch (err) {
    if (detailTitleEl) detailTitleEl.textContent = "Could not load ad";
    if (detailDescriptionEl) {
      detailDescriptionEl.textContent = err?.message || "Network or server error.";
    }
    return;
  }

  currentDetailAd = ad;
  const imported = isImportedAd(ad);
  if (detailTitleEl) detailTitleEl.textContent = ad.title || "";
  if (detailPriceEl) detailPriceEl.textContent = formatPrice(ad.price);
  if (detailDescriptionEl) {
    detailDescriptionEl.textContent = imported
      ? descriptionForImportedAd(ad)
      : ad.description || "";
  }

  if (detailKslBlock && detailKslLink) {
    if (imported && ad.sourceUrl) {
      detailKslBlock.hidden = false;
      detailKslLink.href = ad.sourceUrl;
      detailKslLink.textContent = importViewOnLabel(ad);
      const note = detailKslBlock.querySelector(".detail-import-note");
      if (note) {
        note.textContent = `Preview from ${importSourceShortLabel(ad)}. Full details and seller contact are on the original site.`;
      }
    } else {
      detailKslBlock.hidden = true;
      detailKslLink.removeAttribute("href");
    }
  }

  if (detailMetaEl) {
    const metaBits = [];
    const taxonomy = [ad.category, ad.subCategory].filter(Boolean).join(" / ");
    // Show "City, State" when both are present (new ads), or just the
    // state for legacy ads that pre-date the city field.
    const locParts = [];
    if (ad.city) locParts.push(ad.city);
    if (ad.state) locParts.push(ad.state);
    const where = locParts.length ? `in ${locParts.join(", ")}` : "";
    if (taxonomy || where) metaBits.push(`${taxonomy}${where ? " " + where : ""}`.trim());
    if (ad.createdAt && !imported) metaBits.push(`Posted ${new Date(ad.createdAt).toLocaleString()}`);
    detailMetaEl.innerHTML = metaBits
      .map((bit) => `<span class="detail-meta-row">${escapeHTML(bit)}</span>`)
      .join("");
  }

  // Anonymous viewers (shared link, no session): hide the contact block
  // (server already strips PII for them) and show the sign-up CTA instead.
  // viewerAuthenticated comes from the backend so client-side session state
  // can't trick the UI into showing contact info that the server didn't send.
  const viewerAuthed = ad.viewerAuthenticated !== false && Boolean(getCurrentUserRecord());
  const isOwnAd = viewerAuthed && getCurrentUserRecord()?.username === ad.author;
  if (imported) {
    if (detailContactEl) {
      detailContactEl.hidden = true;
      detailContactEl.innerHTML = "";
    }
    if (detailAnonCta) detailAnonCta.hidden = true;
  } else if (viewerAuthed) {
    renderDetailContact(ad);
    if (detailAnonCta) detailAnonCta.hidden = true;
  } else {
    if (detailContactEl) {
      detailContactEl.hidden = true;
      detailContactEl.innerHTML = "";
    }
    if (detailAnonCta) detailAnonCta.hidden = false;
  }

  // Report button is only useful for logged-in viewers who don't own the ad.
  // (Hiding it for the seller prevents the "report your own ad" 400 path; the
  // server still rejects it as defense in depth.) Anonymous viewers see the
  // sign-up CTA instead — the report system requires accounts so we have a
  // reasonable abuse signal.
  if (detailModalActions) {
    detailModalActions.hidden = imported || !(viewerAuthed && !isOwnAd);
  }
  if (detailReportBtn) {
    detailReportBtn.disabled = false;
    detailReportBtn.textContent = "Report this listing";
  }

  const images = (ad.images || []).filter(Boolean);
  if (detailHeroImage) {
    if (images.length) {
      detailHeroImage.src = images[0];
      detailHeroImage.alt = ad.title || "";
      detailHeroImage.hidden = false;
    } else {
      detailHeroImage.hidden = true;
      detailHeroImage.removeAttribute("src");
    }
  }
  if (detailThumbnails) {
    if (images.length > 1) {
      detailThumbnails.innerHTML = images
        .map(
          (img, i) =>
            `<img class="detail-thumb${i === 0 ? " is-active" : ""}" data-thumb-src="${escapeHTML(img)}" src="${escapeHTML(img)}" alt="Image ${i + 1}" loading="lazy" />`
        )
        .join("");
    } else {
      detailThumbnails.innerHTML = "";
    }
  }

  // Gold ads keep their visual treatment (gold border + price badge) via
  // .gold-frame-active and goldBadgeHTML; the explicit "Gold listing —
  // featured until …" banner was removed for prod-v1.8 because it duplicated
  // information the buyer doesn't really care about and ate vertical space
  // above the hero image.
  if (isGoldActive(ad) && !imported) {
    detailModalCard?.classList.add("gold-frame-active");
  }

  applySeoForAd(ad);
}

// Per-ad SEO metadata. Googlebot executes JS during indexing, so when an ad
// is opened via /classifieds?ad=<id> we overwrite document.title and the
// <meta name="description"> with the ad's title + state + price + first line
// of description. Same goes for the OG tags so iMessage / Slack / Facebook
// render a useful card when the link is shared. Reset to the homepage
// defaults whenever the modal closes (see resetSeoToDefaults).
const SEO_DEFAULTS = {
  title: "t1Classifieds — Buy & sell locally by state and category",
  description:
    "t1Classifieds is a local classifieds board — buy and sell items by US state and category. Browse listings, contact sellers directly, and post your own ads.",
  url: `${window.location.origin}${window.location.pathname.replace(/\?.*$/, "")}`,
};

function setMetaContent(selector, value) {
  const el = document.querySelector(selector);
  if (el) el.setAttribute("content", value);
}

function applySeoForAd(ad) {
  if (!ad) return;
  // Location string used in both the SERP title and the meta description.
  // Prefer "City, State" when we have both — that's the form Google
  // associates with local-intent searches like "honda civic salt lake city".
  // Fall back to state-only for legacy ads that pre-date the city field.
  const locParts = [];
  if (ad.city) locParts.push(ad.city);
  if (ad.state) locParts.push(ad.state);
  const location = locParts.join(", ");
  const where = location ? ` in ${location}` : "";
  const price = ad.price ? ` — ${ad.price}` : "";
  // Keep titles under ~60 characters where possible so SERP doesn't truncate.
  const title = `${ad.title}${where}${price} | t1Classifieds`;
  // Single-line description: take first 160 chars of the ad description,
  // strip extra whitespace, prepend the location + category so the snippet
  // reads as a useful summary even without the ad body.
  const taxonomy = [ad.category, ad.subCategory].filter(Boolean).join(" / ");
  const bodyLine = (ad.description || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  const desc = `${taxonomy ? taxonomy + " " : ""}${location ? "in " + location : ""}. ${bodyLine}`.slice(
    0,
    300
  );
  const url = shareUrlForAd(ad.id);
  const ogImage = (ad.images || []).find(Boolean) || "";

  document.title = title;
  setMetaContent('meta[name="description"]', desc);
  setMetaContent('meta[property="og:title"]', title);
  setMetaContent('meta[property="og:description"]', desc);
  setMetaContent('meta[property="og:url"]', url);
  setMetaContent('meta[name="twitter:title"]', title);
  setMetaContent('meta[name="twitter:description"]', desc);
  if (ogImage) {
    setMetaContent('meta[property="og:image"]', ogImage);
    setMetaContent('meta[name="twitter:image"]', ogImage);
  }
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.setAttribute("href", url);
}

function resetSeoToDefaults() {
  document.title = SEO_DEFAULTS.title;
  setMetaContent('meta[name="description"]', SEO_DEFAULTS.description);
  setMetaContent('meta[property="og:title"]', SEO_DEFAULTS.title);
  setMetaContent('meta[property="og:description"]', SEO_DEFAULTS.description);
  setMetaContent('meta[property="og:url"]', SEO_DEFAULTS.url);
  setMetaContent('meta[name="twitter:title"]', SEO_DEFAULTS.title);
  setMetaContent('meta[name="twitter:description"]', SEO_DEFAULTS.description);
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.setAttribute("href", SEO_DEFAULTS.url);
}

// Click delegation for: tile → open detail modal; thumbnail → swap hero image;
// close button or backdrop → dismiss. Kept separate from the boost handler to
// avoid intermixing concerns.
document.addEventListener("click", (event) => {
  const tile = event.target.closest("[data-detail-ad-id]");
  if (tile) {
    // A click that lands on an interactive control inside the card (Boost /
    // Delete on My Ads cards) should fire that control's own handler instead
    // of opening the detail modal. Public browse tiles are themselves a
    // <button> so `interactive === tile` and we still open the modal.
    const interactive = event.target.closest("button, a, input, select, textarea");
    if (interactive && interactive !== tile) {
      // Let the inner control handle this click in its own listener.
    } else {
      // Pass the list this tile belongs to so swipe navigation works.
      // Browse tiles live in #adsList → lastRenderedBrowseList; My Ads
      // cards live in #myAdsList → lastRenderedMyAdsList.
      const isMyAds = tile.classList.contains("my-ad-card");
      const navList = isMyAds ? lastRenderedMyAdsList : lastRenderedBrowseList;
      openAdDetail(tile.dataset.detailAdId, navList);
      return;
    }
  }
  if (event.target === closeAdDetailBtn) {
    closeAdDetail();
    return;
  }
  if (event.target === adDetailModal) {
    // Click landed on the dim backdrop, not the modal card.
    closeAdDetail();
    return;
  }
  const thumb = event.target.closest(".detail-thumb");
  if (thumb && detailHeroImage && detailThumbnails) {
    const src = thumb.dataset.thumbSrc || thumb.src;
    detailHeroImage.src = src;
    detailThumbnails.querySelectorAll(".detail-thumb").forEach((t) => {
      t.classList.toggle("is-active", t === thumb);
    });
  }
});

// Keyboard support for My Ads cards (which are <article role="button"> rather
// than real <button>s, so they don't get Enter/Space activation for free).
document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = event.target.closest(".my-ad-card[data-detail-ad-id]");
  if (!card || event.target !== card) return;
  event.preventDefault();
  openAdDetail(card.dataset.detailAdId, lastRenderedMyAdsList);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && adDetailModal && !adDetailModal.hidden) {
    closeAdDetail();
  }
});

// --- Swipe / arrow-key navigation through neighbouring ads -------------
//
// Walks the cached navigation list (lastRenderedBrowseList /
// lastRenderedMyAdsList — set when the modal opened) by `delta` positions
// and re-opens the modal with the neighbour. Because both lists are
// already sorted newest-first (with gold-first on browse), `delta = +1`
// advances to an older ad and `delta = -1` rewinds to a newer one. That
// matches the user's mental model: swiping right-to-left "pushes the
// current ad off" to reveal an older one underneath.
function navigateDetailRelative(delta) {
  if (
    !currentDetailNavList.length ||
    currentDetailNavIndex < 0 ||
    currentDetailNavIndex >= currentDetailNavList.length
  ) {
    return;
  }
  const next = currentDetailNavIndex + delta;
  if (next < 0) {
    showToast("Already at the newest ad.");
    return;
  }
  if (next >= currentDetailNavList.length) {
    showToast("No older ads to show.");
    return;
  }
  const nextAd = currentDetailNavList[next];
  if (!nextAd || !nextAd.id) return;
  // Pass the same list back in so navigation continues to work after the
  // jump (otherwise the next openAdDetail call would clear the context).
  openAdDetail(String(nextAd.id), currentDetailNavList).catch(() => {});
}

// Arrow keys = the desktop equivalent of swipe. ←/→ when the modal is
// open and the user isn't typing in a form field, mirroring how image
// viewers / native iOS Photos behave.
document.addEventListener("keydown", (event) => {
  if (!adDetailModal || adDetailModal.hidden) return;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  const tag = (event.target && event.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  event.preventDefault();
  // Left arrow = newer ad (rewind through the list); right arrow = older.
  navigateDetailRelative(event.key === "ArrowLeft" ? -1 : 1);
});

// Touch swipe — only fires on devices with a touchscreen. We listen on
// the modal-backdrop (not document) so swipes outside the modal don't
// accidentally trigger navigation. passive: true so vertical scrolling
// inside the modal stays butter-smooth — we only react on `touchend`.
if (adDetailModal) {
  let swipeStartX = 0;
  let swipeStartY = 0;
  let swipeStartedAt = 0;
  // Tuned thresholds: needs at least 50px horizontal AND less than 80px
  // vertical drift (otherwise it was a diagonal scroll, not a swipe).
  // Anything slower than ~800ms looks like a long-press / hesitation, so
  // we ignore it to avoid surprising "I'm scrolling, why did the ad
  // change" navigations.
  const MIN_HORIZONTAL_PX = 50;
  const MAX_VERTICAL_PX = 80;
  const MAX_DURATION_MS = 800;

  adDetailModal.addEventListener(
    "touchstart",
    (event) => {
      if (!event.touches.length) return;
      swipeStartX = event.touches[0].clientX;
      swipeStartY = event.touches[0].clientY;
      swipeStartedAt = Date.now();
    },
    { passive: true },
  );

  adDetailModal.addEventListener(
    "touchend",
    (event) => {
      if (!event.changedTouches.length) return;
      const dx = event.changedTouches[0].clientX - swipeStartX;
      const dy = event.changedTouches[0].clientY - swipeStartY;
      const dt = Date.now() - swipeStartedAt;
      if (Math.abs(dx) < MIN_HORIZONTAL_PX) return;
      if (Math.abs(dy) > MAX_VERTICAL_PX) return;
      if (dt > MAX_DURATION_MS) return;
      // Right-to-left swipe (dx < 0) → next/older ad.
      // Left-to-right swipe (dx > 0) → previous/newer ad.
      navigateDetailRelative(dx < 0 ? 1 : -1);
    },
    { passive: true },
  );
}

function handleAdShareDeepLink() {
  // If the page was opened with ?ad=<id> (a shared link), pop the detail
  // modal on top of the SPA so the visitor sees the listing immediately —
  // whether or not they're logged in. The backend gates contact info to
  // authed callers, so anonymous visitors see the ad + the sign-up CTA.
  const params = new URLSearchParams(window.location.search);
  const sharedAdId = params.get("ad");
  if (sharedAdId) {
    lastSharedAdId = sharedAdId;
    openAdDetail(sharedAdId).catch(() => { /* error surfaced inside modal */ });
  }
}

(async function initClassifieds() {
  await Promise.all([refreshMe(), loadGoldConfig()]);
  updateAuthUI();
  handleGoldReturnParams();
  await renderAds();
  handleAdShareDeepLink();
})();
