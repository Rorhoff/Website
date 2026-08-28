"""
Reverse-proxy /ldbg/* to the LDBG Next.js server (default http://127.0.0.1:3002).

Set LDBG_INTERNAL_URL in the environment. When the upstream is down, returns 503
with a short HTML hint instead of a bare connection error.
"""

from __future__ import annotations

import os
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Request, Response

router = APIRouter(include_in_schema=False)

LDBG_INTERNAL = os.getenv("LDBG_INTERNAL_URL", "http://127.0.0.1:3002").rstrip("/")
_HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
    # httpx auto-decompresses; forwarding these makes browsers fail with
    # ERR_CONTENT_DECODING_FAILED on _next/static assets.
    "content-encoding",
}


def _rewrite_location(location: str) -> str:
    """Keep redirects on the public host, not 127.0.0.1:3002."""
    if location.startswith(LDBG_INTERNAL):
        path = location[len(LDBG_INTERNAL) :] or "/"
        return path if path.startswith("/") else f"/{path}"
    return location


def _filter_headers(headers: httpx.Headers) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in headers.items():
        lk = k.lower()
        if lk in _HOP_BY_HOP:
            continue
        if lk == "location":
            v = _rewrite_location(v)
        out[k] = v
    return out


def _ldbg_upstream_path(subpath: str) -> str:
    """Build the upstream path, re-encoding segments Starlette decoded (e.g. [id] → %5Bid%5D)."""
    if not subpath:
        return "/ldbg"
    encoded = "/".join(quote(part, safe="") for part in subpath.split("/"))
    return f"/ldbg/{encoded}"


async def _proxy(request: Request, subpath: str) -> Response:
    # Pass paths through unchanged — Next.js App Router does not use trailing
    # slashes; adding them causes 308 loops (including RSC ?_rsc= fetches).
    path = _ldbg_upstream_path(subpath)
    url = f"{LDBG_INTERNAL}{path}"
    if request.url.query:
        url = f"{url}?{request.url.query}"

    body = await request.body()
    try:
        async with httpx.AsyncClient(follow_redirects=False, timeout=300.0) as client:
            upstream = await client.request(
                request.method,
                url,
                headers={
                    k: v
                    for k, v in request.headers.items()
                    if k.lower() not in _HOP_BY_HOP
                }
                | {"accept-encoding": "identity"},
                content=body if body else None,
            )
    except httpx.HTTPError:
        html = (
            "<!DOCTYPE html><html><body style='font-family:system-ui;padding:2rem'>"
            "<h1>LDBG unavailable</h1>"
            "<p>The Landscape Design Board Generator service is not running.</p>"
            "<p>On the server: <code>sudo systemctl start ldbg</code></p>"
            "<p>Local dev: <code>cd ldbg && npm run dev</code> (or build + start on port 3002)</p>"
            "</body></html>"
        )
        return Response(content=html, status_code=503, media_type="text/html")

    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=_filter_headers(upstream.headers),
    )


@router.api_route("/ldbg", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
async def ldbg_root(request: Request) -> Response:
    return await _proxy(request, "")


@router.api_route(
    "/ldbg/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
)
async def ldbg_path(request: Request, path: str) -> Response:
    return await _proxy(request, path)


@router.get("/ldbg.html", include_in_schema=False)
async def ldbg_legacy() -> Response:
    return Response(status_code=301, headers={"Location": "/ldbg"})
