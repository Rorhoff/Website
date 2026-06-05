"""
AIRevolution: Software Tier 1 support. Knowledge uploads, RAG, Claude chat, ticket tracking.

Env:
  ANTHROPIC_API_KEY: required for live AI; without it, /chat returns a draft using retrieved context only.
  ANTHROPIC_MODEL: optional, default claude-3-5-sonnet-20241022
"""

from __future__ import annotations

import io
import json
import logging
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

log = logging.getLogger("airevolution")
log_tag = "airevolution"

router = APIRouter(prefix="/api/airevolution", tags=["airevolution"])

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "static" / "airevolution" / "uploads"
IMAGES_DIR = UPLOAD_DIR / "images"
DOCS_DIR = UPLOAD_DIR / "documents"
KB_STORE_PATH = UPLOAD_DIR / "kb_documents.json"

_lock = Lock()
_docs: list[dict[str, Any]] = []
_images: list[dict[str, Any]] = []
_tickets: list[dict[str, Any]] = []
_id_seq = 0
_kb_loaded = False

CHUNK_SIZE = 650
CHUNK_OVERLAP = 80
MAX_UPLOAD_BYTES = 8 * 1024 * 1024  # 8 MiB
ALLOWED_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp"}


def _ensure_storage() -> None:
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    _load_kb_from_disk()


def _persist_kb_to_disk() -> None:
    """Survive service restarts — uploaded dictionaries were previously in-memory only."""
    try:
        with _lock:
            payload = {
                "id_seq": _id_seq,
                "docs": [
                    {
                        "id": d["id"],
                        "title": d["title"],
                        "filename": d.get("filename"),
                        "bytes": d.get("bytes", 0),
                        "created_at": d.get("created_at"),
                        "full_text": d.get("full_text") or "",
                    }
                    for d in _docs
                ],
            }
        KB_STORE_PATH.write_text(
            json.dumps(payload, ensure_ascii=False),
            encoding="utf-8",
        )
    except OSError as exc:
        log.warning("Could not persist knowledge base: %s", exc)


def _load_kb_from_disk() -> None:
    global _docs, _id_seq, _kb_loaded
    if _kb_loaded:
        return
    _kb_loaded = True
    if not KB_STORE_PATH.is_file():
        return
    try:
        payload = json.loads(KB_STORE_PATH.read_text(encoding="utf-8"))
        loaded: list[dict[str, Any]] = []
        for raw in payload.get("docs") or []:
            doc_id = int(raw["id"])
            title = (raw.get("title") or f"Document {doc_id}").strip()
            full_text = (raw.get("full_text") or "").strip()
            if not full_text:
                continue
            loaded.append(
                {
                    "id": doc_id,
                    "title": title,
                    "filename": raw.get("filename"),
                    "bytes": raw.get("bytes") or len(full_text.encode("utf-8", errors="replace")),
                    "created_at": raw.get("created_at")
                    or time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z",
                    "full_text": full_text,
                    "chunks": _chunk_text(full_text, doc_id, title),
                }
            )
        with _lock:
            _docs = loaded
            _id_seq = max(int(payload.get("id_seq") or 0), max((d["id"] for d in loaded), default=0))
        log.info("Loaded %d knowledge-base document(s) from disk", len(loaded))
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        log.warning("Could not load knowledge base from disk: %s", exc)


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


BROAD_QUERY_RE = re.compile(
    r"\b(every|each|all|entire|complete|whole|comprehensive|exhaustive|"
    r"list(?:\s+(?:out|all|every|each|the))?|enumerate|"
    r"in\s+order|step[- ]by[- ]step|walk\s+(?:me\s+)?through|"
    r"for\s+(?:every|each|all)|"
    r"every\s+(?:application|app|product|tool|module|service|item|one)|"
    r"all\s+(?:applications|apps|products|tools|modules|services|items))\b",
    re.IGNORECASE,
)

SQL_QUERY_RE = re.compile(
    r"\b("
    r"sql|query|queries|select|join|left\s+join|where|group\s+by|order\s+by|"
    r"data\s+dictionary|data\s+dict|schema|erd|"
    r"table|tables|column|columns|field|fields|"
    r"usrid|user_id|userid|user\s+id|"
    r"write\s+(?:me\s+)?(?:a\s+)?(?:sql\s+)?query|"
    r"generate\s+(?:me\s+)?(?:a\s+)?(?:sql\s+)?query|"
    r"create\s+(?:me\s+)?(?:a\s+)?(?:sql\s+)?query|"
    r"build\s+(?:me\s+)?(?:a\s+)?(?:sql\s+)?query"
    r")\b",
    re.IGNORECASE,
)

SCHEMA_DOC_LABEL_RE = re.compile(
    r"\b(dictionary|data\s*dict|schema|data\s*model|erd|table\s*list|column\s*list)\b",
    re.IGNORECASE,
)


def _is_broad_query(text: str) -> bool:
    return bool(BROAD_QUERY_RE.search(text or ""))


def _is_sql_query_request(text: str) -> bool:
    return bool(SQL_QUERY_RE.search(text or ""))


def _schema_doc_score(title: str, filename: str | None, full_text: str) -> int:
    """Higher score = more likely a data dictionary / schema document."""
    score = 0
    label = f"{title} {filename or ''}"
    if SCHEMA_DOC_LABEL_RE.search(label):
        score += 25
    sample = (full_text or "")[:80_000].lower()
    if "data dictionary" in sample or "data dict" in sample:
        score += 20
    score += len(
        re.findall(
            r"\b(table|column|field|primary\s+key|foreign\s+key|varchar|integer|"
            r"nvarchar|decimal|schema|datatype|data\s+type|nullable)\b",
            sample,
            re.I,
        )
    )
    score += len(
        re.findall(
            r"\b(usrid|user_id|userid|customer_id|account_id)\b",
            sample,
            re.I,
        )
    ) * 2
    return score


def _doc_looks_like_schema(title: str, filename: str | None, full_text: str) -> bool:
    return _schema_doc_score(title, filename, full_text) >= 6


def _sql_focus_terms(user_message: str) -> set[str]:
    """Anchor large schema excerpts near user/table vocabulary, not arbitrary pages."""
    terms = set(_tokenize(user_message))
    terms.update(
        {
            "user",
            "usr",
            "usrid",
            "user_id",
            "userid",
            "customer",
            "account",
            "table",
            "column",
            "join",
            "primary",
            "foreign",
            "key",
        }
    )
    return terms


def _retrieve(
    query: str,
    top_k: int = 6,
    per_doc_limit: int | None = None,
) -> list[dict[str, Any]]:
    """Score chunks by token overlap with the query.

    When `per_doc_limit` is set, no single source document contributes more than that many
    chunks to the result until the rest of the budget is filled — this keeps a single chatty
    document from crowding out other documents on enumerative queries.
    """
    q_toks = _tokenize(query)
    if not q_toks:
        return []
    q_set = set(q_toks)
    q_counts = Counter(q_toks)
    norm_q = (sum(q_counts[w] ** 2 for w in q_counts) ** 0.5) or 1.0
    scored: list[tuple[float, dict[str, Any]]] = []
    for ch in _all_chunks():
        toks = _tokenize(ch["text"])
        if not toks:
            continue
        doc_counts = Counter(toks)
        dot = sum(q_counts[w] * doc_counts.get(w, 0) for w in q_set)
        if dot <= 0:
            continue
        norm_d = (sum(doc_counts[w] ** 2 for w in doc_counts) ** 0.5) or 1.0
        score = dot / (norm_q * norm_d)
        scored.append((score, ch))
    scored.sort(key=lambda x: -x[0])

    if not per_doc_limit:
        return [c for _, c in scored[:top_k]]

    selected: list[dict[str, Any]] = []
    overflow: list[dict[str, Any]] = []
    per_doc_count: dict[Any, int] = {}
    for _s, ch in scored:
        sid = ch.get("source_id")
        if per_doc_count.get(sid, 0) < per_doc_limit:
            selected.append(ch)
            per_doc_count[sid] = per_doc_count.get(sid, 0) + 1
            if len(selected) >= top_k:
                break
        else:
            overflow.append(ch)
    if len(selected) < top_k:
        for ch in overflow:
            selected.append(ch)
            if len(selected) >= top_k:
                break
    return selected


def _focused_window(
    full_text: str,
    query_terms: set[str],
    budget: int,
) -> tuple[int, int]:
    """Return ``(start, end)`` for the window of size ``budget`` in ``full_text`` with the
    highest density of query keywords.

    Slides a coarse window across the document, counts case-insensitive occurrences of every
    query token of length >= 3, and snaps the start backwards to the nearest paragraph break
    so we don't slice through a chapter heading. This is what lets us keep "Chapter 7" in view
    when the relevant content is in the middle of a large guide instead of at the start.
    """
    n = len(full_text)
    if n <= budget:
        return 0, n
    keywords = [t for t in query_terms if len(t) >= 3]
    if not keywords:
        return 0, budget
    lower = full_text.lower()
    stride = max(500, budget // 16)
    best_start = 0
    best_score = -1
    last_start = n - budget
    start = 0
    while True:
        win = lower[start : start + budget]
        score = sum(win.count(t) for t in keywords)
        if score > best_score:
            best_score = score
            best_start = start
        if start >= last_start:
            break
        start = min(last_start, start + stride)
    look = full_text.rfind("\n\n", max(0, best_start - 2000), best_start + 200)
    if look >= 0:
        best_start = look
    end = min(n, best_start + budget)
    return best_start, end


def _retrieve_full_docs(
    query: str,
    max_docs: int = 10,
    per_doc_cap: int = 80_000,
    char_cap: int = 240_000,
    single_doc_cap: int = 240_000,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """For enumerative queries, hand Claude the *full* text of the most relevant documents.

    Budgets are sized to fit comfortably inside Claude's 200K-token context window:
    ~240K chars ≈ 60K tokens. A per-document cap keeps one huge document from starving the
    others, but when only a single document matches it gets the entire budget so a chapter
    deep inside (e.g. Chapter 7 of a 9-chapter install guide) is not cut off.

    When a document does have to be truncated, ``_focused_window`` anchors the slice on the
    section with the highest query-keyword density so we keep the relevant chapter, not
    arbitrary opening pages.
    """
    q_toks = _tokenize(query)
    if not q_toks:
        return [], []
    q_set = set(q_toks)
    q_counts = Counter(q_toks)
    norm_q = (sum(q_counts[w] ** 2 for w in q_counts) ** 0.5) or 1.0
    with _lock:
        docs_snapshot = [
            {
                "id": d["id"],
                "title": d.get("title") or f"Document {d['id']}",
                "full_text": d.get("full_text") or "",
            }
            for d in _docs
        ]
    scored_docs: list[tuple[float, dict[str, Any]]] = []
    for d in docs_snapshot:
        toks = _tokenize(d["full_text"])
        if not toks:
            continue
        doc_counts = Counter(toks)
        dot = sum(q_counts[w] * doc_counts.get(w, 0) for w in q_set)
        if dot <= 0:
            continue
        norm_d = (sum(doc_counts[w] ** 2 for w in doc_counts) ** 0.5) or 1.0
        score = dot / (norm_q * norm_d)
        scored_docs.append((score, d))
    scored_docs.sort(key=lambda x: -x[0])
    matching_count = len(scored_docs)
    effective_per_doc = single_doc_cap if matching_count == 1 else per_doc_cap

    full_docs: list[dict[str, Any]] = []
    hits: list[dict[str, Any]] = []
    total_chars = 0
    for _s, d in scored_docs[:max_docs]:
        if total_chars >= char_cap:
            break
        remaining_total = char_cap - total_chars
        budget = min(effective_per_doc, remaining_total)
        full_text = d["full_text"]
        truncated = False
        if len(full_text) > budget:
            start, end = _focused_window(full_text, q_set, budget)
            section = full_text[start:end].rstrip()
            leading_note = (
                f"[Excerpt focused near char {start} of {len(full_text)} — anchored on the "
                f"section with the highest density of query keywords. Earlier pages are not "
                f"shown.]\n\n"
                if start > 0
                else ""
            )
            trailing_note = (
                "\n\n[Document continues beyond this excerpt.]"
                if end < len(full_text)
                else ""
            )
            text = leading_note + section + trailing_note
            truncated = True
        else:
            text = full_text
        full_docs.append({"id": d["id"], "title": d["title"], "text": text, "truncated": truncated})
        hits.append({
            "title": d["title"],
            "source_id": d["id"],
            "part": 0,
            "text": d["full_text"][:600],
        })
        total_chars += len(text)
    return full_docs, hits


def _retrieve_schema_docs(
    user_message: str,
    char_cap: int = 240_000,
    per_doc_cap: int = 120_000,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Load full data-dictionary / schema documents for SQL generation.

    Chunk-level RAG often surfaces only meta-instructions ("use the data dictionary")
    instead of table and column definitions. SQL inquiries need the whole dictionary.
    """
    with _lock:
        docs_snapshot = [
            {
                "id": d["id"],
                "title": d.get("title") or f"Document {d['id']}",
                "filename": d.get("filename") or "",
                "full_text": d.get("full_text") or "",
            }
            for d in _docs
        ]
    ranked = sorted(
        (
            (_schema_doc_score(d["title"], d.get("filename"), d["full_text"]), d)
            for d in docs_snapshot
        ),
        key=lambda x: -x[0],
    )
    schema_docs = [d for score, d in ranked if score >= 6]
    if not schema_docs and len(docs_snapshot) == 1:
        schema_docs = docs_snapshot
    elif not schema_docs and ranked and ranked[0][0] > 0:
        # Prefer the most schema-like upload over unrelated AppEnhancer guides.
        schema_docs = [ranked[0][1]]
    if not schema_docs:
        return [], []

    full_docs: list[dict[str, Any]] = []
    hits: list[dict[str, Any]] = []
    total_chars = 0
    focus_terms = _sql_focus_terms(user_message)
    for d in schema_docs:
        if total_chars >= char_cap:
            break
        remaining = char_cap - total_chars
        budget = min(per_doc_cap, remaining)
        full_text = d["full_text"]
        truncated = False
        if len(full_text) > budget:
            start, end = _focused_window(full_text, focus_terms, budget)
            section = full_text[start:end].rstrip()
            leading = (
                f"[Schema excerpt near char {start} of {len(full_text)}]\n\n" if start > 0 else ""
            )
            trailing = "\n\n[Schema document continues.]" if end < len(full_text) else ""
            text = leading + section + trailing
            truncated = True
        else:
            text = full_text
        full_docs.append({"id": d["id"], "title": d["title"], "text": text, "truncated": truncated})
        hits.append({
            "title": d["title"],
            "source_id": d["id"],
            "part": 0,
            "text": full_text[:600],
        })
        total_chars += len(text)
    return full_docs, hits


def _retrieve_images(query: str, top_k: int = 4) -> list[dict[str, Any]]:
    """Return knowledge-base images whose caption/filename tokens best match the query."""
    q_toks = _tokenize(query)
    if not q_toks:
        return []
    q_set = set(q_toks)
    q_counts = Counter(q_toks)
    norm_q = (sum(q_counts[w] ** 2 for w in q_counts) ** 0.5) or 1.0
    with _lock:
        images_snapshot = [dict(x) for x in _images]
    scored: list[tuple[float, dict[str, Any]]] = []
    for im in images_snapshot:
        text = " ".join(filter(None, [im.get("caption") or "", im.get("filename") or ""]))
        toks = _tokenize(text)
        if not toks:
            continue
        d_counts = Counter(toks)
        dot = sum(q_counts[w] * d_counts.get(w, 0) for w in q_set)
        if dot <= 0:
            continue
        norm_d = (sum(d_counts[w] ** 2 for w in d_counts) ** 0.5) or 1.0
        score = dot / (norm_q * norm_d)
        scored.append((score, im))
    scored.sort(key=lambda x: -x[0])
    return [im for _, im in scored[:top_k]]


def _image_context(matched: list[dict[str, Any]] | None = None) -> str:
    """Render an image listing for the model.

    If `matched` is provided, those images are listed first as the most relevant; the full
    library is still listed below so the model can reference any screenshot by filename.
    """
    with _lock:
        if not _images:
            return ""
        all_images = [dict(x) for x in _images]
    matched_ids = {im["id"] for im in (matched or [])}

    def _line(im: dict[str, Any]) -> str:
        cap = (im.get("caption") or "").strip()
        fname = im.get("filename") or ""
        url = im.get("url_path", "")
        cap_part = f": {cap}" if cap else " (no caption — describe in UI)"
        return f"- filename={fname} url={url}{cap_part}"

    out: list[str] = []
    if matched:
        out.append("Most relevant screenshots for this inquiry:")
        out.extend(_line(im) for im in matched)
        rest = [im for im in all_images if im["id"] not in matched_ids]
        if rest:
            out.append("")
            out.append("Other screenshots in the knowledge base:")
            out.extend(_line(im) for im in rest)
    else:
        out.append("Reference screenshots in knowledge base:")
        out.extend(_line(im) for im in all_images)
    return "\n".join(out)


def _build_context_for_query(
    user_message: str,
) -> tuple[str, list[dict[str, Any]], list[dict[str, Any]], bool, bool]:
    """Assemble the knowledge context block for the model.

    Detects enumerative/broad questions (``every``, ``all``, ``each``, ``list``, ``in order``,
    ``step by step`` …) and, for those, includes the *full* text of every matching document so
    items cannot be silently dropped because their chunks lost the chunk-level scoring race.
    SQL / data-dictionary requests load full schema documents so the model can write queries.
    Narrow questions keep the original chunk-level RAG behavior.
    """
    sql = _is_sql_query_request(user_message)
    broad = _is_broad_query(user_message) or sql
    img_hits = _retrieve_images(user_message, top_k=4)
    parts: list[str] = []

    if sql:
        full_docs, doc_hits = _retrieve_schema_docs(user_message)
        if full_docs:
            for d in full_docs:
                parts.append(f"Data dictionary / schema «{d['title']}»:\n{d['text']}\n")
            hits = list(doc_hits)
        else:
            # Do not fall back to unrelated support guides — they cause false "no schema" answers.
            hits = []
    elif broad:
        full_docs, doc_hits = _retrieve_full_docs(user_message, max_docs=10)
        diverse_chunks = _retrieve(user_message, top_k=24, per_doc_limit=6)
        if full_docs:
            for d in full_docs:
                parts.append(f"Full document «{d['title']}»:\n{d['text']}\n")
            hits = list(doc_hits)
            seen = {(h.get("source_id"), h.get("part")) for h in hits}
            for ch in diverse_chunks:
                key = (ch.get("source_id"), ch.get("part"))
                if key not in seen:
                    hits.append(ch)
                    seen.add(key)
        else:
            hits = diverse_chunks
            for h in hits:
                parts.append(f"From «{h['title']}» (excerpt {h.get('part', 1)}):\n{h['text']}\n")
    else:
        hits = _retrieve(user_message, top_k=6)
        for h in hits:
            parts.append(f"From «{h['title']}» (excerpt {h.get('part', 1)}):\n{h['text']}\n")

    ctx = "\n---\n".join(parts) if parts else ""
    img_ctx = _image_context(img_hits)
    if img_ctx:
        ctx = (ctx + "\n\n" + img_ctx) if ctx else img_ctx
    return ctx, hits, img_hits, broad, sql


def _call_claude(system: str, user_text: str, max_tokens: int = 4096) -> str:
    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not key:
        return ""
    model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user_text}],
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


MAX_INQUIRY_IMAGES = 4
MAX_INQUIRY_IMAGE_CHARS = 5_000_000


def _call_claude_vision(
    system: str,
    user_text: str,
    image_data_urls: list[str],
    max_tokens: int = 4096,
) -> str:
    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not key:
        return ""
    model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
    content: list[dict[str, Any]] = [{"type": "text", "text": user_text}]
    for data_url in image_data_urls:
        try:
            header, _, b64data = data_url.partition(",")
            if not b64data:
                continue
            media_type = header.split(":")[1].split(";")[0] if ":" in header else "image/jpeg"
            if media_type not in ("image/jpeg", "image/png", "image/gif", "image/webp"):
                media_type = "image/jpeg"
            content.append({
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": b64data},
            })
        except Exception:
            continue
    if len(content) < 2:
        return _call_claude(system, user_text, max_tokens=max_tokens)
    payload = {
        "model": model,
        "max_tokens": max_tokens,
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


def _sanitize_inquiry_images(raw: list[str] | None) -> list[str]:
    if not raw:
        return []
    out: list[str] = []
    for item in raw[:MAX_INQUIRY_IMAGES]:
        s = (item or "").strip()
        if not s.startswith("data:image/") or "," not in s:
            continue
        if len(s) > MAX_INQUIRY_IMAGE_CHARS:
            continue
        out.append(s)
    return out


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=32_000)
    images: list[str] = Field(default_factory=list, max_length=MAX_INQUIRY_IMAGES)
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
    _persist_kb_to_disk()
    return {"ok": True, "id": doc_id, "title": doc_title, "chunk_count": len(chunks)}


@router.delete("/documents/{doc_id}")
def delete_document(doc_id: int) -> dict[str, bool]:
    with _lock:
        global _docs
        before = len(_docs)
        _docs = [d for d in _docs if d["id"] != doc_id]
    if len(_docs) < before:
        _persist_kb_to_disk()
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
    inquiry_images = _sanitize_inquiry_images(body.images)
    ctx, hits, img_hits, broad, sql = _build_context_for_query(body.message)
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
        "and keep a professional, helpful tone. "
        "When a screenshot from the knowledge base helps illustrate a step, embed it inline using "
        "the marker `[[image: FILENAME]]` on its own line, where FILENAME exactly matches the "
        "`filename=` value listed in the knowledge context. The UI will render that screenshot in "
        "place. Only reference images that appear in the listing; do not invent filenames."
    )
    if sql:
        system += (
            " SQL / DATA DICTIONARY MODE: The user wants a SQL query. Your primary job is to write "
            "the query — not to explain that schema information is unavailable. "
            "When data dictionary / schema sections appear in the knowledge context, use the actual "
            "table names, column names, joins, and relationships shown there. Write a complete, "
            "runnable SQL query (usually SELECT with LEFT JOIN as requested). Put the query in a "
            "fenced ```sql code block. "
            "Do NOT refuse with 'outside the scope of the knowledge base' when schema text is present. "
            "Do NOT tell the user to 'use the data dictionary' instead of writing SQL yourself. "
            "Do NOT ask support staff to identify the schema if the dictionary is already in context. "
            "If you must assume a table or column, state the assumption briefly, then still provide "
            "the best query you can. "
            "Only if the context has NO data dictionary / schema sections at all, tell the user to "
            "upload their data dictionary under Knowledge base (title it 'Data Dictionary') and end "
            "with STATUS: NEEDS_REVIEW; otherwise end with STATUS: RESOLVED."
        )
    if inquiry_images:
        system += (
            " The user attached screenshot(s) of the customer's issue (error dialogs, UI states, "
            "email captures). Read visible text in those images carefully — extract exact error "
            "messages, codes, and UI labels — and use them in your triage. Do not ask the user to "
            "re-type text that is already visible in an attached screenshot."
        )
    if broad:
        system += (
            " IMPORTANT — enumerative request: the user is asking you to cover every/all/each item "
            "or to provide a list, an ordered walkthrough, or step-by-step instructions across "
            "multiple items. Before drafting, scan the knowledge context for numbered or labeled "
            "subsections (for example 'Chapter 7' with sub-sections 7.1, 7.2, 7.3 … 7.N, or a "
            "list of application names with their own setup sections). Enumerate EVERY such "
            "subsection that the context actually shows — do not stop early, do not summarize "
            "items away, do not silently merge them. Use a numbered top-level list. For each "
            "subsection, include its original heading or label (e.g. '7.1 ApplicationName') "
            "followed by its steps. After listing what you found, explicitly state how many "
            "subsections you covered (e.g. 'Covered 9 of 9 subsections under Chapter 7'). If "
            "any expected subsection is missing from the context, name it explicitly and end "
            "with STATUS: NEEDS_REVIEW."
        )

    user_block = (
        f"User inquiry:\n{body.message}\n\n"
        f"Retrieved Software knowledge (may be empty):\n"
        f"{ctx or '(no documents matched; inform user and use STATUS: NEEDS_REVIEW unless trivial).'}"
    )

    max_tok = 8192 if broad else 4096
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if api_key:
        if inquiry_images:
            reply = _call_claude_vision(system, user_block, inquiry_images, max_tokens=max_tok)
        else:
            reply = _call_claude(system, user_block, max_tokens=max_tok)
    else:
        reply = ""

    if not reply:
        if has_kb:
            reply = (
                "*(ANTHROPIC_API_KEY is not set. Showing retrieved context only.)*\n\n"
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
        "inquiry_images": len(inquiry_images),
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
        "images": [
            {
                "id": im["id"],
                "filename": im.get("filename", ""),
                "url_path": im.get("url_path", ""),
                "caption": im.get("caption", ""),
            }
            for im in img_hits
        ],
        "status": status_line,
        "broad": broad,
        "sql": sql,
        "schema_docs": [h["title"] for h in hits if h.get("part") == 0] if sql else [],
        "anthropic_configured": bool(os.getenv("ANTHROPIC_API_KEY", "").strip()),
        "ticket_id": body.ticket_id or new_ticket_id,
        "inquiry_images": len(inquiry_images),
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
