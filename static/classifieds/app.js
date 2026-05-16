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
const authSection = document.getElementById("authSection");
const profileSection = document.getElementById("profileSection");
const postAdSection = document.getElementById("postAdSection");
const myAdsSection = document.getElementById("myAdsSection");
const myAdsList = document.getElementById("myAdsList");
const myAdsHint = document.getElementById("myAdsHint");
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
const adImagesInput = document.getElementById("adImages");
const adsList = document.getElementById("adsList");
const adsBrowseSection = document.getElementById("adsBrowseSection");
const adsScopeHint = document.getElementById("adsScopeHint");
const adsFiltersWrap = document.getElementById("adsFiltersWrap");
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
}

async function renderAds() {
  const userRecord = getCurrentUserRecord();
  if (!userRecord || isProfileActive()) {
    adsList.innerHTML = "";
    if (adsScopeHint) adsScopeHint.textContent = "";
    if (adsFiltersWrap) adsFiltersWrap.hidden = true;
    return;
  }

  try {
    const ads = await classifiedsApi("/ads");
    ads.sort((a, b) => b.createdAt - a.createdAt);

    // Reveal the category filter only when there's something to filter; the dropdown is
    // pre-populated at module load, so we just toggle the wrapping container here.
    if (adsFiltersWrap) adsFiltersWrap.hidden = ads.length === 0;
    const selectedCategory = homeCategoryFilter ? homeCategoryFilter.value : "";
    const filtered = selectedCategory
      ? ads.filter((ad) => ad.category === selectedCategory)
      : ads;

    if (!ads.length) {
      adsScopeHint.textContent = `Showing newest ads for ${userRecord.state}.`;
      adsList.innerHTML = `<p>No ads posted yet for ${escapeHTML(userRecord.state)}.</p>`;
      return;
    }
    adsScopeHint.textContent = selectedCategory
      ? `Showing ${filtered.length} ${selectedCategory} ad${filtered.length === 1 ? "" : "s"} for ${userRecord.state}.`
      : `Showing newest ads for ${userRecord.state}.`;
    if (!filtered.length) {
      adsList.innerHTML = `<p>No ${escapeHTML(selectedCategory)} ads in ${escapeHTML(userRecord.state)} right now.</p>`;
      return;
    }

    // Compact image-first tile. The whole tile is a <button> so it's keyboard-focusable
    // and click-delegated via [data-detail-ad-id] in the global handler. Title/category/
    // contact info live in the detail modal that opens on tap to keep tiles scannable.
    adsList.innerHTML = filtered
      .map((ad) => {
        const firstImage = (ad.images || []).find(Boolean) || "";
        const goldClass = isGoldActive(ad) ? " ad-tile--gold" : "";
        const goldOverlay = isGoldActive(ad)
          ? `<span class="ad-tile-badge" aria-label="Gold ad">★ Gold</span>`
          : "";
        const imageHtml = firstImage
          ? `<img class="ad-tile-image" src="${escapeHTML(firstImage)}" alt="${escapeHTML(ad.title || "Ad")}" loading="lazy" />`
          : `<div class="ad-tile-empty">${escapeHTML(ad.title || "No image")}</div>`;
        const aria = `${ad.title || "Ad"} — ${ad.price || ""}`;
        return `
      <button type="button" class="ad-tile${goldClass}" data-detail-ad-id="${escapeHTML(ad.id)}" aria-label="${escapeHTML(aria)}">
        ${imageHtml}
        ${goldOverlay}
        <span class="ad-tile-price">${escapeHTML(ad.price)}</span>
      </button>
    `;
      })
      .join("");
  } catch (error) {
    adsList.innerHTML = `<p class="hint">Could not load ads: ${escapeHTML(error.message)}</p>`;
    if (adsScopeHint) adsScopeHint.textContent = "";
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
    if (!ads.length) {
      if (myAdsHint) myAdsHint.textContent = "You haven't posted any ads yet.";
      myAdsList.innerHTML = "";
      return;
    }
    if (myAdsHint) {
      myAdsHint.textContent = `You have ${ads.length} ad${ads.length === 1 ? "" : "s"} posted.`;
    }
    myAdsList.innerHTML = ads
      .map((ad) => {
        const imageBlock = (ad.images || [])
          .map(
            (img, index) =>
              `<img src="${String(img).replace(/"/g, "&quot;")}" alt="Ad image ${index + 1}" loading="lazy" />`
          )
          .join("");
        const gold = isGoldActive(ad);
        const goldClass = gold ? " ad-item--gold" : "";
        const boostLabel = gold ? "Extend Gold" : "Boost to Gold ★";
        const boostBtn = goldConfig?.enabled
          ? `<button type="button" class="my-ad-boost" data-boost-ad-id="${escapeHTML(ad.id)}">${boostLabel}</button>`
          : "";
        return `
      <article class="ad-item${goldClass}" data-ad-id="${escapeHTML(ad.id)}">
        <div class="ad-title-row">
          <span>${escapeHTML(ad.title)} ${goldBadgeHTML(ad)}</span>
          <span>${escapeHTML(ad.price)}</span>
        </div>
        <p>${escapeHTML(ad.description)}</p>
        <p class="meta">
          ${escapeHTML(ad.category)} / ${escapeHTML(ad.subCategory)} in ${escapeHTML(ad.state)}
        </p>
        <p class="meta">Posted ${new Date(ad.createdAt).toLocaleString()}</p>
        <div class="image-grid">${imageBlock}</div>
        <div class="my-ad-actions">
          ${boostBtn}
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
    const btn = event.target.closest(".my-ad-delete");
    if (!btn) return;
    const adId = btn.dataset.adId;
    if (!adId) return;
    if (!window.confirm("Delete this ad? This cannot be undone.")) return;
    btn.disabled = true;
    btn.textContent = "Deleting…";
    try {
      await classifiedsApi(`/ads/${encodeURIComponent(adId)}`, { method: "DELETE" });
      await renderMyAds();
      await renderAds(); // browse list may have included this ad too
      showToast("Ad deleted.");
    } catch (error) {
      btn.disabled = false;
      btn.textContent = "Delete";
      showToast(error.message || "Could not delete ad.");
    }
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
    renderAds().catch(() => { /* surfaced via adsList content */ });
  });
}

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

  if (!state) {
    showToast("Please select your state.");
    return;
  }

  try {
    const data = await classifiedsApi("/register", {
      method: "POST",
      withAuth: false,
      jsonBody: { username, state, password, email, phone },
    });
    setSessionToken(data.token);
    cachedUser = data.user;
    registerForm.reset();
    setProfileActive(false);
    updateAuthUI();
    await renderAds();
    showToast("Account created. You are logged in.");
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
    loginForm.reset();
    updateAuthUI();
    await renderAds();
    showToast("Logged in successfully.");
  } catch (error) {
    showToast(error.message || "Login failed.");
  }
});

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
  const price = String(formData.get("price")).trim();
  const description = String(formData.get("description")).trim();
  const files = adImagesInput.files ? Array.from(adImagesInput.files) : [];

  if (!state || !category || !subCategory) {
    showToast("State, category, and sub category are required.");
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
        category,
        subCategory,
        price,
        description,
        images,
      },
    });
    adForm.reset();
    adStateSelect.value = getCurrentUserRecord()?.state || "";
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
const detailGoldBannerEl = document.getElementById("detailGoldBanner");
const closeAdDetailBtn = document.getElementById("closeAdDetailBtn");

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
  if (detailGoldBannerEl) detailGoldBannerEl.hidden = true;
  detailModalCard?.classList.remove("gold-frame-active");
}

function renderDetailContact(ad) {
  if (!detailContactEl) return;
  const email = (ad.authorEmail || "").trim();
  const phone = (ad.authorPhone || "").trim();
  // Build a tel: link by stripping non-digits but preserving a leading + for intl numbers.
  const telHref = phone ? phone.replace(/(?!^\+)[^\d]/g, "") : "";
  const rows = [];
  rows.push(
    `<div class="contact-row"><span class="contact-label">Seller</span><span>${escapeHTML(ad.author || "(unknown)")}</span></div>`
  );
  if (email) {
    rows.push(
      `<div class="contact-row"><span class="contact-label">Email</span><a class="contact-link" href="mailto:${encodeURIComponent(email)}">${escapeHTML(email)}</a></div>`
    );
  }
  if (phone) {
    rows.push(
      `<div class="contact-row"><span class="contact-label">Phone</span><a class="contact-link" href="tel:${escapeHTML(telHref)}">${escapeHTML(phone)}</a></div>`
    );
  }
  if (!email && !phone) {
    rows.push(`<p class="contact-empty">Seller has not shared contact info.</p>`);
  }
  detailContactEl.innerHTML = rows.join("");
  detailContactEl.hidden = false;
}

async function openAdDetail(adId) {
  if (!adDetailModal || !adId) return;
  adDetailModal.hidden = false;
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
  if (detailGoldBannerEl) detailGoldBannerEl.hidden = true;
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

  if (detailTitleEl) detailTitleEl.textContent = ad.title || "";
  if (detailPriceEl) detailPriceEl.textContent = ad.price || "";
  if (detailDescriptionEl) detailDescriptionEl.textContent = ad.description || "";

  if (detailMetaEl) {
    const metaBits = [];
    const taxonomy = [ad.category, ad.subCategory].filter(Boolean).join(" / ");
    const where = ad.state ? `in ${ad.state}` : "";
    if (taxonomy || where) metaBits.push(`${taxonomy}${where ? " " + where : ""}`.trim());
    if (ad.createdAt) metaBits.push(`Posted ${new Date(ad.createdAt).toLocaleString()}`);
    detailMetaEl.innerHTML = metaBits
      .map((bit) => `<span class="detail-meta-row">${escapeHTML(bit)}</span>`)
      .join("");
  }

  renderDetailContact(ad);

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

  if (isGoldActive(ad) && detailGoldBannerEl) {
    detailGoldBannerEl.hidden = false;
    detailGoldBannerEl.textContent = `★ Gold listing — featured until ${new Date(ad.goldUntil).toLocaleString()}`;
    detailModalCard?.classList.add("gold-frame-active");
  }
}

// Click delegation for: tile → open detail modal; thumbnail → swap hero image;
// close button or backdrop → dismiss. Kept separate from the boost handler to
// avoid intermixing concerns.
document.addEventListener("click", (event) => {
  const tile = event.target.closest("[data-detail-ad-id]");
  if (tile) {
    openAdDetail(tile.dataset.detailAdId);
    return;
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

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && adDetailModal && !adDetailModal.hidden) {
    closeAdDetail();
  }
});

(async function initClassifieds() {
  await Promise.all([refreshMe(), loadGoldConfig()]);
  updateAuthUI();
  handleGoldReturnParams();
  await renderAds();
})();
