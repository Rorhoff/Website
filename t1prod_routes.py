"""
T1 Production routes — persistent JSON storage, PIN-gated.

Env:
  T1_PROD_PIN: required PIN to access all endpoints (set in .env on server)
  ANTHROPIC_API_KEY: required for live AI
  ANTHROPIC_MODEL: optional, default claude-sonnet-4-6
"""

from __future__ import annotations

import io
import json
import os
import time
import uuid
import httpx
from collections import Counter
from pathlib import Path
from threading import Lock
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from airevolution_routes import (
    _call_claude,
    _tokenize,
    _chunk_text,
    MAX_UPLOAD_BYTES,
    ALLOWED_IMAGE_EXT,
)

router = APIRouter(prefix="/api/t1prod", tags=["t1prod"])

BASE_DIR = Path(__file__).resolve().parent
PROD_STATIC = BASE_DIR / "static" / "t1-prod"
IMAGES_DIR = PROD_STATIC / "uploads" / "images"
DATA_DIR = PROD_STATIC / "data"
DOCS_FILE = DATA_DIR / "docs.json"
IMAGES_FILE = DATA_DIR / "images.json"
TICKETS_FILE = DATA_DIR / "tickets.json"

_lock = Lock()
_docs: list[dict[str, Any]] = []
_images: list[dict[str, Any]] = []
_tickets: list[dict[str, Any]] = []
_id_seq = 0


def _ensure_storage() -> None:
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _load_data() -> None:
    global _docs, _images, _tickets, _id_seq
    if DOCS_FILE.exists():
        try:
            _docs = json.loads(DOCS_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    if IMAGES_FILE.exists():
        try:
            _images = json.loads(IMAGES_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    if TICKETS_FILE.exists():
        try:
            _tickets = json.loads(TICKETS_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    all_ids = [d["id"] for d in _docs] + [im["id"] for im in _images] + [t["id"] for t in _tickets]
    if all_ids:
        _id_seq = max(all_ids)


def _save(file: Path, data: list) -> None:
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def _next_id() -> int:
    global _id_seq
    with _lock:
        _id_seq += 1
        return _id_seq


def _all_chunks() -> list[dict[str, Any]]:
    with _lock:
        return [c for d in _docs for c in (d.get("chunks") or [])]


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
        imgs = list(_images)
    if not imgs:
        return ""
    lines = []
    for im in imgs:
        cap = (im.get("caption") or "").strip()
        lines.append(
            f"- Screenshot ({im.get('filename')}): {cap}"
            if cap
            else f"- Screenshot available: {im.get('url_path')} (add a caption to describe it)."
        )
    return "Reference screenshots in knowledge base:\n" + "\n".join(lines)


def _build_context(user_message: str) -> tuple[str, list[dict[str, Any]]]:
    hits = _retrieve(user_message, top_k=6)
    parts = [f"From «{h['title']}» (excerpt {h.get('part', 1)}):\n{h['text']}\n" for h in hits]
    ctx = "\n---\n".join(parts) if parts else ""
    img_ctx = _image_context()
    if img_ctx:
        ctx = (ctx + "\n\n" + img_ctx) if ctx else img_ctx
    return ctx, hits


def _call_claude_vision(system: str, user_text: str, image_data_urls: list[str]) -> str:
    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not key:
        return ""
    model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
    content: list[dict] = [{"type": "text", "text": user_text}]
    for data_url in image_data_urls:
        try:
            header, _, b64data = data_url.partition(",")
            media_type = header.split(":")[1].split(";")[0] if ":" in header else "image/jpeg"
            if media_type not in ("image/jpeg", "image/png", "image/gif", "image/webp"):
                media_type = "image/jpeg"
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": b64data},
            })
        except Exception:
            continue
    payload = {
        "model": model,
        "max_tokens": 4096,
        "system": system,
        "messages": [{"role": "user", "content": content}],
    }
    headers = {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    last_err = ""
    for attempt in range(3):
        try:
            r = httpx.post(
                "https://api.anthropic.com/v1/messages",
                headers=headers,
                json=payload,
                timeout=120.0,
            )
            if r.status_code == 529:
                wait = 4 * (attempt + 1)
                time.sleep(wait)
                last_err = f"API overloaded (529), retried {attempt + 1}x"
                continue
            r.raise_for_status()
            data = r.json()
            out: list[str] = []
            for block in data.get("content", []):
                if block.get("type") == "text":
                    out.append(block.get("text", ""))
            return "\n".join(out).strip()
        except httpx.HTTPStatusError as e:
            body = ""
            try:
                detail = e.response.json()
                body = detail.get("error", {}).get("message", "") or str(detail)
            except Exception:
                body = e.response.text[:300]
            return f"(Claude request failed {e.response.status_code}: {body or str(e)})"
        except httpx.HTTPError as e:
            return f"(Claude request failed: {e})"
        except Exception as e:  # noqa: BLE001
            return f"(Claude error: {e})"
    return f"(Claude unavailable — {last_err}. Please try again in a moment.)"


def _match_kb_images(query: str, top_k: int = 4) -> list[dict[str, Any]]:
    q_toks = set(_tokenize(query))
    if not q_toks:
        return []
    scored: list[tuple[int, dict[str, Any]]] = []
    with _lock:
        imgs = list(_images)
    for im in imgs:
        cap = (im.get("caption") or "").strip()
        if not cap:
            continue
        cap_toks = set(_tokenize(cap))
        overlap = len(q_toks & cap_toks)
        if overlap > 0:
            scored.append((overlap, im))
    scored.sort(key=lambda x: -x[0])
    return [im for _, im in scored[:top_k]]


def _pin_check(request: Request) -> None:
    pin = os.getenv("T1_PROD_PIN", "").strip()
    if pin and request.headers.get("X-T1-Pin", "") != pin:
        raise HTTPException(401, "Invalid PIN")


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=32_000)
    images: list[str] = Field(default_factory=list)
    ticket_id: int | None = None
    create_ticket: bool = False


class TicketCreate(BaseModel):
    subject: str = Field(min_length=1, max_length=500)
    description: str = Field(min_length=1, max_length=16_000)
    requester_email: str | None = Field(default=None, max_length=200)


@router.get("/status", dependencies=[Depends(_pin_check)])
def status() -> dict[str, Any]:
    _ensure_storage()
    with _lock:
        return {
            "anthropic_configured": bool(os.getenv("ANTHROPIC_API_KEY", "").strip()),
            "documents": len(_docs),
            "images": len(_images),
            "tickets": len(_tickets),
        }


@router.get("/documents", dependencies=[Depends(_pin_check)])
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


@router.post("/documents", dependencies=[Depends(_pin_check)])
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
        if file.filename.lower().endswith(".pdf"):
            try:
                from pypdf import PdfReader
            except ImportError as e:
                raise HTTPException(501, "PDF support requires pypdf") from e
            reader = PdfReader(io.BytesIO(body))
            for page in reader.pages:
                raw_text += (page.extract_text() or "") + "\n"
        else:
            raw_text = body.decode("utf-8", errors="replace")
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
        snapshot = list(_docs)
    _save(DOCS_FILE, snapshot)
    return {"ok": True, "id": doc_id, "title": doc_title, "chunk_count": len(chunks)}


@router.delete("/documents/{doc_id}", dependencies=[Depends(_pin_check)])
def delete_document(doc_id: int) -> dict[str, bool]:
    global _docs
    with _lock:
        before = len(_docs)
        _docs = [d for d in _docs if d["id"] != doc_id]
        snapshot = list(_docs)
    _save(DOCS_FILE, snapshot)
    return {"ok": len(snapshot) < before}


@router.get("/images", dependencies=[Depends(_pin_check)])
def list_images() -> list[dict[str, Any]]:
    with _lock:
        return [dict(x) for x in _images]


@router.post("/images", dependencies=[Depends(_pin_check)])
async def add_image(file: UploadFile = File(...), caption: str = Form(default="")):
    _ensure_storage()
    if not file.filename:
        raise HTTPException(400, "Missing filename")
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_IMAGE_EXT:
        raise HTTPException(400, f"Allowed: {', '.join(sorted(ALLOWED_IMAGE_EXT))}")
    body = await file.read()
    if len(body) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File too large")
    safe_name = f"{uuid.uuid4().hex[:12]}{ext}"
    (IMAGES_DIR / safe_name).write_bytes(body)
    iid = _next_id()
    rec = {
        "id": iid,
        "filename": file.filename,
        "stored": safe_name,
        "url_path": f"/t1-prod/uploads/images/{safe_name}",
        "caption": (caption or "").strip(),
        "bytes": len(body),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z",
    }
    with _lock:
        _images.append(rec)
        snapshot = list(_images)
    _save(IMAGES_FILE, snapshot)
    return {"ok": True, **rec}


@router.post("/images/{image_id}/caption", dependencies=[Depends(_pin_check)])
def update_image_caption(image_id: int, caption: str = Form(default="")) -> dict[str, Any]:
    with _lock:
        for im in _images:
            if im["id"] == image_id:
                im["caption"] = (caption or "").strip()
                snapshot = list(_images)
                break
        else:
            raise HTTPException(404, "Image not found")
    _save(IMAGES_FILE, snapshot)
    return {"ok": True, "id": image_id, "caption": im["caption"]}


@router.delete("/images/{image_id}", dependencies=[Depends(_pin_check)])
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
                snapshot = list(_images)
                break
        else:
            return {"ok": False}
    _save(IMAGES_FILE, snapshot)
    return {"ok": True}


@router.post("/chat", dependencies=[Depends(_pin_check)])
def chat(body: ChatIn) -> dict[str, Any]:
    _ensure_storage()
    ctx, hits = _build_context(body.message)
    has_kb = bool(ctx)

    system = (
        "You are the T1 AI Support Agent for AIRevolution (t1airevolution.com), an expert software "
        "support assistant. You help support staff move from classic Tier 1 to AI Tier 2 style work: "
        "triage with the knowledge base first, then apply human judgment. "
        "Answer using ONLY the provided knowledge context when it applies. If the context is empty "
        "or insufficient, say so clearly, give safe general product-adjacent guidance, and end with "
        "the line: STATUS: NEEDS_REVIEW. "
        "If you can provide a complete resolution, end with: STATUS: RESOLVED. "
        "If the issue is beyond Tier 1 or needs internal escalation, use: STATUS: ESCALATE. "
        "Be concise, use numbered steps for fixes, name UI areas and settings panels when relevant, "
        "and keep a professional, helpful tone."
    )
    user_block = (
        f"User inquiry:\n{body.message}\n\n"
        f"Retrieved Software knowledge (may be empty):\n"
        f"{ctx or '(no documents matched; inform user and use STATUS: NEEDS_REVIEW unless trivial).'}"
    )

    _api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if _api_key:
        reply = _call_claude_vision(system, user_block, body.images) if body.images else _call_claude(system, user_block)
    else:
        reply = ""
    if not reply:
        reply = (
            f"*(ANTHROPIC_API_KEY is not set. Showing retrieved context only.)*\n\n**Matched knowledge:**\n{ctx}\n\n"
            "**Next steps:** Summarize the closest matching procedure above, or add more documentation and set `ANTHROPIC_API_KEY`."
            if has_kb
            else "*(No knowledge base content matched and no API key configured.)*\n\nAdd PDFs or pasted text under **Knowledge Base**."
        )

    u = reply.upper()
    if "STATUS: RESOLVED" in u or "STATUS:RESOLVED" in u:
        status_line = "ai_resolved"
    elif "STATUS: ESCALATE" in u or "STATUS:ESCALATE" in u:
        status_line = "escalated"
    else:
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
            _tickets.append({
                "id": new_ticket_id,
                "subject": (body.message[:120] + "…") if len(body.message) > 120 else body.message,
                "description": body.message,
                "status": status_line,
                "requester_email": None,
                "created_at": audit_entry["at"],
                "audit": [audit_entry],
                "last_reply": reply,
            })
        snapshot = list(_tickets)
    _save(TICKETS_FILE, snapshot)

    kb_imgs = _match_kb_images(body.message)
    return {
        "reply": reply,
        "retrieval": [{"title": h["title"], "part": h.get("part"), "preview": h["text"][:220]} for h in hits],
        "kb_images": [{"url_path": im["url_path"], "caption": im.get("caption", "")} for im in kb_imgs],
        "status": status_line,
        "anthropic_configured": bool(os.getenv("ANTHROPIC_API_KEY", "").strip()),
        "ticket_id": body.ticket_id or new_ticket_id,
    }


@router.get("/tickets", dependencies=[Depends(_pin_check)])
def list_tickets() -> list[dict[str, Any]]:
    with _lock:
        return sorted([dict(t) for t in _tickets], key=lambda x: -x["id"])


@router.post("/tickets", dependencies=[Depends(_pin_check)])
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
        snapshot = list(_tickets)
    _save(TICKETS_FILE, snapshot)
    return rec


@router.post("/tickets/{ticket_id}/ai-resolve", dependencies=[Depends(_pin_check)])
def ticket_ai_resolve(ticket_id: int) -> dict[str, Any]:
    with _lock:
        desc = next((t["description"] for t in _tickets if t["id"] == ticket_id), None)
    if not desc:
        raise HTTPException(404, "Ticket not found")
    return chat(ChatIn(message=desc, ticket_id=ticket_id))


@router.post("/tickets/{ticket_id}/set-status", dependencies=[Depends(_pin_check)])
def set_ticket_status(ticket_id: int, new_status: str = Form(...)) -> dict[str, Any]:
    allowed = {"open", "ai_resolved", "in_review", "escalated"}
    if new_status not in allowed:
        raise HTTPException(400, f"status must be one of: {', '.join(sorted(allowed))}")
    with _lock:
        for t in _tickets:
            if t["id"] == ticket_id:
                t["status"] = new_status
                t.setdefault("audit", []).append({
                    "at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z",
                    "action": f"status_set_to_{new_status}",
                })
                snapshot = list(_tickets)
                break
        else:
            raise HTTPException(404, "Ticket not found")
    _save(TICKETS_FILE, snapshot)
    return {"ok": True, "id": ticket_id, "status": new_status}


_load_data()
