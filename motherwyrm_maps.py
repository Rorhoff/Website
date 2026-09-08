"""MotherWyrm — map draft save and publish API for the map builder + TV lobby."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

router = APIRouter(tags=["motherwyrm-maps"])

MAPS_ROOT = Path(__file__).resolve().parent / "data" / "mw" / "maps"
DRAFTS_DIR = MAPS_ROOT / "drafts"
PUBLISHED_DIR = MAPS_ROOT / "published"
ASSETS_DIR = MAPS_ROOT / "assets"

SPRITE_SLOTS = frozenset({
    "mother_blue_idle",
    "mother_blue_dive",
    "mother_blue_claw",
    "mother_red_idle",
    "mother_red_dive",
    "mother_red_claw",
    "whelp_blue",
    "whelp_red",
    "wyrm",
})

_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$", re.IGNORECASE)


def _ensure_dirs() -> None:
    DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
    PUBLISHED_DIR.mkdir(parents=True, exist_ok=True)
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)


def _safe_sprite_slot(slot: str) -> str:
    if slot not in SPRITE_SLOTS:
        raise HTTPException(status_code=400, detail=f"Unknown sprite slot '{slot}'.")
    return slot


def _sprite_dir(map_id: str) -> Path:
    return ASSETS_DIR / _safe_id(map_id)


def _sprite_path(map_id: str, slot: str) -> Path:
    return _sprite_dir(map_id) / f"{_safe_sprite_slot(slot)}.png"


def _sprite_public_url(map_id: str, slot: str) -> str:
    return f"/api/mw/maps/{_safe_id(map_id)}/sprites/{_safe_sprite_slot(slot)}.png"


def _safe_id(map_id: str) -> str:
    mid = map_id.strip()
    if not mid or not _ID_RE.fullmatch(mid):
        raise HTTPException(status_code=400, detail="Invalid map id (use letters, numbers, -, _).")
    return mid


def _validate_map_body(body: dict[str, Any]) -> dict[str, Any]:
    if body.get("version") != 1:
        raise HTTPException(status_code=400, detail="Unsupported map version.")
    for key in ("id", "name", "platforms", "gemSeams", "hoardSlots", "wyrmPath", "spawns"):
        if key not in body:
            raise HTTPException(status_code=400, detail=f'Missing required field "{key}".')
    if not str(body.get("id", "")).strip():
        raise HTTPException(status_code=400, detail="Map id is empty.")
    if not str(body.get("name", "")).strip():
        raise HTTPException(status_code=400, detail="Map name is empty.")
    if not isinstance(body["platforms"], list):
        raise HTTPException(status_code=400, detail="platforms must be an array.")
    if not isinstance(body["gemSeams"], list):
        raise HTTPException(status_code=400, detail="gemSeams must be an array.")
    hoard = body["hoardSlots"]
    if not isinstance(hoard, dict) or not isinstance(hoard.get("blue"), list) or not isinstance(hoard.get("red"), list):
        raise HTTPException(status_code=400, detail="hoardSlots.blue/red must be arrays.")
    wp = body["wyrmPath"]
    if not isinstance(wp, dict):
        raise HTTPException(status_code=400, detail="wyrmPath must be an object.")
    for k in ("left", "right", "y", "finishHeight"):
        if not isinstance(wp.get(k), (int, float)):
            raise HTTPException(status_code=400, detail=f"wyrmPath.{k} must be a number.")
    return body


def _read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=f"Could not read map file: {exc}") from exc


def _write_json(path: Path, body: dict[str, Any]) -> None:
    path.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")


@router.get("/api/mw/maps")
def list_published_maps() -> dict[str, Any]:
    """List published maps for the TV lobby and random pool."""
    _ensure_dirs()
    maps: list[dict[str, Any]] = []
    for path in sorted(PUBLISHED_DIR.glob("*.json")):
        data = _read_json(path)
        maps.append(
            {
                "id": data.get("id", path.stem),
                "name": data.get("name", path.stem),
                "excludeFromRandom": bool(data.get("excludeFromRandom")),
            }
        )
    return {"maps": maps}


@router.get("/api/mw/maps/{map_id}")
def get_map(map_id: str) -> dict[str, Any]:
    """Return a published map, or a draft if not yet published."""
    _ensure_dirs()
    mid = _safe_id(map_id)
    pub = PUBLISHED_DIR / f"{mid}.json"
    if pub.exists():
        return _read_json(pub)
    draft = DRAFTS_DIR / f"{mid}.json"
    if draft.exists():
        return _read_json(draft)
    raise HTTPException(status_code=404, detail="Map not found.")


@router.post("/api/mw/maps/save")
def save_draft(body: dict[str, Any]) -> dict[str, Any]:
    """Save a map draft (builder Save button)."""
    _ensure_dirs()
    data = _validate_map_body(body)
    mid = _safe_id(str(data["id"]))
    data["id"] = mid
    _write_json(DRAFTS_DIR / f"{mid}.json", data)
    return {"ok": True, "id": mid, "status": "draft"}


@router.post("/api/mw/maps/{map_id}/publish")
def publish_map(map_id: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    """Publish a map so it appears in the TV lobby and random rotation."""
    _ensure_dirs()
    mid = _safe_id(map_id)
    if body:
        data = _validate_map_body(body)
        if _safe_id(str(data["id"])) != mid:
            raise HTTPException(status_code=400, detail="URL map id does not match body id.")
    else:
        draft = DRAFTS_DIR / f"{mid}.json"
        if not draft.exists():
            raise HTTPException(status_code=404, detail="No draft to publish — save first.")
        data = _validate_map_body(_read_json(draft))
    data["id"] = mid
    _write_json(PUBLISHED_DIR / f"{mid}.json", data)
    return {"ok": True, "id": mid, "status": "published", "name": data.get("name", mid)}


@router.get("/api/mw/maps/{map_id}/sprites/{slot}.png")
def get_sprite_png(map_id: str, slot: str) -> FileResponse:
    """Serve a custom character PNG uploaded for this map."""
    _ensure_dirs()
    path = _sprite_path(map_id, slot.replace(".png", ""))
    if not path.exists():
        raise HTTPException(status_code=404, detail="Sprite not found.")
    return FileResponse(path, media_type="image/png")


@router.post("/api/mw/maps/{map_id}/sprites/{slot}")
async def upload_sprite(map_id: str, slot: str, file: UploadFile = File(...)) -> dict[str, Any]:
    """Upload a PNG to replace a mother, whelp, or wyrm preview for this map."""
    _ensure_dirs()
    mid = _safe_id(map_id)
    slot_name = _safe_sprite_slot(slot)
    if file.content_type not in ("image/png", "application/octet-stream"):
        raise HTTPException(status_code=400, detail="Sprite must be a PNG file.")
    data = await file.read()
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise HTTPException(status_code=400, detail="Sprite must be a PNG file.")
    if len(data) > 4 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Sprite PNG must be under 4 MB.")
    dest_dir = _sprite_dir(mid)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{slot_name}.png"
    dest.write_bytes(data)
    url = _sprite_public_url(mid, slot_name)
    return {"ok": True, "slot": slot_name, "url": url}


@router.delete("/api/mw/maps/{map_id}/sprites/{slot}")
def delete_sprite(map_id: str, slot: str) -> dict[str, bool]:
    """Remove a custom sprite PNG for this map."""
    _ensure_dirs()
    path = _sprite_path(map_id, slot)
    if path.exists():
        path.unlink()
    return {"ok": True}
