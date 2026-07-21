"""
AIRevolution: Software Tier 1 support. Knowledge uploads, RAG, Claude chat, ticket tracking.

Env:
  ANTHROPIC_API_KEY: required for live AI; without it, /chat returns a draft using retrieved context only.
  ANTHROPIC_MODEL: optional, default claude-3-5-sonnet-20241022
"""

from __future__ import annotations

import html as html_lib
import io
import ipaddress
import json
import logging
import os
import re
import socket
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
    """Survive service restarts — docs, image records, and tickets all live here."""
    try:
        with _lock:
            payload = {
                "id_seq": _id_seq,
                "docs": [
                    {
                        "id": d["id"],
                        "title": d["title"],
                        "filename": d.get("filename"),
                        "kind": d.get("kind"),
                        "source_url": d.get("source_url"),
                        "bytes": d.get("bytes", 0),
                        "created_at": d.get("created_at"),
                        "full_text": d.get("full_text") or "",
                    }
                    for d in _docs
                ],
                "images": [dict(x) for x in _images],
                "tickets": [dict(t) for t in _tickets],
            }
        KB_STORE_PATH.write_text(
            json.dumps(payload, ensure_ascii=False),
            encoding="utf-8",
        )
    except OSError as exc:
        log.warning("Could not persist knowledge base: %s", exc)


def _load_kb_from_disk() -> None:
    global _docs, _images, _tickets, _id_seq, _kb_loaded
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
            fname = raw.get("filename")
            kind = _infer_doc_kind(title, fname, full_text, raw.get("kind"))
            loaded.append(
                {
                    "id": doc_id,
                    "title": title,
                    "filename": fname,
                    "kind": kind,
                    "source_url": raw.get("source_url"),
                    "bytes": raw.get("bytes") or len(full_text.encode("utf-8", errors="replace")),
                    "created_at": raw.get("created_at")
                    or time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z",
                    "full_text": full_text,
                    "chunks": _chunk_text(full_text, doc_id, title),
                }
            )
        loaded_images: list[dict[str, Any]] = []
        for raw in payload.get("images") or []:
            stored = raw.get("stored") or ""
            # Skip records whose file vanished so the UI never shows broken thumbnails.
            if stored and not (IMAGES_DIR / stored).is_file():
                continue
            loaded_images.append(dict(raw))
        loaded_tickets = [dict(t) for t in (payload.get("tickets") or [])]
        all_ids = [d["id"] for d in loaded]
        all_ids += [int(x.get("id") or 0) for x in loaded_images]
        all_ids += [int(t.get("id") or 0) for t in loaded_tickets]
        with _lock:
            _docs = loaded
            _images = loaded_images
            _tickets = loaded_tickets
            _id_seq = max(int(payload.get("id_seq") or 0), max(all_ids, default=0))
        log.info(
            "Loaded %d doc(s), %d image(s), %d ticket(s) from disk",
            len(loaded), len(loaded_images), len(loaded_tickets),
        )
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


def _infer_doc_kind(
    title: str,
    filename: str | None,
    full_text: str,
    stored: str | None = None,
) -> str:
    """Classify uploads so SQL mode never pulls AppEnhancer support guides."""
    if stored in ("schema", "support"):
        return stored
    label = f"{title} {filename or ''}"
    if SCHEMA_DOC_LABEL_RE.search(label):
        return "schema"
    if _schema_doc_score(title, filename, full_text) >= 10:
        return "schema"
    return "support"


def _build_usrid_column_index(full_text: str, max_lines: int = 300) -> str:
    """Surface every dictionary line that mentions usrid-like columns."""
    hits: list[str] = []
    for line in full_text.splitlines():
        if re.search(r"\b(usrid|user_id|userid|user\s*id)\b", line, re.I):
            stripped = line.strip()
            if stripped and stripped not in hits:
                hits.append(stripped)
            if len(hits) >= max_lines:
                break
    if not hits:
        return ""
    return (
        "Dictionary lines mentioning usrid / user_id (use these table and column names):\n"
        + "\n".join(f"- {h}" for h in hits)
    )


_SQL_SYSTEM_PROMPT = (
    "You write SQL for internal support staff using their uploaded DATA DICTIONARY. "
    "This task is always in scope. Never refuse, never say 'outside the knowledge base', "
    "never escalate to a DBA, and never cite security risks as a reason to avoid read-only SELECT queries. "
    "Scan the DATA DICTIONARY for every table that contains usrid, user_id, or userid columns. "
    "Write runnable SQL (SELECT with LEFT JOIN or UNION ALL as appropriate) using exact table and "
    "column names from the dictionary. Put the query in a fenced ```sql code block. "
    "A short note after the query is fine. End with STATUS: RESOLVED when SQL is provided. "
    "Only use STATUS: NEEDS_REVIEW if the DATA DICTIONARY section is literally empty."
)


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
                f"[Excerpt focused near char {start} of {len(full_text)}. Anchored on the "
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
                "kind": d.get("kind")
                or _infer_doc_kind(
                    d.get("title") or "",
                    d.get("filename"),
                    d.get("full_text") or "",
                ),
                "full_text": d.get("full_text") or "",
            }
            for d in _docs
        ]
    schema_docs = [d for d in docs_snapshot if d["kind"] == "schema"]
    if not schema_docs:
        ranked = sorted(
            (
                (_schema_doc_score(d["title"], d.get("filename"), d["full_text"]), d)
                for d in docs_snapshot
            ),
            key=lambda x: -x[0],
        )
        if ranked and ranked[0][0] >= 8:
            schema_docs = [ranked[0][1]]
        elif len(docs_snapshot) == 1:
            schema_docs = docs_snapshot
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
        full_docs.append({
            "id": d["id"],
            "title": d["title"],
            "text": text,
            "full_text": full_text,
            "truncated": truncated,
        })
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
        cap_part = f": {cap}" if cap else " (no caption; describe in UI)"
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
            wants_usrid = bool(
                re.search(r"\b(usrid|user_id|userid|user\s*id)\b", user_message, re.I)
            )
            for d in full_docs:
                block = f"DATA DICTIONARY «{d['title']}»:\n{d['text']}\n"
                if wants_usrid:
                    index = _build_usrid_column_index(d.get("full_text") or d["text"])
                    if index:
                        block = index + "\n\n" + block
                parts.append(block)
            hits = list(doc_hits)
        else:
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


def _merge_alternating(history: list[dict[str, str]]) -> list[dict[str, str]]:
    """Anthropic requires strictly alternating roles starting with `user`.

    Merge consecutive same-role turns and drop any leading assistant turn so a stored
    case thread can always be replayed as valid API history.
    """
    out: list[dict[str, str]] = []
    for m in history:
        role = m.get("role")
        content = (m.get("content") or "").strip()
        if role not in ("user", "assistant") or not content:
            continue
        if out and out[-1]["role"] == role:
            out[-1]["content"] += "\n\n" + content
        else:
            out.append({"role": role, "content": content})
    while out and out[0]["role"] != "user":
        out.pop(0)
    return out


def _call_claude(
    system: str,
    user_text: str,
    max_tokens: int = 4096,
    history: list[dict[str, str]] | None = None,
) -> str:
    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not key:
        return ""
    model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
    prior = _merge_alternating(history or [])
    if prior and prior[-1]["role"] == "user":
        user_text = prior.pop()["content"] + "\n\n" + user_text
    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": prior + [{"role": "user", "content": user_text}],
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
    return f"(Claude unavailable. {last_err}. Please try again in a moment.)"


MAX_INQUIRY_IMAGES = 4
MAX_INQUIRY_IMAGE_CHARS = 5_000_000


def _call_claude_vision(
    system: str,
    user_text: str,
    image_data_urls: list[str],
    max_tokens: int = 4096,
    history: list[dict[str, str]] | None = None,
) -> str:
    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not key:
        return ""
    model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
    prior = _merge_alternating(history or [])
    if prior and prior[-1]["role"] == "user":
        user_text = prior.pop()["content"] + "\n\n" + user_text
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
        return _call_claude(system, user_text, max_tokens=max_tokens, history=history)
    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": prior + [{"role": "user", "content": content}],
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
    return f"(Claude unavailable. {last_err}. Please try again in a moment.)"


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


class ChatTurn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    text: str = Field(min_length=1, max_length=16_000)


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=32_000)
    images: list[str] = Field(default_factory=list, max_length=MAX_INQUIRY_IMAGES)
    ticket_id: int | None = None
    # When true, creates or updates a ticket record for the portal audit trail.
    create_ticket: bool = False
    # When true (default), Claude may supplement thin KB coverage with clearly
    # labeled general knowledge. When false, answers stay strictly KB-only.
    allow_general: bool = True
    # Prior turns of an un-ticketed conversation; used to seed a new case thread
    # when the user replies with additional details. Ignored when ticket_id is set
    # (the server-side thread wins).
    history: list[ChatTurn] = Field(default_factory=list, max_length=24)


class TicketCreate(BaseModel):
    subject: str = Field(min_length=1, max_length=500)
    description: str = Field(min_length=1, max_length=16_000)
    requester_email: str | None = Field(default=None, max_length=200)


class UrlIngestIn(BaseModel):
    url: str = Field(min_length=8, max_length=2000)
    title: str | None = Field(default=None, max_length=300)
    doc_kind: str | None = None


MAX_URL_FETCH_BYTES = 4 * 1024 * 1024
_MAX_THREAD_TURNS = 12


def _reject_private_url(url: str) -> None:
    """Block SSRF against localhost / private ranges when fetching KB links."""
    m = re.match(r"^https?://([^/:?#]+)", url, re.I)
    if not m:
        raise HTTPException(400, "URL must start with http:// or https://")
    host = m.group(1).strip("[]")
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        raise HTTPException(400, f"Could not resolve host: {host}")
    for info in infos:
        try:
            addr = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
            raise HTTPException(400, "URL resolves to a private or local address")


def _html_to_text(html: str) -> tuple[str, str]:
    """Very small readability pass: page title + visible text with paragraph breaks."""
    title = ""
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    if m:
        title = re.sub(r"\s+", " ", html_lib.unescape(m.group(1))).strip()
    body = re.sub(
        r"<(script|style|noscript|svg|iframe|head|template)\b.*?</\1\s*>",
        " ",
        html,
        flags=re.I | re.S,
    )
    body = re.sub(r"<!--.*?-->", " ", body, flags=re.S)
    body = re.sub(r"<li\b[^>]*>", "\n- ", body, flags=re.I)
    body = re.sub(
        r"<(?:br|hr)\b[^>]*>|</(?:p|div|li|tr|h[1-6]|section|article|blockquote|table|ul|ol|pre)\s*>",
        "\n",
        body,
        flags=re.I,
    )
    text = re.sub(r"<[^>]+>", " ", body)
    text = html_lib.unescape(text)
    text = re.sub(r"[ \t\r\f]+", " ", text)
    text = re.sub(r" ?\n ?", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return title, text.strip()


@router.get("/status")
def status() -> dict[str, Any]:
    _ensure_storage()
    with _lock:
        nd = len(_docs)
        ni = len(_images)
        nt = len(_tickets)
    with _lock:
        schema_n = sum(
            1
            for d in _docs
            if (d.get("kind") or _infer_doc_kind(d.get("title") or "", d.get("filename"), d.get("full_text") or ""))
            == "schema"
        )
    return {
        "anthropic_configured": bool(os.getenv("ANTHROPIC_API_KEY", "").strip()),
        "documents": nd,
        "schema_documents": schema_n,
        "kb_persisted": KB_STORE_PATH.is_file(),
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
                "source_url": d.get("source_url"),
                "kind": d.get("kind")
                or _infer_doc_kind(d.get("title") or "", d.get("filename"), d.get("full_text") or ""),
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
    doc_kind: str | None = Form(default=None),
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
    kind_raw = (doc_kind or "").strip().lower()
    if kind_raw in ("schema", "support"):
        kind = kind_raw
    else:
        kind = _infer_doc_kind(doc_title, fname, raw_text)
    chunks = _chunk_text(raw_text, doc_id, doc_title)
    entry = {
        "id": doc_id,
        "title": doc_title,
        "filename": fname,
        "kind": kind,
        "bytes": len(raw_text.encode("utf-8", errors="replace")),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z",
        "full_text": raw_text,
        "chunks": chunks,
    }
    with _lock:
        _docs.append(entry)
    _persist_kb_to_disk()
    return {"ok": True, "id": doc_id, "title": doc_title, "kind": kind, "chunk_count": len(chunks)}


@router.post("/documents/from-url")
def add_document_from_url(body: UrlIngestIn) -> dict[str, Any]:
    """Fetch a web page and ingest its readable text as a KB article."""
    _ensure_storage()
    url = body.url.strip()
    if not re.match(r"^https?://", url, re.I):
        raise HTTPException(400, "URL must start with http:// or https://")
    _reject_private_url(url)
    try:
        r = httpx.get(
            url,
            timeout=30.0,
            follow_redirects=True,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; AIRevolution-KB/1.0)",
                "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
            },
        )
        r.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise HTTPException(400, f"URL returned {e.response.status_code}")
    except httpx.HTTPError as e:
        raise HTTPException(400, f"Could not fetch URL: {e}")

    content = r.text[:MAX_URL_FETCH_BYTES]
    ctype = (r.headers.get("content-type") or "").lower()
    if "html" in ctype or content.lstrip()[:1] == "<":
        page_title, raw_text = _html_to_text(content)
    else:
        page_title, raw_text = "", content.strip()

    if len(raw_text) < 40:
        raise HTTPException(
            400,
            "No readable text found at that URL. If the page is JavaScript-rendered, "
            "copy the article text and use Paste text instead.",
        )

    doc_id = _next_id()
    doc_title = (body.title or "").strip() or page_title or url
    kind_raw = (body.doc_kind or "").strip().lower()
    if kind_raw in ("schema", "support"):
        kind = kind_raw
    else:
        kind = _infer_doc_kind(doc_title, None, raw_text)
    chunks = _chunk_text(raw_text, doc_id, doc_title)
    entry = {
        "id": doc_id,
        "title": doc_title,
        "filename": None,
        "kind": kind,
        "source_url": url,
        "bytes": len(raw_text.encode("utf-8", errors="replace")),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z",
        "full_text": raw_text,
        "chunks": chunks,
    }
    with _lock:
        _docs.append(entry)
    _persist_kb_to_disk()
    return {
        "ok": True,
        "id": doc_id,
        "title": doc_title,
        "kind": kind,
        "source_url": url,
        "chars": len(raw_text),
        "chunk_count": len(chunks),
    }


@router.delete("/documents/{doc_id}")
def delete_document(doc_id: int) -> dict[str, bool]:
    global _docs
    with _lock:
        before = len(_docs)
        _docs = [d for d in _docs if d["id"] != doc_id]
        removed = len(_docs) < before
    if removed:
        _persist_kb_to_disk()
    return {"ok": removed}


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
    _persist_kb_to_disk()
    return {"ok": True, **rec}


@router.post("/images/{image_id}/caption")
def update_image_caption(
    image_id: int,
    caption: str = Form(default=""),
) -> dict[str, Any]:
    updated = False
    with _lock:
        for im in _images:
            if im["id"] == image_id:
                im["caption"] = (caption or "").strip()
                updated = True
                new_caption = im["caption"]
                break
    if updated:
        _persist_kb_to_disk()
        return {"ok": True, "id": image_id, "caption": new_caption}
    raise HTTPException(404, "Image not found")


@router.delete("/images/{image_id}")
def delete_image(image_id: int) -> dict[str, bool]:
    removed = False
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
                removed = True
                break
    if removed:
        _persist_kb_to_disk()
    return {"ok": removed}


def _claude_history_for(ticket: dict[str, Any] | None, client_turns: list[ChatTurn]) -> list[dict[str, str]]:
    """Prior conversation turns for the model: server thread wins over client history."""
    if ticket is not None:
        source = [
            {"role": m.get("role"), "content": m.get("text") or ""}
            for m in (ticket.get("messages") or [])
        ]
    else:
        source = [{"role": t.role, "content": t.text} for t in client_turns]
    return source[-_MAX_THREAD_TURNS:]


@router.post("/chat")
def chat(body: ChatIn) -> dict[str, Any]:
    _ensure_storage()
    inquiry_images = _sanitize_inquiry_images(body.images)
    ctx, hits, img_hits, broad, sql = _build_context_for_query(body.message)
    has_kb = bool(ctx)

    ticket_snapshot: dict[str, Any] | None = None
    if body.ticket_id is not None:
        with _lock:
            for t in _tickets:
                if t["id"] == body.ticket_id:
                    ticket_snapshot = {"messages": [dict(m) for m in (t.get("messages") or [])]}
                    break
        if ticket_snapshot is None:
            raise HTTPException(404, "Ticket not found")
    history = _claude_history_for(ticket_snapshot, body.history)

    if sql:
        system = _SQL_SYSTEM_PROMPT
    else:
        system = (
            "You are the T1 AI Support Agent for AIRevolution (t1airevolution.com), an expert software "
            "support assistant. You help support staff move from classic Tier 1 to AI Tier 2 style work: "
            "triage with the knowledge base first, then apply human judgment. "
        )
        if body.allow_general:
            system += (
                "Ground your answer in the provided knowledge context first; it is authoritative for "
                "this product. When the context covers the issue, answer from it alone. When the "
                "context is empty or only partially covers the issue, supplement with your own general "
                "software support expertise, but you MUST place that part under a separate section "
                "that begins with this exact line: "
                "General guidance (not from your documentation): "
                "If the context and your general knowledge conflict, the context wins. Never invent "
                "product-specific UI names, menu paths, settings, or version behavior that the context "
                "does not show; keep general advice generic (browser, network, OS, account, and common "
                "admin practice). "
                "End with exactly one status line. Use STATUS: RESOLVED when the resolution is grounded "
                "in the knowledge context, or when the fix is trivial and universally safe. If your "
                "answer relies mainly on general knowledge, end with STATUS: NEEDS_REVIEW. "
                "If the issue is beyond Tier 1 or needs internal escalation, use: STATUS: ESCALATE. "
            )
        else:
            system += (
                "Answer using ONLY the provided knowledge context when it applies. If the context is empty "
                "or insufficient, say so clearly, give safe general product-adjacent guidance, and end with "
                "the line: STATUS: NEEDS_REVIEW. "
                "If you can provide a complete resolution, end with: STATUS: RESOLVED. "
                "If the issue is beyond Tier 1 or needs internal escalation, use: STATUS: ESCALATE. "
            )
        system += (
            "After the STATUS line, add one final line stating what grounded your answer, exactly one "
            "of: SOURCES: KB (knowledge context only), SOURCES: KB+GENERAL (knowledge context plus "
            "general knowledge), or SOURCES: GENERAL (general knowledge only). "
            "Be concise, use numbered steps for fixes, name UI areas and settings panels when relevant, "
            "and keep a professional, helpful tone. "
            "Do not use em dashes in your replies; end the sentence or use a comma instead. "
            "Do not use markdown bold (**). Use quotation marks when naming UI areas, tabs, or settings. "
            "When a screenshot from the knowledge base helps illustrate a step, embed it inline using "
            "the marker `[[image: FILENAME]]` on its own line, where FILENAME exactly matches the "
            "`filename=` value listed in the knowledge context. The UI will render that screenshot in "
            "place. Only reference images that appear in the listing; do not invent filenames."
        )
    if inquiry_images:
        system += (
            " The user attached screenshot(s) of the customer's issue (error dialogs, UI states, "
            "email captures). Read visible text in those images carefully. Extract exact error "
            "messages, codes, and UI labels, and use them in your triage. Do not ask the user to "
            "re-type text that is already visible in an attached screenshot."
        )
    if broad:
        system += (
            " IMPORTANT: enumerative request. The user is asking you to cover every/all/each item "
            "or to provide a list, an ordered walkthrough, or step-by-step instructions across "
            "multiple items. Before drafting, scan the knowledge context for numbered or labeled "
            "subsections (for example 'Chapter 7' with sub-sections 7.1, 7.2, 7.3 … 7.N, or a "
            "list of application names with their own setup sections). Enumerate EVERY such "
            "subsection that the context actually shows. Do not stop early, do not summarize "
            "items away, do not silently merge them. Use a numbered top-level list. For each "
            "subsection, include its original heading or label (e.g. '7.1 ApplicationName') "
            "followed by its steps. After listing what you found, explicitly state how many "
            "subsections you covered (e.g. 'Covered 9 of 9 subsections under Chapter 7'). If "
            "any expected subsection is missing from the context, name it explicitly and end "
            "with STATUS: NEEDS_REVIEW."
        )
        if body.allow_general and not sql:
            system += (
                " Enumerate ONLY subsections that the knowledge context actually shows; never pad "
                "the enumeration from general knowledge. General knowledge may only appear "
                "afterwards in the labeled 'General guidance (not from your documentation):' section."
            )

    if sql:
        user_block = (
            f"Write SQL for this support request:\n{body.message}\n\n"
            f"DATA DICTIONARY (required; use these table and column names only):\n"
            f"{ctx or '[EMPTY. No data dictionary loaded. Tell user to upload under Knowledge base with document type Data dictionary / schema.]'}"
        )
    else:
        user_block = (
            f"User inquiry:\n{body.message}\n\n"
            f"Retrieved Software knowledge (may be empty):\n"
            f"{ctx or '(no documents matched; inform user and use STATUS: NEEDS_REVIEW unless trivial).'}"
        )

    if history:
        system += (
            " This is a continuing case thread. Earlier turns of the conversation are included; "
            "treat the newest user message as additional details on the same issue unless it "
            "clearly starts a new topic. Do not repeat full instructions already given; build "
            "on them and adjust for the new information."
        )

    max_tok = 8192 if (broad or sql) else 4096
    api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if api_key:
        if inquiry_images:
            reply = _call_claude_vision(
                system, user_block, inquiry_images, max_tokens=max_tok, history=history
            )
        else:
            reply = _call_claude(system, user_block, max_tokens=max_tok, history=history)
    else:
        reply = ""

    if not reply:
        if has_kb:
            reply = (
                "(ANTHROPIC_API_KEY is not set. Showing retrieved context only.)\n\n"
                f"Matched knowledge:\n{ctx}\n\n"
                "Next steps for you (draft): Summarize the closest matching procedure above, "
                'or add more documentation in "Knowledge base" and set `ANTHROPIC_API_KEY` for full AI answers.'
            )
        else:
            reply = (
                "(No knowledge base content matched and no API key configured.)\n\n"
                'Add PDFs, guides, or pasted text under "Knowledge base", and set the '
                "`ANTHROPIC_API_KEY` environment variable to enable Claude-powered answers."
            )

    # Pull the machine-readable SOURCES trailer out of the reply (it is meta,
    # not something the customer should read).
    sources: str | None = None
    if reply:
        m = re.search(r"^\s*SOURCES:\s*(KB\s*\+\s*GENERAL|KB|GENERAL)\s*\.?\s*$", reply, re.I | re.M)
        if m:
            sources = re.sub(r"\s", "", m.group(1).upper())
        stripped = re.sub(r"^\s*SOURCES:[^\n]*$", "", reply, flags=re.I | re.M).rstrip()
        if stripped:
            reply = stripped
    if sources is None and reply and api_key and not sql:
        # Model skipped the trailer; fall back to a retrieval-based guess.
        sources = "KB" if has_kb else "GENERAL"

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
        "sources": sources,
    }

    now_iso = audit_entry["at"]
    turn_user = {"role": "user", "text": body.message, "at": now_iso}
    turn_ai = {"role": "assistant", "text": reply, "at": now_iso}

    new_ticket_id: int | None = None
    ticket_touched = False
    # _next_id() takes _lock (non-reentrant), so allocate before entering the block below.
    allocated_id = _next_id() if (body.ticket_id is None and body.create_ticket) else None
    with _lock:
        if body.ticket_id is not None:
            for t in _tickets:
                if t["id"] == body.ticket_id:
                    t["status"] = status_line
                    t.setdefault("audit", []).append(audit_entry)
                    msgs = t.setdefault("messages", [])
                    # "Run AI on ticket" re-sends the description; don't double the user turn.
                    if msgs and msgs[-1].get("role") == "user" and (
                        (msgs[-1].get("text") or "").strip() == body.message.strip()
                    ):
                        msgs.append(turn_ai)
                    else:
                        msgs.extend([turn_user, turn_ai])
                    t["last_reply"] = reply
                    ticket_touched = True
                    break
        elif body.create_ticket:
            new_ticket_id = allocated_id
            subject_src = body.history[0].text if body.history else body.message
            seed_messages = [
                {"role": h.role, "text": h.text, "at": now_iso} for h in body.history
            ]
            _tickets.append(
                {
                    "id": new_ticket_id,
                    "subject": (subject_src[:120] + "…") if len(subject_src) > 120 else subject_src,
                    "description": subject_src,
                    "status": status_line,
                    "requester_email": None,
                    "created_at": now_iso,
                    "audit": [audit_entry],
                    "messages": seed_messages + [turn_user, turn_ai],
                    "last_reply": reply,
                }
            )
            ticket_touched = True
    if ticket_touched:
        _persist_kb_to_disk()

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
        "sources": sources,
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
    _ensure_storage()
    tid = _next_id()
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"
    rec = {
        "id": tid,
        "subject": body.subject.strip(),
        "description": body.description.strip(),
        "status": "open",
        "requester_email": (body.requester_email or "").strip() or None,
        "created_at": now_iso,
        "audit": [],
        "messages": [{"role": "user", "text": body.description.strip(), "at": now_iso}],
        "last_reply": None,
    }
    with _lock:
        _tickets.append(rec)
    _persist_kb_to_disk()
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
    updated = False
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
                updated = True
                break
    if updated:
        _persist_kb_to_disk()
        return {"ok": True, "id": ticket_id, "status": new_status}
    raise HTTPException(404, "Ticket not found")
