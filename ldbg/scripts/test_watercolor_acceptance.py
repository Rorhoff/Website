#!/usr/bin/env python3
"""Acceptance checks for Addendum C watercolor filter (C7)."""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from watercolor import (  # noqa: E402
    _assert_lightening_contract,
    _composite_over_white,
    _edge_feather_alpha,
    _hsv_value_floor_rgb,
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


def make_photo_like(w: int, h: int) -> np.ndarray:
    """Similar stats to a clean orthophoto (~mean 110, min 0, max 255)."""
    rng = np.random.default_rng(7)
    base = rng.integers(90, 140, (h, w, 3), dtype=np.uint8)
    base[0:20, :] = rng.integers(200, 255, (20, w, 3), dtype=np.uint8)
    base[-20:, :] = rng.integers(40, 90, (20, w, 3), dtype=np.uint8)
    base[:, 0:15] = 0
    return base


def test_value_floor_remap() -> None:
    dark = np.zeros((8, 8, 3), dtype=np.uint8)
    lifted = _hsv_value_floor_rgb(dark, 0.12)
    assert int(lifted.min()) >= 29, f"expected min >= 29, got {lifted.min()}"


def test_white_composite_corners() -> None:
    rgb = np.full((100, 100, 3), 180, dtype=np.uint8)
    alpha = _edge_feather_alpha(100, 100, {"marginFraction": 0.08, "noiseScale": 0.015, "seed": 7})
    out = _composite_over_white(rgb, alpha)
    assert out[0, 0].mean() >= 245, f"corner should be white paper, got {out[0, 0]}"


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

    test_value_floor_remap()
    test_white_composite_corners()

    paper = ROOT / "public" / "textures" / "paper-cold-press.jpg"
    if not paper.is_file():
        from generate_paper_texture import generate_paper_texture

        paper.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(generate_paper_texture(2048), mode="RGB").save(paper, quality=92)

    for label, sample_fn, size in (
        ("gradient", make_sample_ortho, (1200, 800)),
        ("photo-like", make_photo_like, (862, 600)),
    ):
        w, h = size
        sample = sample_fn(w, h)
        rgb = apply_watercolor(sample, params, paper)
        if rgb.shape[:2] != (h, w):
            print(f"FAIL {label}: dimensions")
            return 1
        try:
            _assert_lightening_contract(sample, rgb, params["hsv"]["valueFloor"])
        except AssertionError as exc:
            print(f"FAIL {label}: {exc}")
            return 1
        if int(rgb.max()) < 240:
            print(f"FAIL {label}: highlights compressed max={rgb.max()}")
            return 1

    w, h = 1200, 800
    sample = make_sample_ortho(w, h)
    rgb = apply_watercolor(sample, params, paper)

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

    print("OK   watercolor acceptance: lighter than source, white corners, value floor, highlights")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
