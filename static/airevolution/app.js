/**
 * AIRevolution SPA. Calls /api/airevolution/* (see airevolution_routes.py).
 */

const API = "/api/airevolution";

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
  const r = await fetch(API + path, {
    headers: { Accept: "application/json", ...(opts.headers || {}) },
    ...opts,
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
  const imgList = el("imgList");
  if (docList) {
    docList.innerHTML = docs.length
      ? docs
          .map(
            (d) =>
              `<li class="kb-item"><div><strong>${escapeHtml(d.title)}</strong> <span class="muted">${
                d.chunk_count
              } chunks</span></div><button type="button" class="btn sm danger" data-del-doc="${d.id}">Remove</button></li>`
          )
          .join("")
      : '<li class="muted">No documents yet.</li>';
    docList.querySelectorAll("[data-del-doc]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Remove this document from the knowledge base?")) return;
        await fetchJSON(`/documents/${btn.getAttribute("data-del-doc")}`, { method: "DELETE" });
        loadDocuments().catch(() => {});
        refreshStatus().catch(() => {});
      });
    });
  }
  if (imgList) {
    imgList.innerHTML = imgs.length
      ? imgs
          .map(
            (im) => `
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
        </li>`
          )
          .join("")
      : '<li class="muted">No screenshots yet.</li>';
    imgList.querySelectorAll("[data-save-cap]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-save-cap");
        const input = imgList.querySelector(`input[data-cap="${id}"]`);
        const fd = new FormData();
        fd.set("caption", input?.value || "");
        await fetchJSON(`/images/${id}/caption`, { method: "POST", body: fd });
        setBanner("kbBanner", "Caption saved.", "ok");
        setTimeout(() => setBanner("kbBanner", "", ""), 2000);
      });
    });
    imgList.querySelectorAll("[data-del-img]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Remove this image?")) return;
        await fetchJSON(`/images/${btn.getAttribute("data-del-img")}`, { method: "DELETE" });
        loadDocuments().catch(() => {});
        refreshStatus().catch(() => {});
      });
    });
  }
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
    ? tickets
        .map(
          (t) => `
      <article class="ticket-card" data-tid="${t.id}">
        <div class="ticket-head">
          <span class="pill st-${t.status}">${t.status.replace("_", " ")}</span>
          <span class="muted sm">#${t.id} · ${escapeHtml(t.created_at || "")}</span>
        </div>
        <h4>${escapeHtml(t.subject)}</h4>
        <p class="desc">${escapeHtml(t.description).slice(0, 200)}${t.description.length > 200 ? "…" : ""}</p>
        ${
          t.last_reply
            ? `<details class="ai-out"><summary>Last AI reply</summary><pre class="ai-pre">${escapeHtml(
                t.last_reply
              )}</pre></details>`
            : ""
        }
        <div class="ticket-actions">
          <button type="button" class="btn sm" data-run-ai="${t.id}">Run AI on ticket</button>
        </div>
        ${
          t.audit && t.audit.length
            ? `<details class="audit"><summary>Audit trail (${t.audit.length})</summary><pre class="audit-pre">${escapeHtml(
                JSON.stringify(t.audit, null, 2)
              )}</pre></details>`
            : ""
        }
      </article>`
        )
        .join("")
    : '<p class="muted">No tickets yet. Submit from the <strong>Tickets</strong> form or use the agent with "Log as ticket".</p>';
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
    (p) =>
      `<button type="button" class="qp" data-qp="${encodeURIComponent(p.text)}" title="Insert sample">${escapeHtml(p.label)}</button>`
  ).join("");
  host.querySelectorAll(".qp").forEach((b) => {
    b.addEventListener("click", () => {
      const ta = el("chatInput");
      if (ta) ta.value = decodeURIComponent(b.getAttribute("data-qp") || "");
      ta?.focus();
    });
  });
}

function initChat() {
  const form = el("chatForm");
  if (!form) return;
  buildQuickPrompts();
  const copyBtn = el("copyReply");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const out = el("aiOutput");
      if (!out?.textContent?.trim() || out.textContent === "No response yet.") return;
      try {
        await navigator.clipboard.writeText(out.textContent);
        copyBtn.textContent = "Copied!";
        setTimeout(() => {
          copyBtn.textContent = "Copy reply";
        }, 2000);
      } catch {
        /* ignore */
      }
    });
  }
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const input = el("chatInput");
    const logTicket = el("logTicket");
    const out = el("aiOutput");
    const retrieval = el("retrieval");
    const submitBtn = el("chatSubmit");
    if (!input?.value.trim()) return;
    out.textContent = "Working on your request…";
    if (retrieval) retrieval.innerHTML = "";
    if (copyBtn) {
      copyBtn.hidden = true;
      copyBtn.textContent = "Copy reply";
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Working…";
    }
    try {
      const res = await fetchJSON("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: input.value,
          create_ticket: !!(logTicket && logTicket.checked),
        }),
      });
      out.textContent = res.reply;
      if (copyBtn) copyBtn.hidden = !res.reply?.trim();
      if (res.ticket_id) {
        setBanner("agentBanner", `Logged as ticket #${res.ticket_id} (status: ${res.status})`, "ok");
      } else {
        setBanner("agentBanner", `Status: ${res.status} · Claude: ${res.anthropic_configured ? "yes" : "no"}`, "info");
      }
      if (retrieval && res.retrieval && res.retrieval.length) {
        retrieval.innerHTML =
          "<strong>Top matches from your knowledge base</strong><ul>" +
          res.retrieval
            .map(
              (r) =>
                `<li><em>${escapeHtml(r.title)}</em>. ${escapeHtml(r.preview).slice(0, 200)}${
                  r.preview && r.preview.length > 200 ? "..." : ""
                }</li>`
            )
            .join("") +
          "</ul>";
      } else if (retrieval) {
        retrieval.innerHTML = '<p class="muted">No strong KB matches (add more documentation or use broader keywords).</p>';
      }
      loadTickets().catch(() => {});
      refreshStatus().catch(() => {});
    } catch (e) {
      out.textContent = "Error: " + e.message;
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Get resolution";
      }
    }
  });
}

function initDocUpload() {
  const form = el("docUploadForm");
  if (form) {
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      setBanner("kbBanner", "Uploading…", "info");
      const fd = new FormData(form);
      try {
        await fetchJSON("/documents", { method: "POST", body: fd });
        form.reset();
        setBanner("kbBanner", "Document added to knowledge base.", "ok");
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
      const body = (el("pasteBody") && el("pasteBody").value) || "";
      if (!body.trim()) return;
      const fd = new FormData();
      fd.set("text", body);
      const pt = (el("pasteTitle") && el("pasteTitle").value) || "";
      if (pt.trim()) fd.set("title", pt.trim());
      try {
        await fetchJSON("/documents", { method: "POST", body: fd });
        pasteForm.reset();
        setBanner("kbBanner", "Pasted text added to knowledge base.", "ok");
        loadDocuments().catch(() => {});
        refreshStatus().catch(() => {});
      } catch (e) {
        setBanner("kbBanner", String(e), "err");
      }
    });
  }
  const imgForm = el("imageUploadForm");
  if (imgForm) {
    imgForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      setBanner("kbBanner", "Uploading image…", "info");
      const fd = new FormData(imgForm);
      try {
        await fetchJSON("/images", { method: "POST", body: fd });
        imgForm.reset();
        setBanner("kbBanner", "Image stored. Add a caption so the AI can use it in context.", "ok");
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

document.addEventListener("DOMContentLoaded", init);
