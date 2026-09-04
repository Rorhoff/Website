#!/usr/bin/env python3
"""Pack loose PNG frames into Aseprite json-array atlases for MotherWyrm TV."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
FRAMES = ROOT / "src" / "frames"
BUILD = ROOT / "build"
PUBLIC = ROOT / ".." / "tv" / "public" / "assets"

MOTHER_TAGS: list[tuple[str, str]] = [
    ("idle", "idle"),
    ("flap", "idle"),
    ("dive", "dive"),
    ("claw", "bite"),
    ("hurt", "idle"),
    ("death", "idle"),
]

WYRM_TAGS: list[tuple[str, str]] = [
    ("idle", "idle"),
    ("charge", "charge"),
    ("recoil", "recoil"),
]

WHELP_TAGS: list[tuple[str, str]] = [
    ("idle", "idle"),
    ("run", "idle"),
    ("jump", "idle"),
    ("fall", "idle"),
    ("punt", "idle"),
    ("stun", "idle"),
    ("death", "idle"),
]


def load_frame(folder: str, name: str) -> Image.Image:
    path = FRAMES / folder / f"{name}.png"
    if not path.exists():
        raise FileNotFoundError(path)
    return Image.open(path).convert("RGBA")


def pack_atlas(
    atlas_key: str,
    folder: str,
    tag_map: list[tuple[str, str]],
) -> None:
    unique: list[tuple[str, Image.Image]] = []
    seen: dict[str, int] = {}

    for _tag, src in tag_map:
        if src not in seen:
            seen[src] = len(unique)
            unique.append((src, load_frame(folder, src)))

    fw = max(im.size[0] for _, im in unique)
    fh = max(im.size[1] for _, im in unique)
    sheet = Image.new("RGBA", (fw * len(unique), fh), (0, 0, 0, 0))

    frames_json: list[dict] = []
    src_index: dict[str, int] = {}

    for i, (src, im) in enumerate(unique):
        pad_x = (fw - im.size[0]) // 2
        pad_y = (fh - im.size[1]) // 2
        ox = i * fw + pad_x
        oy = pad_y
        sheet.paste(im, (ox, oy), im)
        src_index[src] = i
        frames_json.append(
            {
                "filename": f"{atlas_key}_{src}",
                "frame": {"x": ox, "y": oy, "w": im.size[0], "h": im.size[1]},
                "rotated": False,
                "trimmed": True,
                "spriteSourceSize": {"x": pad_x, "y": pad_y, "w": im.size[0], "h": im.size[1]},
                "sourceSize": {"w": fw, "h": fh},
                "duration": 100,
            }
        )

    frame_tags: list[dict] = []
    for tag, src in tag_map:
        idx = src_index[src]
        frame_tags.append(
            {
                "name": f"{atlas_key}_{tag}",
                "from": idx,
                "to": idx,
                "direction": "forward",
                "color": "#000000ff",
            }
        )

    BUILD.mkdir(parents=True, exist_ok=True)
    sheet.save(BUILD / f"{atlas_key}.png")

    meta = {
        "frames": frames_json,
        "meta": {
            "app": "https://www.aseprite.org/",
            "version": "1.3",
            "format": "RGBA8888",
            "size": {"w": fw * len(unique), "h": fh},
            "scale": "1",
            "frameTags": frame_tags,
        },
    }
    (BUILD / f"{atlas_key}.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"OK  {atlas_key} ({len(unique)} unique frames, {len(tag_map)} tags)")


def main() -> None:
    pack_atlas("mother_blue", "mother_blue", MOTHER_TAGS)
    pack_atlas("mother_red", "mother_red", MOTHER_TAGS)
    pack_atlas("whelp_blue", "whelp_blue", WHELP_TAGS)
    pack_atlas("whelp_red", "whelp_red", WHELP_TAGS)
    pack_atlas("wyrm", "wyrm", WYRM_TAGS)

    PUBLIC.mkdir(parents=True, exist_ok=True)
    for ext in ("png", "json"):
        for path in BUILD.glob(f"*.{ext}"):
            if path.stem in {
                "mother_blue",
                "mother_red",
                "whelp_blue",
                "whelp_red",
                "wyrm",
            }:
                dest = PUBLIC / path.name
                dest.write_bytes(path.read_bytes())
                print(f"COPY {dest.relative_to(ROOT.parent)}")


if __name__ == "__main__":
    main()
