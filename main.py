"""
Web API playground: production mode uses PostgreSQL + bcrypt for secrets and httpOnly sessions for the browser.

Developer notes (manual edits):
- Environment: DATABASE_URL (Postgres), CORS_ORIGINS, SESSION_HOURS, SESSION_COOKIE_SECURE,
  APP_ENV, optional API_KEY/API_SECRET when DATABASE_URL is unset (in-memory credentials).
- Authentication: API tools use X-API-Key + X-API-Secret; browser dashboard uses POST /api/session/login
  then the httpOnly cookie (see credential_service.COOKIE_NAME).
- Adding HTTP routes: define handlers on ``app``; use Depends(authenticate) unless the route is public.
- Static sites: files live under static/; each SPA gets an app.mount(...) — mirror that pattern for new pages.
- Classifieds REST API: implemented in classifieds_routes.py (prefix /api/classifieds), not in this file.
"""

from __future__ import annotations

import logging
import os
import sys
import time
from collections import Counter, deque
from contextlib import asynccontextmanager
from pathlib import Path
from threading import Lock
from typing import Annotated, Any

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, Field

import credential_service
from classifieds_routes import router as classifieds_router
from credential_service import COOKIE_NAME

load_dotenv()

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
        "http://127.0.0.1:8000,http://localhost:8000",
    )
    return [o.strip() for o in raw.split(",") if o.strip()]


def _log_initial_credentials(api_key: str, api_secret: str) -> None:
    if os.getenv("APP_ENV", "development") == "production":
        log.warning("API credentials initialized (values not printed in production).")
        return
    log.warning(
        "Initial credentials (Postman headers): X-API-Key=%s | X-API-Secret=%s",
        api_key,
        api_secret,
    )
    print(
        "\n[webapi-testing] Copy into Postman (Headers). For the dashboard, use “Save in browser” "
        "(DB mode) or paste each visit (memory mode).\n"
        f"  X-API-Key:    {api_key}\n"
        f"  X-API-Secret: {api_secret}\n",
        file=sys.stderr,
        flush=True,
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
    credential_service.create_tables()
    new_creds = credential_service.init_credentials()
    if new_creds:
        _log_initial_credentials(new_creds["api_key"], new_creds["api_secret"])
    yield


app = FastAPI(
    title="Web API Testing",
    description=(
        "Production: secrets stored as bcrypt hashes in PostgreSQL; browser uses httpOnly cookies after "
        "/api/session/login. Postman uses X-API-Key / X-API-Secret. Rotate invalidates sessions."
    ),
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

# --- Cross-origin and per-request analytics middleware ---


@app.middleware("http")
async def analytics_middleware(request: Request, call_next):
    start = time.perf_counter()
    client = request.client.host if request.client else None
    path = request.url.path
    query = request.url.query
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    if not (request.method == "GET" and path == "/api/analytics"):
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


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
app.mount("/assets", StaticFiles(directory=str(STATIC_DIR)), name="assets")
app.mount(
    "/classifieds",
    StaticFiles(directory=str(STATIC_DIR / "classifieds"), html=True),
    name="classifieds",
)
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


def _static(name: str) -> FileResponse:
    return FileResponse(STATIC_DIR / name)


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


# --- Local dev entrypoint ---


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
