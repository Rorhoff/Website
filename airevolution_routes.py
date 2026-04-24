"""
AIRevolution: Software Tier 1 support — knowledge uploads, RAG, Claude chat, ticket tracking.

Env:
  ANTHROPIC_API_KEY — required for live AI; without it, /chat returns a draft using retrieved context only.
  ANTHROPIC_MODEL — optional, default claude-3-5-sonnet-20241022
"""

from __future__ import annotations

import io
import os
import re
import time
import uuid
from collections import Counter
from pathlib import Path
from threading import Lock
from typing import Any

import httpx
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

log_tag = "airevolution"

router = APIRouter(prefix="/api/airevolution", tags=["airevolution"])

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "static" / "airevolution" / "uploads"
IMAGES_DIR = UPLOAD_DIR / "images"
DOCS_DIR = UPLOAD_DIR / "documents"

_lock = Lock()
_docs: list[dict[str, Any]] = []
_images: list[dict[str, Any]] = []
_tickets: list[dict[str, Any]] = []
_id_seq = 0

CHUNK_SIZE = 650
CHUNK_OVERLAP = 80
MAX_UPLOAD_BYTES = 8 * 1024 * 1024  # 8 MiB
ALLOWED_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp"}


def _ensure_storage() -> None:
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    DOCS_DIR.mkdir(parents=True, exist_ok=True)


def _next_id() -> int:
    global _id_seq
    with _lock:
        _id_seq += 1
        return _id_seq


def _tokenize(text: str) -> list[str]:
    return [t.lower() for t in re.findall(r"[A-Za-z0-9_]{2,}", text)]


def _chunk_text(text: str, source_id: int, title: str) -> list[dict[str, Any]]:
    text = text.strip()
    if not text:
        return []
    chunks: list[dict[str, Any]] = []
    i = 0
    n = len(text)
    part = 0
    while i < n:
        end = min(i + CHUNK_SIZE, n)
        piece = text[i:end].strip()
        if piece:
            part += 1
            chunks.append(
                {
                    "text": piece,
                    "source_id": source_id,
                    "title": title,
                    "part": part,
                }
            )
        if end >= n:
            break
        i = end - CHUNK_OVERLAP
    return chunks


def _all_chunks() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    with _lock:
        for d in _docs:
            for c in d.get("chunks") or []:
                out.append(c)
    return out


def _retrieve(query: str, top_k: int = 6) -> list[dict[str, Any]]:
    q_toks = _tokenize(query)
    if not q_toks:
        return []
    q_set = set(q_toks)
    q_counts = Counter(q_toks)
    scored: list[tuple[float, dict[str, Any]]] = []
    for ch in _all_chunks():
        toks = _tokenize(ch["text"])
        if not toks:
            continue
        doc_counts = Counter(toks)
        # Cosine-like overlap score
        dot = sum(q_counts[w] * doc_counts.get(w, 0) for w in q_set)
        if dot <= 0:
            continue
        norm_q = sum(q_counts[w] ** 2 for w in q_counts) ** 0.5
        norm_d = sum(doc_counts[w] ** 2 for w in doc_counts) ** 0.5
        score = dot / (norm_q * norm_d) if norm_q and norm_d else 0.0
        scored.append((score, ch))
    scored.sort(key=lambda x: -x[0])
    return [c for _, c in scored[:top_k]]


def _image_context() -> str:
    with _lock:
        if not _images:
            return ""
    lines: list[str] = []
    for im in _images:
        u = im.get("url_path", "")
        cap = (im.get("caption") or "").strip()
        if cap:
            lines.append(f"- Screenshot ({im.get('filename')}): {cap}")
        else:
            lines.append(f"- Screenshot available: {u} (add a caption in the UI to describe what it shows).")
    return "Reference screenshots in knowledge base:\n" + "\n".join(lines)


def _build_context_for_query(user_message: str) -> tuple[str, list[dict[str, Any]]]:
    hits = _retrieve(user_message, top_k=6)
    parts: list[str] = []
    for h in hits:
        parts.append(f"From «{h['title']}» (excerpt {h.get('part', 1)}):\n{h['text']}\n")
    ctx = "\n---\n".join(parts) if parts else ""
    img_ctx = _image_context()
    if img_ctx:
        ctx = (ctx + "\n\n" + img_ctx) if ctx else img_ctx
    return ctx, hits


def _call_claude(system: str, user_text: str) -> str:
    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not key:
        return ""
    model = os.getenv("ANTHROPIC_MODEL", "claude-3-5-sonnet-20241022")
    try:
        r = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": 4096,
                "system": system,
                "messages": [{"role": "user", "content": user_text}],
            },
            timeout=120.0,
        )
        r.raise_for_status()
        data = r.json()
        out: list[str] = []
        for block in data.get("content", []):
            if block.get("type") == "text":
                out.append(block.get("text", ""))
        return "\n".join(out).strip()
    except httpx.HTTPError as e:
        return f"(Claude request failed: {e})"
    except Exception as e:  # noqa: BLE001
        return f"(Claude error: {e})"


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=32_000)
    ticket_id: int | None = None
    # When true, creates or updates a ticket record for the portal audit trail.
    create_ticket: bool = False


class TicketCreate(BaseModel):
    subject: str = Field(min_length=1, max_length=500)
    description: str = Field(min_length=1, max_length=16_000)
    requester_email: str | None = Field(default=None, max_length=200)


@router.get("/status")
def status() -> dict[str, Any]:
    _ensure_storage()
    with _lock:
        nd = len(_docs)
        ni = len(_images)
        nt = len(_tickets)
    return {
        "anthropic_configured": bool(os.getenv("ANTHROPIC_API_KEY", "").strip()),
        "documents": nd,
        "images": ni,
        "tickets": nt,
    }


@router.get("/documents")
def list_documents() -> list[dict[str, Any]]:
    with _lock:
        return [
            {
                "id": d["id"],
                "title": d["title"],
                "bytes": d["bytes"],
                "filename": d.get("filename"),
                "created_at": d["created_at"],
                "chunk_count": len(d.get("chunks") or []),
            }
            for d in _docs
        ]


@router.post("/documents")
async def add_document(
    file: UploadFile | None = File(default=None),
    title: str | None = Form(default=None),
    text: str | None = Form(default=None),
):
    _ensure_storage()
    raw_text = ""
    fname = None
    if file and file.filename:
        body = await file.read()
        if len(body) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "File too large")
        fname = file.filename
        low = file.filename.lower()
        if low.endswith(".pdf"):
            try:
                from pypdf import PdfReader
            except ImportError as e:
                raise HTTPException(501, "PDF support requires pypdf; pip install pypdf") from e
            reader = PdfReader(io.BytesIO(body))
            for page in reader.pages:
                raw_text += (page.extract_text() or "") + "\n"
        else:
            try:
                raw_text = body.decode("utf-8", errors="replace")
            except Exception:  # noqa: BLE001
                raw_text = body.decode("latin-1", errors="replace")
    elif text:
        raw_text = text
        fname = "pasted.txt"
    else:
        raise HTTPException(400, "Send multipart file= or form field text=")

    raw_text = raw_text.strip()
    if not raw_text:
        raise HTTPException(400, "No text could be read from the upload")

    doc_id = _next_id()
    doc_title = (title or "").strip() or (fname or f"Document {doc_id}")
    chunks = _chunk_text(raw_text, doc_id, doc_title)
    entry = {
        "id": doc_id,
        "title": doc_title,
        "filename": fname,
        "bytes": len(raw_text.encode("utf-8", errors="replace")),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z",
        "full_text": raw_text,
        "chunks": chunks,
    }
    with _lock:
        _docs.append(entry)
    return {"ok": True, "id": doc_id, "title": doc_title, "chunk_count": len(chunks)}


@router.delete("/documents/{doc_id}")
def delete_document(doc_id: int) -> dict[str, bool]:
    with _lock:
        global _docs
        before = len(_docs)
        _docs = [d for d in _docs if d["id"] != doc_id]
    return {"ok": len(_docs) < before}


@router.get("/images")
def list_images() -> list[dict[str, Any]]:
    with _lock:
        return [dict(x) for x in _images]


@router.post("/images")
async def add_image(
    file: UploadFile = File(...),
    caption: str = Form(default=""),
):
    _ensure_storage()
    if not file.filename:
        raise HTTPException(400, "Missing filename")
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_IMAGE_EXT:
        raise HTTPException(400, f"Allowed image types: {', '.join(sorted(ALLOWED_IMAGE_EXT))}")
    body = await file.read()
    if len(body) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File too large")
    uid = uuid.uuid4().hex[:12]
    safe_name = f"{uid}{ext}"
    path = IMAGES_DIR / safe_name
    path.write_bytes(body)
    iid = _next_id()
    url_path = f"/airevolution/uploads/images/{safe_name}"
    rec = {
        "id": iid,
        "filename": file.filename,
        "stored": safe_name,
        "url_path": url_path,
        "caption": (caption or "").strip(),
        "bytes": len(body),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z",
    }
    with _lock:
        _images.append(rec)
    return {"ok": True, **rec}


@router.post("/images/{image_id}/caption")
def update_image_caption(
    image_id: int,
    caption: str = Form(default=""),
) -> dict[str, Any]:
    with _lock:
        for im in _images:
            if im["id"] == image_id:
                im["caption"] = (caption or "").strip()
                return {"ok": True, "id": image_id, "caption": im["caption"]}
    raise HTTPException(404, "Image not found")


@router.delete("/images/{image_id}")
def delete_image(image_id: int) -> dict[str, bool]:
    with _lock:
        for i, im in enumerate(_images):
            if im["id"] == image_id:
                p = IMAGES_DIR / im["stored"]
                try:
                    if p.is_file():
                        p.unlink()
                except OSError:
                    pass
                _images.pop(i)
                return {"ok": True}
    return {"ok": False}


@router.post("/chat")
def chat(body: ChatIn) -> dict[str, Any]:
    _ensure_storage()
    ctx, hits = _build_context_for_query(body.message)
    has_kb = bool(ctx)

    system = (
        "You are AIRevolution, an expert Software (OpenText) Tier 1 support assistant. "
        "Answer using ONLY the provided knowledge context when it applies. If the context is empty "
        "or insufficient, say so clearly, give safe general product-adjacent guidance, and end with "
        "the line: STATUS: NEEDS_REVIEW. "
        "If you can provide a complete resolution, end with: STATUS: RESOLVED. "
        "If the issue is beyond Tier 1 or needs internal escalation, use: STATUS: ESCALATE. "
        "Be concise, use numbered steps for fixes, and name settings panels when relevant."
    )

    user_block = (
        f"User inquiry:\n{body.message}\n\n"
        f"Retrieved Software knowledge (may be empty):\n{ctx or '(no documents matched — inform user and use STATUS: NEEDS_REVIEW unless trivial).'}"
    )

    reply = _call_claude(system, user_block) if os.getenv("ANTHROPIC_API_KEY", "").strip() else ""

    if not reply:
        if has_kb:
            reply = (
                "*(ANTHROPIC_API_KEY is not set — showing retrieved context only.)*\n\n"
                f"**Matched knowledge:**\n{ctx}\n\n"
                "**Next steps for you (draft):** Summarize the closest matching procedure above, "
                "or add more documentation in the Knowledge Base and set `ANTHROPIC_API_KEY` for full AI answers."
            )
        else:
            reply = (
                "*(No knowledge base content matched and no API key configured.)*\n\n"
                "Add PDFs, guides, or pasted text under **Knowledge Base**, and set the "
                "`ANTHROPIC_API_KEY` environment variable to enable Claude-powered answers."
            )

    status_line = "in_review"
    u = reply.upper()
    if "STATUS: RESOLVED" in u or "STATUS:RESOLVED" in u:
        status_line = "ai_resolved"
    elif "STATUS: ESCALATE" in u or "STATUS:ESCALATE" in u:
        status_line = "escalated"
    elif "STATUS: NEEDS_REVIEW" in u or "STATUS:NEEDS_REVIEW" in u or not has_kb:
        status_line = "in_review"

    audit_entry = {
        "at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z",
        "inquiry": body.message,
        "retrieval_hits": len(hits),
        "ai_status": status_line,
    }

    new_ticket_id: int | None = None
    with _lock:
        if body.ticket_id is not None:
            for t in _tickets:
                if t["id"] == body.ticket_id:
                    t["status"] = status_line
                    t.setdefault("audit", []).append(audit_entry)
                    t["last_reply"] = reply
                    break
        elif body.create_ticket:
            new_ticket_id = _next_id()
            _tickets.append(
                {
                    "id": new_ticket_id,
                    "subject": (body.message[:120] + "…") if len(body.message) > 120 else body.message,
                    "description": body.message,
                    "status": status_line,
                    "requester_email": None,
                    "created_at": audit_entry["at"],
                    "audit": [audit_entry],
                    "last_reply": reply,
                }
            )

    return {
        "reply": reply,
        "retrieval": [{"title": h["title"], "part": h.get("part"), "preview": h["text"][:220]} for h in hits],
        "status": status_line,
        "anthropic_configured": bool(os.getenv("ANTHROPIC_API_KEY", "").strip()),
        "ticket_id": body.ticket_id or new_ticket_id,
    }


@router.get("/tickets")
def list_tickets() -> list[dict[str, Any]]:
    with _lock:
        return sorted([dict(t) for t in _tickets], key=lambda x: -x["id"])


@router.post("/tickets")
def create_ticket(body: TicketCreate) -> dict[str, Any]:
    tid = _next_id()
    rec = {
        "id": tid,
        "subject": body.subject.strip(),
        "description": body.description.strip(),
        "status": "open",
        "requester_email": (body.requester_email or "").strip() or None,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z",
        "audit": [],
        "last_reply": None,
    }
    with _lock:
        _tickets.append(rec)
    return rec


@router.post("/tickets/{ticket_id}/ai-resolve")
def ticket_ai_resolve(ticket_id: int) -> dict[str, Any]:
    with _lock:
        desc = None
        for t in _tickets:
            if t["id"] == ticket_id:
                desc = t["description"]
                break
    if not desc:
        raise HTTPException(404, "Ticket not found")
    return chat(ChatIn(message=desc, ticket_id=ticket_id))


@router.post("/tickets/{ticket_id}/set-status")
def set_ticket_status(
    ticket_id: int,
    new_status: str = Form(...),
) -> dict[str, Any]:
    allowed = {"open", "ai_resolved", "in_review", "escalated"}
    if new_status not in allowed:
        raise HTTPException(400, f"status must be one of: {', '.join(sorted(allowed))}")
    with _lock:
        for t in _tickets:
            if t["id"] == ticket_id:
                t["status"] = new_status
                t.setdefault("audit", []).append(
                    {
                        "at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z",
                        "action": f"status_set_to_{new_status}",
                    }
                )
                return {"ok": True, "id": ticket_id, "status": new_status}
    raise HTTPException(404, "Ticket not found")
