/**
 * Messaging UI (Sprint 1) — hash routes, contact seller modal, inbox.
 * Requires window.t1ClassifiedsCore from app.js.
 */
(function () {
  const core = () => window.t1ClassifiedsCore;
  if (!core()) return;

  const PRESET_REQUIRES_CUSTOM = new Set(["other"]);

  const messagesSection = document.getElementById("messagesSection");
  const messagesInboxView = document.getElementById("messagesInboxView");
  const messagesThreadView = document.getElementById("messagesThreadView");
  const messagesInboxList = document.getElementById("messagesInboxList");
  const messagesThreadHeader = document.getElementById("messagesThreadHeader");
  const messagesThreadBody = document.getElementById("messagesThreadBody");
  const messagesReplyForm = document.getElementById("messagesReplyForm");
  const messagesReplyInput = document.getElementById("messagesReplyInput");
  const messagesBackBtn = document.getElementById("messagesBackBtn");
  const messagesNavBtn = document.getElementById("messagesNavBtn");
  const messagesUnreadBadge = document.getElementById("messagesUnreadBadge");
  const menuUnreadBadge = document.getElementById("menuUnreadBadge");

  const contactSellerModal = document.getElementById("contactSellerModal");
  const contactSellerTitle = document.getElementById("contactSellerTitle");
  const contactSellerListing = document.getElementById("contactSellerListing");
  const contactSellerGuestStep = document.getElementById("contactSellerGuestStep");
  const contactSellerComposeStep = document.getElementById("contactSellerComposeStep");
  const contactSellerGuestForm = document.getElementById("contactSellerGuestForm");
  const contactSellerEmail = document.getElementById("contactSellerEmail");
  const contactSellerPreset = document.getElementById("contactSellerPreset");
  const contactSellerCustom = document.getElementById("contactSellerCustom");
  const contactSellerSendBtn = document.getElementById("contactSellerSendBtn");
  const contactSellerCloseBtn = document.getElementById("contactSellerCloseBtn");

  let pendingContactAdId = null;
  let currentThreadId = null;
  let currentThreadMeta = null;
  let unreadPollTimer = null;
  const messagesShareContactBtn = document.getElementById("messagesShareContactBtn");

  function parseHashRoute() {
    const raw = (window.location.hash || "").replace(/^#\/?/, "").trim();
    if (raw === "messages") return { view: "inbox" };
    if (raw.startsWith("messages/")) {
      const id = raw.slice("messages/".length).split("/")[0];
      if (id) return { view: "thread", conversationId: id };
    }
    return { view: "home" };
  }

  function isMessagesRoute() {
    const v = parseHashRoute().view;
    return v === "inbox" || v === "thread";
  }

  function hideMainForMessages() {
    ["authSection", "profileSection", "postAdSection", "myAdsSection", "adsBrowseSection"].forEach(
      (id) => {
        const el = document.getElementById(id);
        if (el) el.hidden = true;
      }
    );
    const tabs = document.getElementById("profileTabs");
    if (tabs) tabs.hidden = true;
  }

  function setHash(path) {
    const next = path ? `#/${path}` : "";
    if (window.location.hash !== next) {
      window.location.hash = next;
    } else {
      onRouteChange();
    }
  }

  function hideMessagesSection() {
    if (messagesSection) messagesSection.hidden = true;
  }

  function clearMessagesUI() {
    currentThreadId = null;
    currentThreadMeta = null;
    if (messagesInboxList) messagesInboxList.innerHTML = "";
    if (messagesThreadHeader) messagesThreadHeader.innerHTML = "";
    if (messagesThreadBody) messagesThreadBody.innerHTML = "";
    if (messagesReplyInput) messagesReplyInput.value = "";
    if (messagesInboxView) messagesInboxView.hidden = false;
    if (messagesThreadView) messagesThreadView.hidden = true;
  }

  /** Clear #/messages and hide the panel (caller runs updateAuthUI). */
  function clearMessagesRoute() {
    hideMessagesSection();
    clearMessagesUI();
    const base = window.location.pathname + window.location.search;
    if (window.location.hash) {
      window.history.replaceState(null, "", base);
    }
  }

  /** Leave #/messages without leaving stale inbox HTML on screen. */
  function leaveMessagesRoute(showLoginToast) {
    clearMessagesRoute();
    core().updateAuthUI();
    if (showLoginToast) core().showToast("Log in to view messages.");
  }

  function showInbox() {
    if (!messagesSection) return;
    hideMainForMessages();
    messagesSection.hidden = false;
    if (messagesInboxView) messagesInboxView.hidden = false;
    if (messagesThreadView) messagesThreadView.hidden = true;
    if (messagesBackBtn) messagesBackBtn.hidden = false;
    const browse = document.getElementById("adsBrowseSection");
    if (browse) browse.hidden = true;
    loadInbox();
  }

  function showThread(conversationId) {
    if (!messagesSection) return;
    hideMainForMessages();
    messagesSection.hidden = false;
    if (messagesInboxView) messagesInboxView.hidden = true;
    if (messagesThreadView) messagesThreadView.hidden = false;
    if (messagesBackBtn) messagesBackBtn.hidden = false;
    const browse = document.getElementById("adsBrowseSection");
    if (browse) browse.hidden = true;
    currentThreadId = conversationId;
    loadThread(conversationId);
  }

  function showHomeFromMessages() {
    clearMessagesRoute();
    core().updateAuthUI();
  }

  async function loadInbox() {
    if (!messagesInboxList) return;
    messagesInboxList.innerHTML = "<p class=\"hint\">Loading…</p>";
    try {
      const data = await core().classifiedsApi("/messages");
      updateUnreadBadge(data.unreadCount || 0);
      const rows = data.conversations || [];
      if (!rows.length) {
        messagesInboxList.innerHTML = "<p class=\"hint\">No conversations yet.</p>";
        return;
      }
      messagesInboxList.innerHTML = rows
        .map((c) => {
          const unread = c.unreadCount > 0 ? `<span class="messages-row-unread">${c.unreadCount}</span>` : "";
          const thumb = c.listingThumb
            ? `<img class="messages-row-thumb" src="${core().escapeHTML(c.listingThumb)}" alt="" />`
            : `<div class="messages-row-thumb messages-row-thumb--empty"></div>`;
          return `<button type="button" class="messages-row" data-conv-id="${core().escapeHTML(c.id)}">
            ${thumb}
            <div class="messages-row-body">
              <div class="messages-row-top"><strong>${core().escapeHTML(c.otherPartyName)}</strong>${unread}</div>
              <div class="messages-row-title">${core().escapeHTML(c.listingTitle)}</div>
              <div class="messages-row-preview">${core().escapeHTML(c.lastMessagePreview || "")}</div>
            </div>
          </button>`;
        })
        .join("");
      messagesInboxList.querySelectorAll("[data-conv-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          setHash(`messages/${btn.getAttribute("data-conv-id")}`);
        });
      });
    } catch (err) {
      messagesInboxList.innerHTML = `<p class="hint">${core().escapeHTML(err.message || "Could not load messages.")}</p>`;
    }
  }

  async function loadThread(conversationId) {
    if (messagesThreadHeader) messagesThreadHeader.innerHTML = "<p class=\"hint\">Loading…</p>";
    if (messagesThreadBody) messagesThreadBody.innerHTML = "";
    try {
      const data = await core().classifiedsApi(`/messages/${encodeURIComponent(conversationId)}`);
      currentThreadMeta = data;
      const thumb = data.listingThumb
        ? `<img src="${core().escapeHTML(data.listingThumb)}" alt="" class="messages-thread-thumb" />`
        : `<div class="messages-thread-thumb messages-row-thumb--empty"></div>`;
      messagesThreadHeader.innerHTML = `
        ${thumb}
        <div class="messages-thread-header-text">
          <strong>${core().escapeHTML(data.listingTitle || "Listing")}</strong>
          <p class="hint">With ${core().escapeHTML(data.otherPartyName || "user")}</p>
          <a href="/?ad=${encodeURIComponent(data.listingId || "")}" class="messages-thread-listing-link">View listing</a>
        </div>`;
      const msgs = data.messages || [];
      messagesThreadBody.innerHTML = msgs
        .map((m) => {
          const shareClass =
            m.messageType === "contact_share" ? " messages-bubble--contact-share" : "";
          return `<div class="messages-bubble${m.isMine ? " messages-bubble--mine" : ""}${shareClass}">
            <div class="messages-bubble-meta">${core().escapeHTML(m.senderLabel)} · ${new Date(m.createdAt).toLocaleString()}</div>
            <div class="messages-bubble-body">${core().escapeHTML(m.body)}</div>
          </div>`;
        })
        .join("");
      messagesThreadBody.scrollTop = messagesThreadBody.scrollHeight;
      if (messagesShareContactBtn) {
        messagesShareContactBtn.hidden = data.viewerRole !== "seller";
      }
      refreshUnread();
    } catch (err) {
      messagesThreadHeader.innerHTML = `<p class="hint">${core().escapeHTML(err.message || "Could not load conversation.")}</p>`;
    }
  }

  async function refreshUnread() {
    if (!core().getCurrentUserRecord()) {
      updateUnreadBadge(0);
      return;
    }
    try {
      const data = await core().classifiedsApi("/messages");
      updateUnreadBadge(data.unreadCount || 0);
    } catch {
      /* ignore */
    }
  }

  function updateUnreadBadge(count) {
    const label = count > 99 ? "99+" : String(count);
    const show = count > 0;
    if (messagesUnreadBadge) {
      messagesUnreadBadge.hidden = !show;
      messagesUnreadBadge.textContent = show ? label : "";
    }
    if (menuUnreadBadge) {
      menuUnreadBadge.hidden = !show;
      menuUnreadBadge.textContent = show ? label : "";
    }
  }

  function onRouteChange() {
    const route = parseHashRoute();
    if (route.view === "inbox") {
      if (!core().getCurrentUserRecord()) {
        leaveMessagesRoute(true);
        return;
      }
      showInbox();
      return;
    }
    if (route.view === "thread" && route.conversationId) {
      if (!core().getCurrentUserRecord()) {
        leaveMessagesRoute(true);
        return;
      }
      showThread(route.conversationId);
      return;
    }
    hideMessagesSection();
    clearMessagesUI();
  }

  function openContactSellerModal(ad) {
    if (!contactSellerModal || !ad) return;
    pendingContactAdId = ad.id;
    contactSellerModal.hidden = false;
    if (contactSellerTitle) contactSellerTitle.textContent = "Contact Seller";
    if (contactSellerListing) {
      contactSellerListing.textContent = ad.title ? `About: ${ad.title}` : "";
    }
    const authed = Boolean(core().getCurrentUserRecord());
    if (contactSellerGuestStep) contactSellerGuestStep.hidden = authed;
    if (contactSellerComposeStep) contactSellerComposeStep.hidden = !authed;
    if (contactSellerPreset) contactSellerPreset.value = "";
    if (contactSellerCustom) contactSellerCustom.value = "";
  }

  function closeContactSellerModal() {
    if (contactSellerModal) contactSellerModal.hidden = true;
    pendingContactAdId = null;
  }

  async function sendContactMessage() {
    if (!pendingContactAdId) return;
    const presetKey = contactSellerPreset ? contactSellerPreset.value : "";
    const custom = contactSellerCustom ? contactSellerCustom.value.trim() : "";
    if (!presetKey && !custom) {
      core().showToast("Select a preset or write a message.");
      return;
    }
    if (PRESET_REQUIRES_CUSTOM.has(presetKey) && !custom) {
      core().showToast("Please write your message.");
      return;
    }
    try {
      const res = await core().classifiedsApi("/messages", {
        method: "POST",
        jsonBody: {
          adId: pendingContactAdId,
          presetKey: presetKey || undefined,
          body: custom || undefined,
        },
      });
      closeContactSellerModal();
      core().showToast("Message sent.");
      if (res.conversationId) {
        setHash(`messages/${res.conversationId}`);
      }
      refreshUnread();
    } catch (err) {
      core().showToast(err.message || "Could not send message.");
    }
  }

  async function handleMagicLinkQuery() {
    const params = new URLSearchParams(window.location.search);
    const ml = params.get("ml_token");
    if (!ml) return false;
    try {
      const payload = await core().classifiedsApi("/auth/magic-link/exchange", {
        method: "POST",
        jsonBody: { token: ml },
        withAuth: false,
      });
      core().setSessionToken(payload.token);
      await core().refreshMe();
      core().updateAuthUI();
      params.delete("ml_token");
      const openAd = params.get("openAd") || payload.openAd;
      const openInbox = params.has("openInbox") || payload.openInbox;
      if (openAd) params.set("ad", openAd);
      params.delete("openInbox");
      const clean =
        window.location.pathname + (params.toString() ? `?${params}` : "") + window.location.hash;
      window.history.replaceState({}, "", clean);
      core().showToast("You are signed in.");
      if (openInbox) {
        setHash("messages");
      } else if (openAd) {
        await core().openAdDetail(openAd);
        const ad = core().getCurrentDetailAd();
        if (ad && ad.canContact) {
          openContactSellerModal(ad);
        }
      }
      return true;
    } catch (err) {
      core().showToast(err.message || "Sign-in link invalid or expired.");
      params.delete("ml_token");
      const clean =
        window.location.pathname + (params.toString() ? `?${params}` : "");
      window.history.replaceState({}, "", clean);
      return true;
    }
  }

  window.t1Messaging = {
    openContactSellerModal,
    closeContactSellerModal,
    handleMagicLinkQuery,
    refreshUnread,
    startUnreadPolling,
    setHash,
    onRouteChange,
    updateUnreadBadge,
    isMessagesRoute,
    hideMessagesSection,
    clearMessagesUI,
    clearMessagesRoute,
    showHomeFromMessages,
    leaveMessagesRoute,
  };

  if (messagesNavBtn) {
    messagesNavBtn.addEventListener("click", () => setHash("messages"));
  }
  if (messagesBackBtn) {
    messagesBackBtn.addEventListener("click", () => showHomeFromMessages());
  }
  if (contactSellerCloseBtn) {
    contactSellerCloseBtn.addEventListener("click", closeContactSellerModal);
  }
  if (contactSellerSendBtn) {
    contactSellerSendBtn.addEventListener("click", sendContactMessage);
  }
  if (contactSellerGuestForm) {
    contactSellerGuestForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = contactSellerEmail ? contactSellerEmail.value.trim() : "";
      if (!email) return;
      const openAd = pendingContactAdId || "";
      try {
        await core().classifiedsApi("/auth/magic-link", {
          method: "POST",
          jsonBody: { email, openAd: openAd || undefined },
          withAuth: false,
        });
        closeContactSellerModal();
        core().showToast("Check your email for a sign-in link.");
      } catch (err) {
        core().showToast(err.message || "Could not send sign-in email.");
      }
    });
  }
  if (messagesShareContactBtn) {
    messagesShareContactBtn.addEventListener("click", async () => {
      if (!currentThreadId || !currentThreadMeta) return;
      if (currentThreadMeta.viewerRole !== "seller") return;
      const buyerName = currentThreadMeta.otherPartyName || "the buyer";
      const ok = window.confirm(
        `Share your phone number and email with ${buyerName}? They will see it in this conversation and get an email.`
      );
      if (!ok) return;
      try {
        await core().classifiedsApi(
          `/messages/${encodeURIComponent(currentThreadId)}/share-contact`,
          { method: "POST", jsonBody: {} }
        );
        core().showToast("Contact info shared.");
        await loadThread(currentThreadId);
      } catch (err) {
        core().showToast(err.message || "Could not share contact info.");
      }
    });
  }

  if (messagesReplyForm) {
    messagesReplyForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentThreadId || !messagesReplyInput) return;
      const body = messagesReplyInput.value.trim();
      if (!body) return;
      try {
        await core().classifiedsApi(`/messages/${encodeURIComponent(currentThreadId)}/reply`, {
          method: "POST",
          jsonBody: { body },
        });
        messagesReplyInput.value = "";
        await loadThread(currentThreadId);
        refreshUnread();
      } catch (err) {
        core().showToast(err.message || "Could not send reply.");
      }
    });
  }

  window.addEventListener("hashchange", onRouteChange);

  function startUnreadPolling() {
    if (unreadPollTimer) window.clearInterval(unreadPollTimer);
    if (!core().getCurrentUserRecord()) return;
    refreshUnread();
    unreadPollTimer = window.setInterval(refreshUnread, 15000);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshUnread();
  });
  window.addEventListener("focus", refreshUnread);

  document.addEventListener("DOMContentLoaded", () => {
    onRouteChange();
    startUnreadPolling();
  });
})();
