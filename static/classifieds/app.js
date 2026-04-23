const USERS_KEY = "classified_users";
const ADS_KEY = "classified_ads";
const CURRENT_USER_KEY = "classified_current_user";
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
const adStateSelect = document.getElementById("adState");
const adImagesInput = document.getElementById("adImages");
const adsList = document.getElementById("adsList");
const adsScopeHint = document.getElementById("adsScopeHint");
const authStatus = document.getElementById("authStatus");
const profileHint = document.getElementById("profileHint");
const toast = document.getElementById("toast");

function readJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getUsers() {
  return readJSON(USERS_KEY, []);
}

function writeUsers(users) {
  writeJSON(USERS_KEY, users);
}

function getAds() {
  return readJSON(ADS_KEY, []);
}

function writeAds(ads) {
  writeJSON(ADS_KEY, ads);
}

function getCurrentUser() {
  return localStorage.getItem(CURRENT_USER_KEY);
}

function setCurrentUser(username) {
  if (username) {
    localStorage.setItem(CURRENT_USER_KEY, username);
  } else {
    localStorage.removeItem(CURRENT_USER_KEY);
  }
}

function normalizeState(value) {
  return String(value).trim().toLowerCase();
}

function getCurrentUserRecord() {
  const currentUser = getCurrentUser();
  if (!currentUser) return null;
  return getUsers().find((user) => user.username === currentUser) || null;
}

function isProfileActive() {
  return localStorage.getItem(PROFILE_ACTIVE_KEY) === "true";
}

function setProfileActive(active) {
  localStorage.setItem(PROFILE_ACTIVE_KEY, active ? "true" : "false");
}

function hashPassword(password) {
  return btoa(password);
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

function updateAuthUI() {
  const currentUser = getCurrentUser();
  const userRecord = getCurrentUserRecord();
  const profileActive = Boolean(userRecord) && isProfileActive();

  // Hide register/login immediately whenever a user is logged in.
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
  } else {
    authStatus.textContent = "Not logged in";
    profileHint.textContent = "Log in, then use the top-right menu to enter your profile.";
    closeMenu();
  }
}

function renderAds() {
  const userRecord = getCurrentUserRecord();
  if (!userRecord) {
    adsScopeHint.textContent = "Log in to see ads from your state.";
    adsList.innerHTML = "<p>Please log in to view local ads.</p>";
    return;
  }

  const profileActive = isProfileActive();
  const ads = getAds()
    .filter((ad) => {
      if (profileActive) {
        return ad.author === userRecord.username;
      }
      return normalizeState(ad.state) === normalizeState(userRecord.state);
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  adsScopeHint.textContent = profileActive
    ? "Showing your ads from newest to oldest."
    : `Showing newest ads for ${userRecord.state}.`;
  if (!ads.length) {
    adsList.innerHTML = profileActive
      ? "<p>You have not posted any ads yet.</p>"
      : `<p>No ads posted yet for ${escapeHTML(userRecord.state)}.</p>`;
    return;
  }

  adsList.innerHTML = ads
    .map((ad) => {
      const imageBlock = ad.images
        .map((img, index) => `<img src="${img}" alt="Ad image ${index + 1}" loading="lazy" />`)
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

registerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(registerForm);
  const username = String(formData.get("username")).trim().toLowerCase();
  const state = String(formData.get("state")).trim();
  const password = String(formData.get("password"));

  if (!state) {
    showToast("Please select your state.");
    return;
  }

  const users = getUsers();
  const exists = users.some((user) => user.username === username);
  if (exists) {
    showToast("Username is already taken.");
    return;
  }

  users.push({ username, state, passwordHash: hashPassword(password) });
  writeUsers(users);
  registerForm.reset();
  showToast("Account created. You can login now.");
});

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const username = String(formData.get("username")).trim().toLowerCase();
  const password = String(formData.get("password"));

  const matchingUser = getUsers().find(
    (user) => user.username === username && user.passwordHash === hashPassword(password)
  );

  if (!matchingUser) {
    showToast("Invalid username or password.");
    return;
  }

  setCurrentUser(username);
  setProfileActive(false);
  loginForm.reset();
  updateAuthUI();
  renderAds();
  showToast("Logged in successfully.");
});

menuToggleBtn.addEventListener("click", () => {
  menuPanel.hidden = !menuPanel.hidden;
});

document.addEventListener("click", (event) => {
  if (!menuWrapper.contains(event.target)) {
    closeMenu();
  }
});

enterProfileBtn.addEventListener("click", () => {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    showToast("Log in first.");
    return;
  }
  setProfileActive(true);
  closeMenu();
  updateAuthUI();
  showToast("Profile mode enabled.");
});

exitProfileBtn.addEventListener("click", () => {
  // Exit profile mode but keep the user logged in.
  setProfileActive(false);
  closeMenu();
  updateAuthUI();
  renderAds();
  showToast("Exited profile mode.");
});

logoutBtn.addEventListener("click", () => {
  setCurrentUser(null);
  setProfileActive(false);
  closeMenu();
  updateAuthUI();
  renderAds();
  showToast("Logged out.");
});

profileForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const currentUser = getCurrentUser();
  const newState = String(new FormData(profileForm).get("state")).trim();
  if (!currentUser || !newState) return;

  const users = getUsers();
  const userIndex = users.findIndex((user) => user.username === currentUser);
  if (userIndex === -1) return;

  users[userIndex].state = newState;
  writeUsers(users);
  adStateSelect.value = newState;
  updateAuthUI();
  renderAds();
  showToast("Profile state updated.");
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
    const ads = getAds();
    ads.push({
      id: crypto.randomUUID(),
      title,
      state,
      category,
      subCategory,
      price,
      description,
      images,
      author: userRecord.username,
      createdAt: Date.now(),
    });
    writeAds(ads);
    adForm.reset();
    adStateSelect.value = getCurrentUserRecord()?.state || "";
    renderAds();
    showToast("Ad posted.");
  } catch (error) {
    showToast("One or more images could not be processed.");
  }
});

updateAuthUI();
renderAds();