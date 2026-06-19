"""
Web API playground: production mode uses PostgreSQL + bcrypt for secrets and httpOnly sessions for the browser.

Developer notes (manual edits):
- Environment: DATABASE_URL (Postgres), CORS_ORIGINS, SESSION_HOURS, SESSION_COOKIE_SECURE,
  APP_ENV, optional API_KEY/API_SECRET when DATABASE_URL is unset (in-memory credentials).
- HTTPS: behind nginx/SSL, set CORS_ORIGINS to https:// your origins and SESSION_COOKIE_SECURE=1.
  Optional unauthenticated liveness: GET /health (for load balancers; GET /api/health remains authenticated).
- API key and secret are never written to application logs. Configure API_KEY and API_SECRET in the environment.
- ``.env`` is loaded from the same directory as this file (e.g. EC2: ``/home/ubuntu/Website/.env``). For systemd, also set
  ``EnvironmentFile=/home/ubuntu/Website/.env`` and ``WorkingDirectory=/home/ubuntu/Website`` to match.
- Authentication: API tools use X-API-Key + X-API-Secret; browser dashboard uses POST /api/session/login
  then the httpOnly cookie (see credential_service.COOKIE_NAME).
- Adding HTTP routes: define handlers on ``app``; use Depends(authenticate) unless the route is public.
- Static sites: files live under static/; each SPA gets an app.mount(...) — mirror that pattern for new pages
  (e.g. /airevolution/ → static/airevolution/).
- Classifieds REST API: implemented in classifieds_routes.py (prefix /api/classifieds), not in this file.
"""

from __future__ import annotations

import html as html_module
import logging
import os
import re
import time
from urllib.parse import quote
from collections import Counter, deque
from contextlib import asynccontextmanager
from pathlib import Path
from threading import Lock
from typing import Annotated, Any

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, Field
import credential_service
from airevolution_routes import router as airevolution_router
from classifieds_routes import router as classifieds_router
from sss_routes import router as sss_router
from t1prod_routes import router as t1prod_router
from t1referrall_routes import router as referr_all_router
from credential_service import COOKIE_NAME

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

# Honor ENV_FILE so the same code can run as the dev systemd service (.env.dev) and the
# prod systemd service (.env.prod) on the same EC2 box. Falls back to .env for local dev.
_env_file_override = os.environ.get("ENV_FILE")
load_dotenv(_env_file_override if _env_file_override else BASE_DIR / ".env")
APP_ENV = os.getenv("APP_ENV", "unknown")

# SERVICE_MODE = "full"        -> everything (portfolio root + all SPAs + all routers)
# SERVICE_MODE = "classifieds" -> only classifieds router + classifieds SPA at "/"
# SERVICE_MODE = "referrall"   -> only Referr-All router + Referr-All SPA at "/"
# The lean modes back the per-domain prod services (t1classifieds.com :8001,
# referr-all.com :8002) so each process is small and "/" serves its SPA directly
# with no redirect dance.
SERVICE_MODE = os.getenv("SERVICE_MODE", "full").lower()
_CLASSIFIEDS_ONLY = SERVICE_MODE == "classifieds"
_REFERR_ALL_ONLY = SERVICE_MODE == "referrall"

log = logging.getLogger("webapi-testing")

START_TIME = time.monotonic()
RECENT_LIMIT = 200

_lock = Lock()
_total = 0
_by_method: Counter[str] = Counter()
_by_status: Counter[int] = Counter()
_by_path: Counter[str] = Counter()
_recent: deque[dict[str, Any]] = deque(maxlen=RECENT_LIMIT)

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
_api_secret_header = APIKeyHeader(name="X-API-Secret", auto_error=False)

# --- Config & logging helpers ---


def _cors_origins() -> list[str]:
    raw = os.getenv(
        "CORS_ORIGINS",
        "http://127.0.0.1:8000,http://localhost:8000,"
        "http://127.0.0.1:8001,http://localhost:8001",
    )
    return [o.strip() for o in raw.split(",") if o.strip()]


def _log_initial_credentials() -> None:
    """Do not log API key or secret values (security)."""
    log.warning(
        "API credentials are ready. Key and secret are never written to application logs. "
        "Set API_KEY and API_SECRET in the .env file next to main.py, or use an authenticated "
        "rotation or health exchange to obtain a new pair."
    )


# --- HTTP authentication (header pair or session cookie) ---


def authenticate(
    request: Request,
    x_api_key: Annotated[str | None, Depends(_api_key_header)],
    x_api_secret: Annotated[str | None, Depends(_api_secret_header)],
) -> None:
    credential_service.purge_expired_sessions()
    if credential_service.verify_headers(x_api_key, x_api_secret):
        return
    token = request.cookies.get(COOKIE_NAME)
    if credential_service.verify_session_token(token):
        return
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing or invalid authentication (headers or session cookie)",
        headers={"WWW-Authenticate": "ApiKey"},
    )


# --- In-memory request analytics (dashboard: GET /api/analytics) ---


def _record_request(
    method: str,
    path: str,
    status_code: int,
    duration_ms: float,
    client: str | None,
    query: str,
) -> None:
    global _total, _by_method, _by_status, _by_path, _recent
    with _lock:
        _total += 1
        _by_method[method] += 1
        _by_status[status_code] += 1
        _by_path[path] += 1
        _recent.appendleft(
            {
                "time_iso": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()),
                "method": method,
                "path": path,
                "query": query or None,
                "status": status_code,
                "duration_ms": round(duration_ms, 2),
                "client": client,
            }
        )


# --- Application lifespan (DB tables + API credentials on startup) ---


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Printed once per process — compare with the URL bar port if routes 404 in the browser.
    print(
        f"[webapi-testing] main.py: {Path(__file__).resolve()}",
        flush=True,
    )
    credential_service.create_tables()
    new_creds = credential_service.init_credentials()
    if new_creds:
        _log_initial_credentials()
    yield


app = FastAPI(
    title="Web API Testing",
    description="",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(classifieds_router)
if _REFERR_ALL_ONLY:
    # referr-all.com: only the Referr-All API is mounted.
    app.include_router(referr_all_router)
elif not _CLASSIFIEDS_ONLY:
    app.include_router(airevolution_router)
    app.include_router(sss_router)
    app.include_router(t1prod_router)
    app.include_router(referr_all_router)

# --- Product-domain HTML (hide portfolio nav on t1airevolution.com) ---

_PRODUCT_HOST_DOMAINS = frozenset({"t1airevolution.com", "www.t1airevolution.com"})
_HTML_OPEN = re.compile(r"(<html\b[^>]*)(>)", re.IGNORECASE)


def _request_product_host(request: Request) -> str | None:
    host = (request.headers.get("host") or "").split(":")[0].lower()
    if host in _PRODUCT_HOST_DOMAINS:
        return "t1airevolution"
    return None


def _inject_product_host_html(html: str, host_key: str) -> str:
    if "data-product-host" in html:
        return html

    def repl(match: re.Match[str]) -> str:
        tag = match.group(1)
        if "data-product-host" in tag:
            return match.group(0)
        return f'{tag} data-product-host="{host_key}"{match.group(2)}'

    return _HTML_OPEN.sub(repl, html, count=1)


# --- Cross-origin and per-request analytics middleware ---


@app.middleware("http")
async def product_host_html_middleware(request: Request, call_next):
    """Inject data-product-host on HTML when Host is a product domain (not rorhoff.com)."""
    product_host = _request_product_host(request)
    response = await call_next(request)
    if product_host is None:
        return response
    content_type = (response.headers.get("content-type") or "").lower()
    if "text/html" not in content_type:
        return response
    body = b""
    async for chunk in response.body_iterator:
        body += chunk
    try:
        html = body.decode("utf-8")
    except UnicodeDecodeError:
        return Response(
            content=body,
            status_code=response.status_code,
            headers=dict(response.headers),
        )
    html = _inject_product_host_html(html, product_host)
    headers = {
        k: v
        for k, v in response.headers.items()
        if k.lower() not in ("content-length", "content-encoding")
    }
    return HTMLResponse(content=html, status_code=response.status_code, headers=headers)


@app.middleware("http")
async def referr_all_legacy_rewrite(request: Request, call_next):
    """Keep /api/t1referrall working for Stripe webhooks and cached clients."""
    path = request.url.path
    if path == "/api/t1referrall" or path.startswith("/api/t1referrall/"):
        suffix = path[len("/api/t1referrall") :]
        request.scope["path"] = f"/api/referr-all{suffix}"
    return await call_next(request)


@app.middleware("http")
async def spa_shell_cache_middleware(request: Request, call_next):
    """SPA shell (index.html) must not be cached long-term — hashed /assets/* can be."""
    response = await call_next(request)
    path = request.url.path
    if _REFERR_ALL_ONLY:
        # referr-all.com serves the SPA from the domain root (base "/").
        if path in ("/", "/index.html"):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
        elif path.startswith("/assets/"):
            response.headers.setdefault("Cache-Control", "public, max-age=31536000, immutable")
        return response
    if path in ("/referr-all", "/referr-all/", "/referr-all/index.html"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    elif path.startswith("/referr-all/assets/"):
        response.headers.setdefault("Cache-Control", "public, max-age=31536000, immutable")
    return response


_REFERR_ALL_CSP = (
    "default-src 'self'; "
    "script-src 'self' https://www.googletagmanager.com https://www.google-analytics.com https://static.cloudflareinsights.com; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: https: blob:; "
    "font-src 'self' data:; "
    "connect-src 'self' blob: https://www.google-analytics.com https://analytics.google.com https://*.google-analytics.com https://cloudflareinsights.com; "
    "manifest-src 'self'; "
    "worker-src 'self'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)


@app.middleware("http")
async def referr_all_security_headers(request: Request, call_next):
    """Security headers for Referr-All (SPA + API). Scoped so other apps are untouched.

    On referr-all.com (SERVICE_MODE=referrall) the entire service is Referr-All, so the
    headers apply to every path; otherwise they are limited to the /referr-all* subtree.
    """
    response = await call_next(request)
    path = request.url.path
    if _REFERR_ALL_ONLY or path.startswith("/referr-all") or path.startswith("/api/referr-all"):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Permissions-Policy", "geolocation=(), microphone=(), camera=()"
        )
        # CSP on SPA/document + asset responses, not the JSON API or plain-text probes.
        if _REFERR_ALL_ONLY:
            if not path.startswith(("/api/", "/which-app", "/health")):
                response.headers.setdefault("Content-Security-Policy", _REFERR_ALL_CSP)
        elif path.startswith("/referr-all"):
            response.headers.setdefault("Content-Security-Policy", _REFERR_ALL_CSP)
    return response


@app.middleware("http")
async def analytics_middleware(request: Request, call_next):
    start = time.perf_counter()
    client = request.client.host if request.client else None
    path = request.url.path
    query = request.url.query
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    if not (
        request.method == "GET" and path in ("/api/analytics", "/health", "/which-app")
    ):
        _record_request(
            request.method,
            path,
            response.status_code,
            duration_ms,
            client,
            query,
        )
    return response


# --- Shared request/response models ---


class EchoBody(BaseModel):
    message: str = Field(default="hello", max_length=4000)
    tags: list[str] = Field(default_factory=list)


class SessionLoginBody(BaseModel):
    api_key: str = Field(min_length=8, max_length=256)
    api_secret: str = Field(min_length=8, max_length=256)


# --- Public liveness (SSL/load balancer, no auth) ---


@app.get("/which-app", include_in_schema=False)
def which_app() -> PlainTextResponse:
    """Plain text so you can confirm the browser is talking to this repo (not another app on the port)."""
    return PlainTextResponse(
        "webapi-testing\n"
        f"APP_ENV={APP_ENV}\n"
        f"SERVICE_MODE={SERVICE_MODE}\n"
        f"ENV_FILE={_env_file_override or str(BASE_DIR / '.env')}\n"
        f"{Path(__file__).resolve()}\n"
        "No extra path — use /which-app not /which-app/main.py\n"
        "If Cursor’s Simple Browser shows connection refused, use Chrome/Edge for localhost.\n"
    )


@app.get("/which-app/{rest:path}", include_in_schema=False)
def which_app_mistake(rest: str) -> PlainTextResponse:
    return PlainTextResponse(
        "Use exactly: /which-app   (nothing after the last word — not /main.py)\n"
        f"Your path had: {rest!r}\n"
        "Example: http://127.0.0.1:8000/which-app  (port must match uvicorn)\n",
        status_code=404,
    )


@app.get("/health", tags=["health"])
def health_liveness() -> dict[str, str]:
    return {
        "status": "ok",
        "main_py": str(Path(__file__).resolve()),
        "app_env": APP_ENV,
        "service_mode": SERVICE_MODE,
    }


# --- Browser session cookie (dashboard “Save in browser”) ---


@app.post("/api/session/login")
def session_login(response: Response, body: SessionLoginBody):
    if not credential_service.database_enabled():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="DATABASE_URL not set; use X-API-Key / X-API-Secret headers only.",
        )
    if not credential_service.verify_headers(body.api_key, body.api_secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token, expires = credential_service.create_browser_session()
    secure = os.getenv("SESSION_COOKIE_SECURE", "0") == "1"
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=secure,
        samesite="lax",
        max_age=credential_service.SESSION_HOURS * 3600,
        path="/",
    )
    return {"ok": True, "expires_at": expires.isoformat()}


@app.post("/api/session/logout")
def session_logout(request: Request, response: Response):
    credential_service.delete_session_token(request.cookies.get(COOKIE_NAME))
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


# --- Authenticated demo API (Postman / dashboard) ---


@app.get("/api/health", dependencies=[Depends(authenticate)])
def health(exchange: bool = False):
    out: dict[str, Any] = {
        "status": "ok",
        "uptime_s": round(time.monotonic() - START_TIME, 2),
        "database": credential_service.database_enabled(),
    }
    if exchange:
        creds = credential_service.rotate_credentials()
        out["credentials"] = creds
        out["note"] = (
            "Use credentials.api_key and credentials.api_secret on all following requests. "
            "Previous headers and browser sessions are invalidated."
        )
    return out


@app.get(
    "/api/credentials/rotate",
    dependencies=[Depends(authenticate)],
    summary="Rotate API key and secret",
)
def rotate_credentials_endpoint():
    creds = credential_service.rotate_credentials()
    return {
        **creds,
        "note": "Use these values as X-API-Key and X-API-Secret on your next requests.",
    }


@app.get("/api/analytics", dependencies=[Depends(authenticate)])
def get_analytics():
    with _lock:
        return {
            "server": {
                "uptime_s": round(time.monotonic() - START_TIME, 2),
                "started_at_unix": int(time.time() - (time.monotonic() - START_TIME)),
            },
            "totals": {
                "requests": _total,
                "by_method": dict(_by_method),
                "by_status": {str(k): v for k, v in _by_status.items()},
                "top_paths": _by_path.most_common(15),
            },
            "recent": list(_recent),
        }


@app.post("/api/echo", dependencies=[Depends(authenticate)])
def echo(body: EchoBody):
    return {
        "received": body.model_dump(),
        "echo": body.message,
    }


@app.get("/api/items/{item_id}", dependencies=[Depends(authenticate)])
def get_item(item_id: int, detail: bool = False):
    return {
        "item_id": item_id,
        "detail": detail,
        "name": f"Item {item_id}",
    }


@app.post("/api/items", dependencies=[Depends(authenticate)])
def create_item(payload: dict[str, Any]):
    return {"created": True, "payload": payload}


@app.delete("/api/items/{item_id}", dependencies=[Depends(authenticate)])
def delete_item(item_id: int):
    return {"deleted": True, "item_id": item_id}


@app.get("/api/slow", dependencies=[Depends(authenticate)])
def slow(delay_ms: int = 500):
    delay_ms = max(0, min(delay_ms, 10_000))
    time.sleep(delay_ms / 1000)
    return {"waited_ms": delay_ms}


# --- Static files: site root + mounted SPAs (paths must match nav links in static HTML) ---

def _static(name: str) -> FileResponse:
    return FileResponse(STATIC_DIR / name)


# Prod SPA is served from `/` with data-service-mode injected. The `/classifieds/`
# StaticFiles mount would otherwise serve raw index.html (portfolio test nav visible).
if _CLASSIFIEDS_ONLY:
    _CLASSIFIEDS_HTML_ATTR = '<html lang="en" data-service-mode="classifieds">'

    def _classifieds_prod_html(path: str) -> str:
        return (STATIC_DIR / "classifieds" / path).read_text(encoding="utf-8").replace(
            '<html lang="en">', _CLASSIFIEDS_HTML_ATTR, 1
        )

    _CLASSIFIEDS_INDEX_PROD = _classifieds_prod_html("index.html")
    _CLASSIFIEDS_RESET_PROD = _classifieds_prod_html("reset.html")
    _CLASSIFIEDS_FAVICON = STATIC_DIR / "classifieds" / "favicon.png"

    @app.get("/classifieds", include_in_schema=False)
    @app.get("/classifieds/", include_in_schema=False)
    @app.get("/classifieds/index.html", include_in_schema=False)
    def classifieds_spa_path_redirect_to_root(request: Request) -> RedirectResponse:
        q = request.url.query
        return RedirectResponse("/" + (f"?{q}" if q else ""), status_code=301)

    @app.get("/classifieds/reset.html", include_in_schema=False)
    def classifieds_reset_prod() -> HTMLResponse:
        return HTMLResponse(_CLASSIFIEDS_RESET_PROD)


# In referrall mode the Referr-All SPA owns the domain root (and its own /assets),
# so the portfolio /assets and /classifieds mounts must not be registered.
if not _REFERR_ALL_ONLY:
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR)), name="assets")
    app.mount(
        "/classifieds",
        StaticFiles(directory=str(STATIC_DIR / "classifieds"), html=True),
        name="classifieds",
    )

_LEGAL_TERMS_PDF = STATIC_DIR / "classifieds" / "legal" / "terms.pdf"
_LEGAL_PRIVACY_PDF = STATIC_DIR / "classifieds" / "legal" / "privacy.pdf"


@app.get("/terms", include_in_schema=False)
def legal_terms_pdf() -> FileResponse:
    """Short URL for ToS PDF (signup links and footer on t1classifieds.com)."""
    if not _LEGAL_TERMS_PDF.is_file():
        raise HTTPException(status_code=404, detail="Terms of Service not found")
    return FileResponse(
        _LEGAL_TERMS_PDF,
        media_type="application/pdf",
        filename="t1Classifieds_Terms_of_Service.pdf",
    )


@app.get("/privacy", include_in_schema=False)
def legal_privacy_pdf() -> FileResponse:
    if not _LEGAL_PRIVACY_PDF.is_file():
        raise HTTPException(status_code=404, detail="Privacy Policy not found")
    return FileResponse(
        _LEGAL_PRIVACY_PDF,
        media_type="application/pdf",
        filename="t1Classifieds_Privacy_Policy.pdf",
    )


# --- SEO surfaces: robots.txt + sitemap.xml -------------------------------
#
# We want Googlebot to be able to crawl and index t1classifieds.com (prod)
# but NOT rorhoff.com/classifieds (dev) — same content otherwise competes
# with itself in search results and dilutes our authority. The robots policy
# is therefore branch-aware:
#
#   - classifieds-only mode (prod):   index everything, point to /sitemap.xml
#   - full mode (dev):                disallow /classifieds entirely
#
# The sitemap is generated on demand from the live DB so newly posted ads
# show up the next time a crawler fetches it. Each entry's <loc> is the
# canonical share URL the SPA already uses (/?ad=<id>) — Googlebot follows
# query-string URLs fine, and the dynamic <title>/<meta description> set in
# app.js will give each ad a distinct, state+title-keyed snippet.

def _canonical_host() -> str:
    """Best-effort canonical host for SEO surfaces.

    Defaults to t1classifieds.com in prod (classifieds-only) and rorhoff.com
    everywhere else. Override with SITE_ORIGIN in .env if you ever need to
    point sitemap entries at a different domain (staging, preview, etc.).
    """
    override = os.getenv("SITE_ORIGIN", "").strip().rstrip("/")
    if override:
        return override
    return "https://t1classifieds.com" if _CLASSIFIEDS_ONLY else "https://rorhoff.com"


def _inject_prod_listing_seo(page_html: str, ad_id: str) -> str:
    """Inject per-listing title/description/canonical into the prod SPA shell.

    Without this, every ``/?ad=<id>`` URL ships with the homepage canonical in
    static HTML. Google then reports "Alternate page with proper canonical tag"
    for sitemap ad URLs. app.js still updates tags after load; crawlers that
    only parse the initial HTML need the correct values here.
    """
    host = _canonical_host()
    canonical_url = f"{host}/?ad={quote(ad_id, safe='')}"
    try:
        from classifieds_privacy import scrub_public_description
        from database import SessionLocal
        from models import ClassifiedAd
    except Exception:
        return page_html

    db = SessionLocal()
    try:
        row = db.get(ClassifiedAd, ad_id)
        if row is None:
            return page_html
        desc, _ = scrub_public_description(row.description)
        body_line = (desc or "").replace("\n", " ").strip()[:120]
        taxonomy = f"{row.category or ''} {row.sub_category or ''}".strip()
        location = (row.state or "").strip()
        if location:
            title = f"{row.title} — {location} | t1Classifieds"
        else:
            title = f"{row.title} | t1Classifieds"
        meta_desc = (
            f"{taxonomy + ' ' if taxonomy else ''}"
            f"{('in ' + location + '. ') if location else ''}"
            f"{body_line}"
        ).strip()[:300]
    finally:
        db.close()

    esc = html_module.escape

    def sub_one(pattern: str, repl: str, text: str) -> str:
        return re.sub(pattern, repl, text, count=1)

    page_html = sub_one(r"<title>[^<]*</title>", f"<title>{esc(title)}</title>", page_html)
    page_html = sub_one(
        r'(<meta name="description" content=")[^"]*(")',
        rf"\1{esc(meta_desc)}\2",
        page_html,
    )
    page_html = sub_one(
        r'(<link rel="canonical" href=")[^"]*(")',
        rf"\1{canonical_url}\2",
        page_html,
    )
    page_html = sub_one(
        r'(<meta property="og:title" content=")[^"]*(")',
        rf"\1{esc(title)}\2",
        page_html,
    )
    page_html = sub_one(
        r'(<meta property="og:description" content=")[^"]*(")',
        rf"\1{esc(meta_desc)}\2",
        page_html,
    )
    page_html = sub_one(
        r'(<meta property="og:url" content=")[^"]*(")',
        rf"\1{canonical_url}\2",
        page_html,
    )
    page_html = sub_one(
        r'(<meta name="twitter:title" content=")[^"]*(")',
        rf"\1{esc(title)}\2",
        page_html,
    )
    page_html = sub_one(
        r'(<meta name="twitter:description" content=")[^"]*(")',
        rf"\1{esc(meta_desc)}\2",
        page_html,
    )
    return page_html


@app.get("/robots.txt", include_in_schema=False)
def robots_txt() -> PlainTextResponse:
    host = _canonical_host()
    if _CLASSIFIEDS_ONLY:
        body = (
            "User-agent: *\n"
            "Allow: /\n"
            "Disallow: /api/\n"
            f"Sitemap: {host}/sitemap.xml\n"
        )
    else:
        # Dev: keep portfolio crawlable, but don't let Google index the dev
        # classifieds path — the same listings live on t1classifieds.com and
        # we don't want duplicate-content penalties or split authority.
        body = (
            "User-agent: *\n"
            "Allow: /\n"
            "Disallow: /classifieds\n"
            "Disallow: /api/\n"
        )
    return PlainTextResponse(body, media_type="text/plain")


@app.get("/sitemap.xml", include_in_schema=False)
def sitemap_xml() -> Response:
    """Sitemap listing the homepage, safety page, and every active classified ad.

    Gold-frame ads get a slightly higher <priority> so crawlers spend more
    budget on them; everything else uses the default 0.5. The sitemap is
    intentionally lightweight (no full descriptions) — its job is just to
    advertise URLs. The per-ad title/description SEO is injected by app.js
    when the page actually loads.
    """
    host = _canonical_host()
    # We only publish a sitemap in classifieds-only / prod mode. On dev the
    # robots.txt above already disallows /classifieds, so emitting a sitemap
    # there would be confusing/conflicting.
    if not _CLASSIFIEDS_ONLY:
        return Response(status_code=404)

    # Import lazily so this module still loads if classifieds models are
    # absent (e.g. DATABASE_URL unset in a smoke-test container).
    try:
        from database import SessionLocal  # type: ignore
        from models import ClassifiedAd  # type: ignore
    except Exception:  # pragma: no cover - missing-models defensive path
        SessionLocal = None  # type: ignore[assignment]
        ClassifiedAd = None  # type: ignore[assignment]

    urls: list[str] = []

    def add_url(loc: str, lastmod: str | None = None, priority: str = "0.5") -> None:
        parts = [f"  <url>", f"    <loc>{loc}</loc>"]
        if lastmod:
            parts.append(f"    <lastmod>{lastmod}</lastmod>")
        parts.append(f"    <priority>{priority}</priority>")
        parts.append("  </url>")
        urls.append("\n".join(parts))

    add_url(f"{host}/", priority="1.0")
    add_url(f"{host}/classifieds/safety.html", priority="0.4")
    add_url(f"{host}/classifieds/gold-policy.html", priority="0.35")
    add_url(f"{host}/terms", priority="0.3")
    add_url(f"{host}/privacy", priority="0.3")

    if SessionLocal is not None and ClassifiedAd is not None:
        try:
            db = SessionLocal()
            try:
                rows = db.query(ClassifiedAd).order_by(ClassifiedAd.created_at.desc()).all()
            finally:
                db.close()
            now_ms = time.time() * 1000
            for row in rows:
                gold_active = row.gold_until is not None and row.gold_until.timestamp() * 1000 > now_ms
                priority = "0.8" if gold_active else "0.6"
                lastmod = row.created_at.date().isoformat() if row.created_at else None
                add_url(f"{host}/?ad={row.id}", lastmod=lastmod, priority=priority)
        except Exception as exc:  # pragma: no cover - sitemap should never 500
            log.warning("sitemap.xml: failed to load ads (%s)", exc)

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(urls)
        + "\n</urlset>\n"
    )
    return Response(content=xml, media_type="application/xml")

if _CLASSIFIEDS_ONLY:
    # Prod (t1classifieds.com): "/" serves the classifieds SPA directly. Auxiliary SPAs
    # and the portfolio root are not registered, so prod is lean and "/" is unambiguous.
    # _CLASSIFIEDS_INDEX_PROD + redirect routes are defined above, before the static mount.

    @app.get("/favicon.ico", include_in_schema=False)
    @app.get("/favicon.png", include_in_schema=False)
    def classifieds_favicon_root() -> FileResponse:
        """Browsers request /favicon.ico at the site root; prod serves the SPA from `/`
        without a `/classifieds/` prefix, so expose the icon here as well."""
        return FileResponse(_CLASSIFIEDS_FAVICON, media_type="image/png")

    @app.get("/", include_in_schema=False)
    @app.get("/index.html", include_in_schema=False)
    def root_classifieds(request: Request) -> HTMLResponse:
        html = _CLASSIFIEDS_INDEX_PROD
        ad_id = (request.query_params.get("ad") or "").strip()
        if ad_id:
            html = _inject_prod_listing_seo(html, ad_id)
        return HTMLResponse(html)
elif _REFERR_ALL_ONLY:
    # referr-all.com: serve the Referr-All SPA (built with --base=/) from the domain root.
    # Inject data-service-mode so the portfolio cross-links in index.html stay hidden on prod
    # (same pattern as classifieds on t1classifieds.com).
    _REFERR_ALL_HTML_ATTR = '<html lang="en" data-service-mode="referrall">'
    _REFERR_ALL_INDEX_PROD = (
        (STATIC_DIR / "referr-all" / "index.html")
        .read_text(encoding="utf-8")
        .replace("<html lang=\"en\">", _REFERR_ALL_HTML_ATTR, 1)
    )

    # The SPA uses query-param routing (?reset_token=, ?verified=), so no path fallback
    # is needed — unknown paths legitimately 404.
    @app.get("/referr-all", include_in_schema=False)
    @app.get("/referr-all/", include_in_schema=False)
    @app.get("/referr-all/{rest:path}", include_in_schema=False)
    def referr_all_legacy_path_redirect(request: Request, rest: str = "") -> RedirectResponse:
        """Dev builds used /referr-all/ in Stripe success URLs; prod SPA lives at /."""
        qs = request.url.query
        return RedirectResponse(url=f"/?{qs}" if qs else "/", status_code=302)

    @app.get("/favicon.ico", include_in_schema=False)
    def referr_all_root_favicon_ico() -> FileResponse:
        icon = STATIC_DIR / "referr-all" / "favicon.svg"
        if not icon.is_file():
            raise HTTPException(status_code=404, detail="Not found")
        return FileResponse(icon, media_type="image/svg+xml")

    @app.get("/", include_in_schema=False)
    @app.get("/index.html", include_in_schema=False)
    def root_referr_all() -> HTMLResponse:
        if not (STATIC_DIR / "referr-all" / "index.html").is_file():
            raise HTTPException(status_code=503, detail="Referr-All build missing")
        return HTMLResponse(_REFERR_ALL_INDEX_PROD)

    # Static build output (/assets/*, /sw.js, /manifest.json, /icon*.svg, …). Mounted at
    # "/" and registered last, so the API routers, /health, /which-app and the routes
    # above all take precedence.
    app.mount(
        "/",
        StaticFiles(directory=str(STATIC_DIR / "referr-all"), html=True, check_dir=False),
        name="referr_all_root",
    )
else:
    # Dev / full mode (rorhoff.com): keep the portfolio + every other SPA reachable.
    _REFERR_ALL_FAVICON = STATIC_DIR / "referr-all" / "favicon.svg"

    @app.get("/favicon.ico", include_in_schema=False)
    def referr_all_root_favicon() -> FileResponse:
        """Browsers request /favicon.ico at the site root on every page load."""
        if not _REFERR_ALL_FAVICON.is_file():
            raise HTTPException(status_code=404, detail="Not found")
        return FileResponse(_REFERR_ALL_FAVICON, media_type="image/svg+xml")

    app.mount(
        "/api-testing",
        StaticFiles(directory=str(STATIC_DIR / "api-testing"), html=True),
        name="api_testing",
    )
    app.mount(
        "/lost-in-space",
        StaticFiles(directory=str(STATIC_DIR / "lost-in-space"), html=True),
        name="lost_in_space",
    )
    app.mount(
        "/airevolution",
        StaticFiles(directory=str(STATIC_DIR / "airevolution"), html=True),
        name="airevolution",
    )
    app.mount(
        "/referr-all",
        StaticFiles(directory=str(STATIC_DIR / "referr-all"), html=True),
        name="referr_all",
    )
    app.mount(
        "/t1-prod",
        StaticFiles(directory=str(STATIC_DIR / "t1-prod"), html=True),
        name="t1_prod",
    )

    @app.get("/")
    @app.get("/index.html")
    def root():
        return _static("index.html")

    @app.get("/api-testing.html")
    def api_testing_legacy():
        return RedirectResponse(url="/api-testing/", status_code=301)

    @app.get("/lost-in-space.html")
    def lost_in_space_legacy():
        return RedirectResponse(url="/lost-in-space/", status_code=301)

    @app.get("/referr-all", include_in_schema=False)
    def referr_all_redirect() -> RedirectResponse:
        return RedirectResponse(url="/referr-all/", status_code=301)

    @app.get("/t1-referrall", include_in_schema=False)
    @app.get("/t1-referrall/", include_in_schema=False)
    @app.get("/t1-referrall/{path:path}", include_in_schema=False)
    def t1_referrall_legacy_redirect(path: str = "") -> RedirectResponse:
        suffix = path.strip("/")
        url = f"/referr-all/{suffix}" if suffix else "/referr-all/"
        return RedirectResponse(url=url, status_code=301)

    @app.get("/t1-referral", include_in_schema=False)
    @app.get("/t1-referral/", include_in_schema=False)
    @app.get("/t1-referral/{path:path}", include_in_schema=False)
    def t1_referral_legacy_redirect(path: str = "") -> RedirectResponse:
        suffix = path.strip("/")
        url = f"/referr-all/{suffix}" if suffix else "/referr-all/"
        return RedirectResponse(url=url, status_code=301)

    @app.get("/sss")
    @app.get("/sss/")
    def sss_root():
        return _static("sss/index.html")

    @app.get("/sss/{path:path}")
    def sss_file(path: str):
        file_path = (STATIC_DIR / "sss" / path).resolve()
        sss_dir = (STATIC_DIR / "sss").resolve()
        if not str(file_path).startswith(str(sss_dir)) or not file_path.exists():
            raise HTTPException(status_code=404)
        return FileResponse(file_path)


# --- Local dev entrypoint ---


if __name__ == "__main__":
    import uvicorn

    _port = int(os.getenv("PORT", "8000"))
    uvicorn.run("main:app", host="127.0.0.1", port=_port, reload=True)
