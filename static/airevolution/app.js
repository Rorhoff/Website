/**
 * AIRevolution SPA. Calls /api/airevolution/* (see airevolution_routes.py).
 */

const API = "/api/airevolution";
const MAX_CHAT_IMAGES = 4;
const MAX_PASTE_IMAGE_DIM = 1600;
const PASTE_JPEG_QUALITY = 0.82;

const QUICK_PROMPTS = [
  { label: "Cannot log in", text: "The user says they cannot log in. They tried resetting password but did not get an email. What should we check first?" },
  { label: "Import failed", text: "Import job failed with a generic error. The customer attached a small CSV. What are the first troubleshooting steps?" },
  { label: "Page error", text: "The application shows a white screen or 500 error on one page only; other pages work. How should we triage?" },
  { label: "Slow performance", text: "The customer reports the system is very slow at peak times. No error message. What should we ask and suggest?" },
  { label: "SQL query", text: "Write a SQL query using the data dictionary to list all active customers created in the last 30 days, including customer id, name, and email." },
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
      sub.textContent = `${s.documents} docs (${s.schema_documents ?? 0} schema) · ${s.images} screenshots · ${s.tickets} tickets`;
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
        `<li class="kb-item"><div><strong>${escapeHtml(d.title)}</strong> <span class="pill ${d.kind === "schema" ? "ok" : ""}" style="font-size:0.75rem">${d.kind === "schema" ? "schema" : "support"}</span> <span class="muted">${d.chunk_count} chunks</span></div><button type="button" class="btn sm danger" data-del-doc="${d.id}">Remove</button></li>`
      ).join("")
    : '<li class="muted">No documents yet.</li>';

  if (imgs.length) {
    html += imgs.map((im) => `
      <li class="kb-item img-row" data-id="${im.id}">
        <a href="${im.url_path}" target="_blank" rel="noopener"><img src="${im.url_path}" alt="" class="thumb" loading="lazy" decoding="async" /></a>
        <div class="grow">
          <div class="muted sm">${escapeHtml(im.filename)}</div>
          <input type="text" class="caption-in" data-cap="${im.id}" placeholder="What this screenshot shows (settings, error, etc.)" value="${escapeAttr(im.caption || "")}" />
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
    : '<p class="muted">No tickets yet. Submit from the "Tickets" form or use the agent with "Log as ticket".</p>';
  list.querySelectorAll("[data-run-ai]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = +btn.getAttribute("data-run-ai");
      setBanner("ticketBanner", "Running AI.", "info");
      const aiImages = el("aiImages");
      if (aiImages) {
        aiImages.hidden = true;
        aiImages.innerHTML = "";
      }
      try {
        const res = await fetchJSON(`/tickets/${id}/ai-resolve`, { method: "POST" });
        setBanner("ticketBanner", "AI response recorded.", "ok");
        const out = el("aiOutput");
        const images = Array.isArray(res.images) ? res.images : [];
        if (out) {
          const { html, inlinedIds } = renderReplyWithImages(res.reply || "", images);
          out.innerHTML = html || '<span class="muted">No response.</span>';
          renderAIImageGallery(images.filter((im) => !inlinedIds.has(im.id)));
        }
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
      const input = el("chatInput");
      if (!input) return;
      const text = decodeURIComponent(b.getAttribute("data-qp") || "");
      input.textContent = text;
      input.focus();
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

function countChatImages(container) {
  return container ? container.querySelectorAll("img").length : 0;
}

function clearChatInput(input) {
  if (!input) return;
  input.replaceChildren();
}

function insertNodeInChatInput(chatInput, node) {
  const sel = window.getSelection();
  if (sel && sel.rangeCount && chatInput.contains(sel.anchorNode)) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    chatInput.appendChild(node);
  }
}

/** Downscale pasted screenshots so contenteditable + API payloads do not retain multi-MB base64. */
function compressImageToDataUrl(file, maxDim = MAX_PASTE_IMAGE_DIM) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth || 0;
      let h = img.naturalHeight || 0;
      if (!w || !h) {
        reject(new Error("Invalid image dimensions"));
        return;
      }
      const scale = Math.min(1, maxDim / Math.max(w, h));
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", PASTE_JPEG_QUALITY));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load pasted image"));
    };
    img.src = url;
  });
}

async function addCompressedImageToChat(chatInput, file) {
  if (!chatInput || !file) return false;
  if (countChatImages(chatInput) >= MAX_CHAT_IMAGES) {
    setBanner("agentBanner", `Maximum ${MAX_CHAT_IMAGES} screenshots per inquiry.`, "info");
    return false;
  }
  try {
    const dataUrl = await compressImageToDataUrl(file);
    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = "Pasted screenshot";
    insertNodeInChatInput(chatInput, img);
    return true;
  } catch {
    setBanner("agentBanner", "Could not process pasted image.", "err");
    return false;
  }
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
      } catch {
        /* inaccessible blob */
      }
    } else if (src) {
      try {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth || 400;
        c.height = img.naturalHeight || 300;
        c.getContext("2d").drawImage(img, 0, 0);
        results.push(c.toDataURL("image/png"));
      } catch {
        /* CORS-blocked URL */
      }
    }
  }
  return results.slice(0, 4);
}

function getChatInquiryText(input) {
  if (!input) return "";
  return (input.innerText || input.textContent || "").trim();
}

function initChatPasteImages(chatInput) {
  if (!chatInput) return;
  chatInput.addEventListener("paste", async (ev) => {
    const cd = ev.clipboardData;
    if (!cd) return;

    const items = Array.from(cd.items || []);
    const imgItems = items.filter((i) => i.kind === "file" && (i.type || "").startsWith("image/"));
    if (imgItems.length) {
      ev.preventDefault();
      for (const imgItem of imgItems) {
        if (countChatImages(chatInput) >= MAX_CHAT_IMAGES) break;
        const file = imgItem.getAsFile();
        if (file) await addCompressedImageToChat(chatInput, file);
      }
      return;
    }

    const html = cd.getData("text/html");
    if (html && /<img\b/i.test(html)) {
      ev.preventDefault();
      const temp = document.createElement("div");
      temp.innerHTML = html;
      for (const srcImg of Array.from(temp.querySelectorAll("img"))) {
        if (countChatImages(chatInput) >= MAX_CHAT_IMAGES) break;
        const src = srcImg.getAttribute("src") || "";
        if (!src) continue;
        if (src.startsWith("data:image/")) {
          const img = document.createElement("img");
          img.src = src;
          img.alt = "Pasted screenshot";
          insertNodeInChatInput(chatInput, img);
          continue;
        }
        try {
          const blob = await (await fetch(src)).blob();
          await addCompressedImageToChat(chatInput, blob);
        } catch {
          /* skip inaccessible remote image */
        }
      }
      const text = cd.getData("text/plain");
      if (text) document.execCommand("insertText", false, text);
      return;
    }
  });
}

function _findImageByName(images, name) {
  if (!images || !name) return null;
  const norm = String(name).trim().toLowerCase();
  if (!norm) return null;
  return (
    images.find((im) => (im.filename || "").toLowerCase() === norm) ||
    images.find((im) => (im.url_path || "").toLowerCase().endsWith("/" + norm)) ||
    images.find((im) => (im.url_path || "").toLowerCase().includes(norm)) ||
    null
  );
}

function renderReplyWithImages(reply, images) {
  const inlinedIds = new Set();
  if (!reply) return { html: "", inlinedIds };
  const parts = [];
  const regex = /\[\[\s*image\s*:\s*([^\]\n]+?)\s*\]\]/gi;
  let lastIndex = 0;
  let m;
  while ((m = regex.exec(reply)) !== null) {
    if (m.index > lastIndex) {
      parts.push(escapeHtml(reply.slice(lastIndex, m.index)));
    }
    const name = (m[1] || "").trim();
    const img = _findImageByName(images, name);
    if (img) {
      inlinedIds.add(img.id);
      const cap = img.caption || img.filename || "";
      parts.push(
        `<img class="inline-img" src="${escapeAttr(img.url_path)}" alt="${escapeAttr(cap)}" title="${escapeAttr(cap)}" />`
      );
    } else {
      parts.push(`<span class="inline-img-missing">[image not found: ${escapeHtml(name)}]</span>`);
    }
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < reply.length) {
    parts.push(escapeHtml(reply.slice(lastIndex)));
  }
  return { html: parts.join(""), inlinedIds };
}

function renderAIImageGallery(images) {
  const host = el("aiImages");
  if (!host) return;
  if (!images || !images.length) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }
  host.hidden = false;
  host.innerHTML = images
    .map((im) => {
      const cap = im.caption || im.filename || "";
      return `<figure>
        <a href="${escapeAttr(im.url_path)}" target="_blank" rel="noopener">
          <img src="${escapeAttr(im.url_path)}" alt="${escapeAttr(cap)}" loading="lazy" decoding="async" />
        </a>
        ${cap ? `<figcaption>${escapeHtml(cap)}</figcaption>` : ""}
      </figure>`;
    })
    .join("");
}

function initChat() {
  const form = el("chatForm");
  if (!form) return;
  buildQuickPrompts();
  const chatInput = el("chatInput");
  initChatPasteImages(chatInput);
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
    const aiImages = el("aiImages");
    const submitBtn = el("chatSubmit");
    const message = getChatInquiryText(input);
    const images = input ? await extractImages(input) : [];
    if (!message && !images.length) return;
    // Release pasted screenshot bytes from the DOM once captured for the API request.
    clearChatInput(input);
    out.textContent = "Working on your request.";
    if (retrieval) retrieval.innerHTML = "";
    if (aiImages) {
      aiImages.hidden = true;
      aiImages.innerHTML = "";
    }
    if (copyBtn) {
      copyBtn.hidden = true;
      copyBtn.textContent = "Copy reply";
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Working.";
    }
    try {
      const res = await fetchJSON("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message || "(screenshot inquiry. See attached image(s).)",
          images,
          create_ticket: !!(logTicket && logTicket.checked),
        }),
      });
      const images = Array.isArray(res.images) ? res.images : [];
      const { html: replyHtml, inlinedIds } = renderReplyWithImages(res.reply || "", images);
      out.innerHTML = replyHtml || '<span class="muted">No response.</span>';
      renderAIImageGallery(images.filter((im) => !inlinedIds.has(im.id)));
      if (copyBtn) copyBtn.hidden = !res.reply?.trim();
      const broadTag = res.broad ? " · mode: enumerate-all" : "";
      const sqlTag = res.sql
        ? (res.schema_docs?.length
          ? ` · schema: ${res.schema_docs.join(", ")}`
          : " · no schema doc. Re-upload as type Data dictionary / schema")
        : "";
      const imgTag = res.inquiry_images ? ` · ${res.inquiry_images} pasted screenshot${res.inquiry_images > 1 ? "s" : ""} analyzed` : "";
      if (res.ticket_id) {
        setBanner("agentBanner", `Logged as ticket #${res.ticket_id} (status: ${res.status})${broadTag}${sqlTag}${imgTag}`, "ok");
      } else {
        setBanner("agentBanner", `Status: ${res.status} · Claude: ${res.anthropic_configured ? "yes" : "no"}${broadTag}${sqlTag}${imgTag}`, res.sql && !res.schema_docs?.length ? "err" : "info");
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

async function _uploadImgIfPresent(imgFile, captionFallback) {
  if (!imgFile) return;
  const ifd = new FormData();
  ifd.set("file", imgFile);
  ifd.set("caption", captionFallback || imgFile.name);
  await fetchJSON("/images", { method: "POST", body: ifd });
}

const _pastedImages = [];

function _extImageType(mime) {
  switch ((mime || "").toLowerCase()) {
    case "image/png": return ".png";
    case "image/jpeg": return ".jpg";
    case "image/jpg": return ".jpg";
    case "image/gif": return ".gif";
    case "image/webp": return ".webp";
    default: return "";
  }
}

function _normalizePastedFile(file, idx) {
  const ext = _extImageType(file.type);
  if (!ext) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = `pasted-${stamp}-${idx}${ext}`;
  try {
    return new File([file], safeName, { type: file.type });
  } catch {
    return file;
  }
}

function renderPastedImages() {
  const host = el("pastedImagesPreview");
  if (!host) return;
  if (!_pastedImages.length) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }
  host.hidden = false;
  host.innerHTML = _pastedImages
    .map((p, i) => `
      <figure data-idx="${i}">
        <button type="button" class="rm" data-rm="${i}" title="Remove">×</button>
        <img src="${p.dataUrl}" alt="" />
        <figcaption title="${escapeAttr(p.file.name)}">${escapeHtml(p.file.name)}</figcaption>
      </figure>`)
    .join("");
  host.querySelectorAll("[data-rm]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = +btn.getAttribute("data-rm");
      if (i >= 0 && i < _pastedImages.length) {
        _pastedImages.splice(i, 1);
        renderPastedImages();
      }
    });
  });
}

function clearPastedImages() {
  _pastedImages.length = 0;
  renderPastedImages();
}

function initPasteImageCapture() {
  const ta = el("pasteBody");
  if (!ta) return;
  ta.addEventListener("paste", (ev) => {
    const items = ev.clipboardData?.items || [];
    const newFiles = [];
    let hasText = false;
    for (const item of items) {
      if (item.kind === "string" && item.type === "text/plain") hasText = true;
      if (item.kind === "file" && (item.type || "").startsWith("image/")) {
        const f = item.getAsFile();
        if (f) newFiles.push(f);
      }
    }
    if (!newFiles.length) return;
    if (!hasText) ev.preventDefault();
    newFiles.forEach((f, k) => {
      const norm = _normalizePastedFile(f, _pastedImages.length + k);
      if (!norm) return;
      compressImageToDataUrl(norm)
        .then((dataUrl) => {
          _pastedImages.push({ file: norm, dataUrl });
          renderPastedImages();
        })
        .catch(() => {
          setBanner("kbBanner", "Could not process pasted image.", "err");
        });
    });
  });
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
      setBanner("kbBanner", `Uploading ${files.length} file${files.length > 1 ? "s" : ""}.`, "info");
      try {
        await _uploadImgIfPresent(imgFile?.size ? imgFile : null, titleBase);
        for (const file of files) {
          const fd = new FormData();
          fd.set("file", file);
          if (titleBase) fd.set("title", files.length === 1 ? titleBase : `${titleBase}: ${file.name}`);
          const kind = el("docKind")?.value;
          if (kind) fd.set("doc_kind", kind);
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
    initPasteImageCapture();
    pasteForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const bodyText = (el("pasteBody")?.value) || "";
      const filePickerImgs = Array.from(el("pasteImg")?.files || []);
      const pastedImgs = _pastedImages.map((p) => p.file);
      const imageCount = filePickerImgs.length + pastedImgs.length;
      if (!bodyText.trim() && imageCount === 0) {
        setBanner("kbBanner", "Add some text or paste at least one image.", "err");
        return;
      }
      const pt = (el("pasteTitle")?.value || "").trim();
      setBanner("kbBanner", imageCount ? `Adding text + ${imageCount} image${imageCount > 1 ? "s" : ""}.` : "Adding text.", "info");
      try {
        for (const f of [...pastedImgs, ...filePickerImgs]) {
          if (f && f.size) await _uploadImgIfPresent(f, pt);
        }
        if (bodyText.trim()) {
          const fd = new FormData();
          fd.set("text", bodyText);
          if (pt) fd.set("title", pt);
          const kind = el("pasteKind")?.value;
          if (kind) fd.set("doc_kind", kind);
          await fetchJSON("/documents", { method: "POST", body: fd });
        }
        pasteForm.reset();
        clearPastedImages();
        const summary = bodyText.trim()
          ? (imageCount ? `Pasted text + ${imageCount} image${imageCount > 1 ? "s" : ""} added to knowledge base.` : "Pasted text added to knowledge base.")
          : `${imageCount} image${imageCount > 1 ? "s" : ""} added to knowledge base.`;
        setBanner("kbBanner", summary, "ok");
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
      setBanner("ticketBanner", "Submitting.", "info");
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
