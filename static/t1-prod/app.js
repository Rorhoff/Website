/**
 * T1 Production SPA. Calls /api/t1prod/* (see t1prod_routes.py).
 * PIN-gated: shows unlock screen before loading the app.
 */

const API = "/api/t1prod";
let _pin = sessionStorage.getItem("t1prod_pin") || "";

const QUICK_PROMPTS = [
  { label: "Cannot log in", text: "The user says they cannot log in. They tried resetting password but did not get an email. What should we check first?" },
  { label: "Import failed", text: "Import job failed with a generic error. The customer attached a small CSV. What are the first troubleshooting steps?" },
  { label: "Page error", text: "The application shows a white screen or 500 error on one page only; other pages work. How should we triage?" },
  { label: "Slow performance", text: "The customer reports the system is very slow at peak times. No error message. What should we ask and suggest?" },
];

function el(id) {
  return document.getElementById(id);
}

async function fetchJSON(path, opts = {}) {
  const { headers: optHeaders, ...restOpts } = opts;
  const r = await fetch(API + path, {
    headers: { Accept: "application/json", "X-T1-Pin": _pin, ...(optHeaders || {}) },
    ...restOpts,
  });
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { _raw: text };
  }
  if (!r.ok) {
    const msg = data?.detail || data?._raw || r.statusText;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

function setBanner(id, message, kind) {
  const b = el(id);
  if (!b) return;
  b.textContent = message;
  b.className = "banner " + (kind || "info");
  b.hidden = !message;
}

function tabSwitch(name) {
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === name);
  });
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    panel.hidden = panel.getAttribute("data-panel") !== name;
  });
  if (name === "knowledge") loadDocuments().catch((e) => setBanner("kbBanner", String(e), "err"));
  if (name === "tickets") loadTickets().catch((e) => setBanner("ticketBanner", String(e), "err"));
  if (name === "agent") refreshStatus().catch(() => {});
}

function wireGotoTabs() {
  document.querySelectorAll("[data-goto]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-goto");
      if (target) tabSwitch(target);
    });
  });
}

async function refreshStatus() {
  try {
    const s = await fetchJSON("/status");
    const pill = el("apiPill");
    if (pill) {
      pill.textContent = s.anthropic_configured ? "Claude API: on" : "Claude API: not configured";
      pill.className = "pill " + (s.anthropic_configured ? "ok" : "warn");
    }
    const sub = el("statusSub");
    if (sub) {
      sub.textContent = `${s.documents} docs · ${s.images} screenshots · ${s.tickets} tickets`;
    }
  } catch (e) {
    setBanner("agentBanner", String(e), "err");
  }
}

async function loadDocuments() {
  const [docs, imgs] = await Promise.all([fetchJSON("/documents"), fetchJSON("/images")]);
  const docList = el("docList");
  if (!docList) return;

  let html = docs.length
    ? docs.map((d) =>
        `<li class="kb-item"><div><strong>${escapeHtml(d.title)}</strong> <span class="muted">${d.chunk_count} chunks</span></div><button type="button" class="btn sm danger" data-del-doc="${d.id}">Remove</button></li>`
      ).join("")
    : '<li class="muted">No documents yet.</li>';

  if (imgs.length) {
    html += imgs.map((im) => `
      <li class="kb-item img-row" data-id="${im.id}">
        <a href="${im.url_path}" target="_blank" rel="noopener"><img src="${im.url_path}" alt="" class="thumb" /></a>
        <div class="grow">
          <div class="muted sm">${escapeHtml(im.filename)}</div>
          <input type="text" class="caption-in" data-cap="${im.id}" placeholder="What this screenshot shows (settings, error, …)" value="${escapeAttr(im.caption || "")}" />
        </div>
        <div class="img-actions">
          <button type="button" class="btn sm" data-save-cap="${im.id}">Save caption</button>
          <button type="button" class="btn sm danger" data-del-img="${im.id}">Remove</button>
        </div>
      </li>`).join("");
  }

  docList.innerHTML = html;

  docList.querySelectorAll("[data-del-doc]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remove this document from the knowledge base?")) return;
      await fetchJSON(`/documents/${btn.getAttribute("data-del-doc")}`, { method: "DELETE" });
      loadDocuments().catch(() => {});
      refreshStatus().catch(() => {});
    });
  });
  docList.querySelectorAll("[data-save-cap]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-save-cap");
      const input = docList.querySelector(`input[data-cap="${id}"]`);
      const fd = new FormData();
      fd.set("caption", input?.value || "");
      await fetchJSON(`/images/${id}/caption`, { method: "POST", body: fd });
      setBanner("kbBanner", "Caption saved.", "ok");
      setTimeout(() => setBanner("kbBanner", "", ""), 2000);
    });
  });
  docList.querySelectorAll("[data-del-img]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remove this image?")) return;
      await fetchJSON(`/images/${btn.getAttribute("data-del-img")}`, { method: "DELETE" });
      loadDocuments().catch(() => {});
      refreshStatus().catch(() => {});
    });
  });
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

async function loadTickets() {
  const tickets = await fetchJSON("/tickets");
  const list = el("ticketList");
  if (!list) return;
  list.innerHTML = tickets.length
    ? tickets.map((t) => `
      <article class="ticket-card" data-tid="${t.id}">
        <div class="ticket-head">
          <span class="pill st-${t.status}">${t.status.replace("_", " ")}</span>
          <span class="muted sm">#${t.id} · ${escapeHtml(t.created_at || "")}</span>
        </div>
        <h4>${escapeHtml(t.subject)}</h4>
        <p class="desc">${escapeHtml(t.description).slice(0, 200)}${t.description.length > 200 ? "…" : ""}</p>
        ${t.last_reply ? `<details class="ai-out"><summary>Last AI reply</summary><pre class="ai-pre">${escapeHtml(t.last_reply)}</pre></details>` : ""}
        <div class="ticket-actions">
          <button type="button" class="btn sm" data-run-ai="${t.id}">Run AI on ticket</button>
        </div>
        ${t.audit && t.audit.length ? `<details class="audit"><summary>Audit trail (${t.audit.length})</summary><pre class="audit-pre">${escapeHtml(JSON.stringify(t.audit, null, 2))}</pre></details>` : ""}
      </article>`).join("")
    : '<p class="muted">No tickets yet.</p>';
  list.querySelectorAll("[data-run-ai]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = +btn.getAttribute("data-run-ai");
      setBanner("ticketBanner", "Running AI…", "info");
      try {
        const res = await fetchJSON(`/tickets/${id}/ai-resolve`, { method: "POST" });
        setBanner("ticketBanner", "AI response recorded.", "ok");
        el("aiOutput").textContent = res.reply;
        loadTickets().catch(() => {});
        refreshStatus().catch(() => {});
        tabSwitch("tickets");
      } catch (e) {
        setBanner("ticketBanner", String(e), "err");
      }
    });
  });
}

function buildQuickPrompts() {
  const host = el("quickPrompts");
  if (!host) return;
  host.innerHTML = QUICK_PROMPTS.map(
    (p) => `<button type="button" class="qp" data-qp="${encodeURIComponent(p.text)}">${escapeHtml(p.label)}</button>`
  ).join("");
  host.querySelectorAll(".qp").forEach((b) => {
    b.addEventListener("click", () => {
      const ta = el("chatInput");
      if (ta) ta.innerText = decodeURIComponent(b.getAttribute("data-qp") || "");
      ta?.focus();
    });
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function extractImages(container) {
  const results = [];
  for (const img of Array.from(container.querySelectorAll("img"))) {
    const src = img.getAttribute("src") || "";
    if (src.startsWith("data:image/")) {
      results.push(src);
    } else if (src.startsWith("blob:")) {
      try {
        results.push(await blobToDataUrl(await (await fetch(src)).blob()));
      } catch { /* inaccessible blob */ }
    } else if (src) {
      try {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth || 400;
        c.height = img.naturalHeight || 300;
        c.getContext("2d").drawImage(img, 0, 0);
        results.push(c.toDataURL("image/png"));
      } catch { /* CORS-blocked URL */ }
    }
  }
  return results;
}

function initChat() {
  const form = el("chatForm");
  if (!form) return;
  buildQuickPrompts();

  const chatTextarea = el("chatInput");
  if (chatTextarea) {
    chatTextarea.addEventListener("paste", (ev) => {
      const cd = ev.clipboardData;
      if (!cd) return;
      // Native clipboard image (e.g. Win+Shift+S screenshot) — insert inline
      const items = Array.from(cd.items || []);
      const imgItem = items.find((i) => i.kind === "file" && i.type.startsWith("image/"));
      if (imgItem) {
        const file = imgItem.getAsFile();
        if (file) {
          ev.preventDefault();
          const reader = new FileReader();
          reader.onload = (e) => {
            const img = document.createElement("img");
            img.src = e.target.result;
            const sel = window.getSelection();
            if (sel && sel.rangeCount) {
              const range = sel.getRangeAt(0);
              range.deleteContents();
              range.insertNode(img);
              range.setStartAfter(img);
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);
            } else {
              chatTextarea.appendChild(img);
            }
          };
          reader.readAsDataURL(file);
          return;
        }
      }
      // Rich HTML (email with inline images) — let browser paste naturally
    });
  }

  const copyBtn = el("copyReply");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const out = el("aiOutput");
      if (!out?.textContent?.trim() || out.textContent === "No response yet.") return;
      try {
        await navigator.clipboard.writeText(out.textContent);
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = "Copy reply"; }, 2000);
      } catch { /* ignore */ }
    });
  }
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const input = el("chatInput");
    const logTicket = el("logTicket");
    const out = el("aiOutput");
    const retrieval = el("retrieval");
    const submitBtn = el("chatSubmit");
    if (!input?.innerText?.trim() && !input?.querySelector("img")) return;
    out.textContent = "Working on your request…";
    if (retrieval) retrieval.innerHTML = "";
    const kbImages = el("kbImages");
    if (kbImages) { kbImages.hidden = true; kbImages.innerHTML = ""; }
    if (copyBtn) { copyBtn.hidden = true; copyBtn.textContent = "Copy reply"; }
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Working…"; }
    try {
      const images = await extractImages(input);
      const res = await fetchJSON("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input.innerText, create_ticket: !!(logTicket && logTicket.checked), images }),
      });
      out.textContent = res.reply;
      if (copyBtn) copyBtn.hidden = !res.reply?.trim();
      if (res.ticket_id) {
        setBanner("agentBanner", `Logged as ticket #${res.ticket_id} (status: ${res.status})`, "ok");
      } else {
        setBanner("agentBanner", `Status: ${res.status} · Claude: ${res.anthropic_configured ? "yes" : "no"}`, "info");
      }
      if (retrieval && res.retrieval && res.retrieval.length) {
        retrieval.innerHTML = "<strong>Top matches from your knowledge base</strong><ul>" +
          res.retrieval.map((r) => `<li><em>${escapeHtml(r.title)}</em>. ${escapeHtml(r.preview).slice(0, 200)}${r.preview && r.preview.length > 200 ? "..." : ""}</li>`).join("") +
          "</ul>";
      } else if (retrieval) {
        retrieval.innerHTML = '<p class="muted">No strong KB matches.</p>';
      }
      if (kbImages && res.kb_images && res.kb_images.length) {
        kbImages.hidden = false;
        kbImages.innerHTML = '<p class="sm muted" style="margin:0 0 0.3rem">Related KB screenshots</p><div class="kb-images">' +
          res.kb_images.map((img) =>
            `<div class="kb-image-card"><a href="${escapeAttr(img.url_path)}" target="_blank" rel="noopener"><img src="${escapeAttr(img.url_path)}" alt="${escapeAttr(img.caption || "")}" /></a><div class="kb-image-cap">${escapeHtml(img.caption || "")}</div></div>`
          ).join("") + "</div>";
      }
      input.innerHTML = "";
      loadTickets().catch(() => {});
      refreshStatus().catch(() => {});
    } catch (e) {
      out.textContent = "Error: " + e.message;
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Get resolution"; }
    }
  });
}

async function _uploadImgIfPresent(imgFile, captionFallback) {
  if (!imgFile) return;
  const ifd = new FormData();
  ifd.set("file", imgFile);
  ifd.set("caption", captionFallback || imgFile.name);
  await fetchJSON("/images", { method: "POST", body: ifd });
}

function initDocUpload() {
  const form = el("docUploadForm");
  if (form) {
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const files = Array.from(el("docFile")?.files || []);
      if (!files.length) { setBanner("kbBanner", "Select at least one file.", "err"); return; }
      const imgFile = el("docImg")?.files?.[0];
      const titleBase = (el("docTitle")?.value || "").trim();
      setBanner("kbBanner", `Uploading ${files.length} file${files.length > 1 ? "s" : ""}…`, "info");
      try {
        await _uploadImgIfPresent(imgFile?.size ? imgFile : null, titleBase);
        for (const file of files) {
          const fd = new FormData();
          fd.set("file", file);
          if (titleBase) fd.set("title", files.length === 1 ? titleBase : `${titleBase} — ${file.name}`);
          await fetchJSON("/documents", { method: "POST", body: fd });
        }
        form.reset();
        setBanner("kbBanner", `${files.length} file${files.length > 1 ? "s" : ""} added to knowledge base.`, "ok");
        loadDocuments().catch(() => {});
        refreshStatus().catch(() => {});
      } catch (e) {
        setBanner("kbBanner", String(e), "err");
      }
    });
  }
  const pasteForm = el("pasteDocForm");
  if (pasteForm) {
    pasteForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      setBanner("kbBanner", "Adding text…", "info");
      const bodyText = (el("pasteBody")?.value) || "";
      if (!bodyText.trim()) return;
      const imgFile = el("pasteImg")?.files?.[0];
      const pt = (el("pasteTitle")?.value || "").trim();
      const fd = new FormData();
      fd.set("text", bodyText);
      if (pt) fd.set("title", pt);
      try {
        await _uploadImgIfPresent(imgFile?.size ? imgFile : null, pt);
        await fetchJSON("/documents", { method: "POST", body: fd });
        pasteForm.reset();
        setBanner("kbBanner", "Added to knowledge base.", "ok");
        loadDocuments().catch(() => {});
        refreshStatus().catch(() => {});
      } catch (e) {
        setBanner("kbBanner", String(e), "err");
      }
    });
  }
}

function initTicketForm() {
  const form = el("newTicketForm");
  if (form) {
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      setBanner("ticketBanner", "Submitting…", "info");
      const subject = el("tSubject")?.value?.trim();
      const description = el("tBody")?.value?.trim();
      const email = el("tEmail")?.value?.trim();
      try {
        await fetchJSON("/tickets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subject, description, requester_email: email || null }),
        });
        form.reset();
        setBanner("ticketBanner", "Ticket created.", "ok");
        loadTickets().catch(() => {});
        refreshStatus().catch(() => {});
      } catch (e) {
        setBanner("ticketBanner", String(e), "err");
      }
    });
  }
}

function init() {
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => tabSwitch(btn.getAttribute("data-tab")));
  });
  initDocUpload();
  initChat();
  initTicketForm();
  wireGotoTabs();
  refreshStatus().catch(() => {});
  tabSwitch("home");
}

// ── PIN gate ──────────────────────────────────────────────────────────────────

async function initPinGate() {
  const gate = el("pinGate");
  if (!gate) { init(); return; }

  if (_pin) {
    try {
      await fetchJSON("/status");
      gate.hidden = true;
      init();
      return;
    } catch {
      _pin = "";
      sessionStorage.removeItem("t1prod_pin");
    }
  }

  const input = el("pinInput");
  const btn = el("pinSubmit");
  const err = el("pinError");

  async function tryPin() {
    _pin = (input?.value || "").trim();
    if (!_pin) return;
    err.hidden = true;
    btn.textContent = "Checking…";
    btn.disabled = true;
    try {
      await fetchJSON("/status");
      sessionStorage.setItem("t1prod_pin", _pin);
      gate.hidden = true;
      init();
    } catch {
      _pin = "";
      err.hidden = false;
      btn.textContent = "Unlock";
      btn.disabled = false;
      input.value = "";
      input.focus();
    }
  }

  btn.addEventListener("click", tryPin);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") tryPin(); });
  input.focus();
}

document.addEventListener("DOMContentLoaded", initPinGate);
