#!/usr/bin/env python3
"""Acceptance checks for Addendum C watercolor filter (C7)."""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from watercolor import apply_watercolor, downscale_preview  # noqa: E402


def make_sample_ortho(w: int, h: int) -> np.ndarray:
    rng = np.random.default_rng(0)
    img = np.zeros((h, w, 3), dtype=np.uint8)
    for y in range(h):
        for x in range(w):
            img[y, x] = [
                (x * 255 // w),
                (y * 255 // h),
                ((x + y) * 128 // (w + h)) % 256,
            ]
    noise = rng.integers(0, 30, (h, w, 3), dtype=np.uint8)
    return np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)


def main() -> int:
    params = json.loads(
        (ROOT / "src" / "config" / "watercolor.ts").read_text(encoding="utf-8")
        if False
        else "{}"
    )
    # Inline watercolor-soft defaults (avoid TS parse)
    params = {
        "bilateral": {"d": 9, "sigmaColor": 75, "sigmaSpace": 75},
        "stylization": {"method": "stylization", "sigmaS": 60, "sigmaR": 0.45, "kuwaharaRadius": 5},
        "posterize": {"levels": 20},
        "hsv": {"saturationMultiplier": 1.15, "valueFloor": 0.12},
        "edgeDarkening": {"enabled": True, "opacity": 0.18, "cannyLow": 50, "cannyHigh": 150, "blurRadius": 3},
        "granulation": {"amplitude": 0.035, "seed": 42},
        "paperTexture": {"opacity": 0.14},
        "edgeFeather": {"marginFraction": 0.08, "noiseScale": 0.015, "seed": 7},
        "previewLongEdge": 2000,
    }

    paper = ROOT / "public" / "textures" / "paper-cold-press.jpg"
    if not paper.is_file():
        from generate_paper_texture import generate_paper_texture

        paper.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(generate_paper_texture(2048), mode="RGB").save(paper, quality=92)

    w, h = 1200, 800
    sample = make_sample_ortho(w, h)
    known_x, known_y = w // 3, h // 2

    rgba = apply_watercolor(sample, params, paper)
    out_h, out_w = rgba.shape[:2]
    if out_w != w or out_h != h:
        print(f"FAIL dimensions {out_w}x{out_h} != {w}x{h}")
        return 1

    rgb = rgba[:, :, :3]
    if np.any(np.all(rgb == 0, axis=2)):
        print("FAIL pure black pixels present")
        return 1

    alpha = rgba[:, :, 3]
    if alpha[known_y, known_x] < 200:
        print("FAIL center alpha too low")
        return 1
    if alpha[0, 0] >= alpha[known_y, known_x]:
        print("FAIL edge not feathered (corner alpha should be lower than center)")
        return 1

    preview = downscale_preview(rgba, 2000)
    if preview.shape[0] > h or preview.shape[1] > w:
        print("FAIL preview larger than source")
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.png"
        Image.fromarray(rgba, mode="RGBA").save(out)
        loaded = np.array(Image.open(out))
        if loaded.shape[0] != h or loaded.shape[1] != w:
            print("FAIL saved PNG dimensions mismatch")
            return 1

    print("OK   watercolor-soft acceptance: dimensions, no pure black, feathered edges, preview scale")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
