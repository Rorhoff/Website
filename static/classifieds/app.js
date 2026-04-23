/**
 * DEV: Classifieds SPA client. API base: /api/classifieds (see classifieds_routes.py).
 * Token: localStorage CLASSIFIED_TOKEN_KEY; sent as Authorization: Bearer.
 * When adding endpoints, mirror paths here and in FastAPI router.
 */
const CLASSIFIED_TOKEN_KEY = "classified_api_session";
const PROFILE_ACTIVE_KEY = "classified_profile_active";

const registerForm = document.getElementById("registerForm");
const loginForm = document.getElementById("loginForm");
const profileForm = document.getElementById("profileForm");
const adForm = document.getElementById("adForm");
const authSection = document.getElementById("authSection");
const postAdSection = document.getElementById("postAdSection");
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
  postAdSection.hidden = !profileActive;
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
