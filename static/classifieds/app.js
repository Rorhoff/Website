/**
 * DEV: Classifieds SPA client. API base: /api/classifieds (see classifieds_routes.py).
 * Token: localStorage CLASSIFIED_TOKEN_KEY; sent as Authorization: Bearer.
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
    return;
  }

  try {
    const ads = await classifiedsApi("/ads");
    ads.sort((a, b) => b.createdAt - a.createdAt);

    adsScopeHint.textContent = `Showing newest ads for ${userRecord.state}.`;
    if (!ads.length) {
      adsList.innerHTML = `<p>No ads posted yet for ${escapeHTML(userRecord.state)}.</p>`;
      return;
    }

    adsList.innerHTML = ads
      .map((ad) => {
        const imageBlock = (ad.images || [])
          .map(
            (img, index) =>
              `<img src="${String(img).replace(/"/g, "&quot;")}" alt="Ad image ${index + 1}" loading="lazy" />`
          )
          .join("");

        return `
      <article class="ad-item">
        <div class="ad-title-row">
          <span>${escapeHTML(ad.title)}</span>
          <span>${escapeHTML(ad.price)}</span>
        </div>
        <p>${escapeHTML(ad.description)}</p>
        <p class="meta">
          ${escapeHTML(ad.category)} / ${escapeHTML(ad.subCategory)} in ${escapeHTML(ad.state)}
        </p>
        <p class="meta">Posted by ${escapeHTML(ad.author)} on ${new Date(ad.createdAt).toLocaleString()}</p>
        <div class="image-grid">${imageBlock}</div>
      </article>
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
        return `
      <article class="ad-item" data-ad-id="${escapeHTML(ad.id)}">
        <div class="ad-title-row">
          <span>${escapeHTML(ad.title)}</span>
          <span>${escapeHTML(ad.price)}</span>
        </div>
        <p>${escapeHTML(ad.description)}</p>
        <p class="meta">
          ${escapeHTML(ad.category)} / ${escapeHTML(ad.subCategory)} in ${escapeHTML(ad.state)}
        </p>
        <p class="meta">Posted ${new Date(ad.createdAt).toLocaleString()}</p>
        <div class="image-grid">${imageBlock}</div>
        <div class="my-ad-actions">
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
    const images = await filesToDataUrls(files);
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

(async function initClassifieds() {
  await refreshMe();
  updateAuthUI();
  await renderAds();
})();
