#!/usr/bin/env python3
"""Acceptance checks for Addendum C watercolor filter (C7)."""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from watercolor import (  # noqa: E402
    _composite_over_white,
    _edge_feather_alpha,
    _hsv_adjust,
    apply_watercolor,
    downscale_preview,
)


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


def test_hsv_value_floor_lifts() -> None:
    dark = np.zeros((8, 8, 3), dtype=np.uint8)
    lifted = _hsv_adjust(dark, sat_mul=1.0, value_floor=0.12)
    min_v = lifted.min()
    assert min_v >= 30, f"value floor should lift blacks, got min={min_v}"


def test_white_composite_corners() -> None:
    rgb = np.full((100, 100, 3), 180, dtype=np.uint8)
    alpha = _edge_feather_alpha(100, 100, {"marginFraction": 0.08, "noiseScale": 0.015, "seed": 7})
    out = _composite_over_white(rgb, alpha)
    assert out[0, 0].mean() >= 240, "border should composite to white paper, not black"
    assert out[50, 50].mean() >= 170, "center should retain image content"


def main() -> int:
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

    test_hsv_value_floor_lifts()
    test_white_composite_corners()

    paper = ROOT / "public" / "textures" / "paper-cold-press.jpg"
    if not paper.is_file():
        from generate_paper_texture import generate_paper_texture

        paper.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(generate_paper_texture(2048), mode="RGB").save(paper, quality=92)

    w, h = 1200, 800
    sample = make_sample_ortho(w, h)

    rgb = apply_watercolor(sample, params, paper)
    out_h, out_w = rgb.shape[:2]
    if out_w != w or out_h != h:
        print(f"FAIL dimensions {out_w}x{out_h} != {w}x{h}")
        return 1

    if rgb.ndim != 3 or rgb.shape[2] != 3:
        print("FAIL expected RGB output on white paper")
        return 1

    if np.any(np.all(rgb == 0, axis=2)):
        print("FAIL pure black pixels present")
        return 1

    if rgb[0, 0].mean() < 230:
        print("FAIL border vignette — corners should be white paper")
        return 1

    preview, _downscaled = downscale_preview(rgb, 2000)
    if preview.shape[0] > h or preview.shape[1] > w:
        print("FAIL preview larger than source")
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.png"
        Image.fromarray(rgb, mode="RGB").save(out)
        loaded = np.array(Image.open(out))
        if loaded.shape[0] != h or loaded.shape[1] != w:
            print("FAIL saved PNG dimensions mismatch")
            return 1

    print("OK   watercolor-soft acceptance: dimensions, no pure black, white-paper edges, preview scale")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
