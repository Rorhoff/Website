#!/usr/bin/env python3
"""Deterministic watercolor filter for plan base layers (Addendum C).

Output dimensions always match input — no crop, rotate, or reframing.
Usage:
  python watercolor.py input.jpg --params-json params.json --out-full out.png --out-preview prev.png
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Callable

try:
    import cv2
    import numpy as np
    from PIL import Image
except ImportError as exc:
    print(json.dumps({"error": str(exc)}))
    sys.exit(2)


ProgressFn = Callable[[int, str], None]


def _emit_progress(cb: ProgressFn | None, pct: int, step: str) -> None:
    if cb:
        cb(pct, step)


def _load_rgb(path: Path) -> np.ndarray:
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"Could not read image: {path}")
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def _kuwahara(img: np.ndarray, radius: int) -> np.ndarray:
    """Sector Kuwahara filter — same output size as input."""
    h, w = img.shape[:2]
    r = max(1, int(radius))
    pad = r
    padded = cv2.copyMakeBorder(img, pad, pad, pad, pad, cv2.BORDER_REFLECT_101)
    out = np.zeros_like(img, dtype=np.float32)

    for y in range(h):
        for x in range(w):
            py, px = y + pad, x + pad
            region = padded[py - r : py + r + 1, px - r : px + r + 1].astype(np.float32)
            rh, rw = region.shape[:2]
            cy, cx = rh // 2, rw // 2
            sectors = [
                region[0:cy + 1, 0:cx + 1],
                region[0:cy + 1, cx:rw],
                region[cy:rh, 0:cx + 1],
                region[cy:rh, cx:rw],
            ]
            best = None
            best_score = float("inf")
            for s in sectors:
                if s.size == 0:
                    continue
                mean = s.mean(axis=(0, 1))
                var = ((s - mean) ** 2).mean()
                score = var
                if score < best_score:
                    best_score = score
                    best = mean
            out[y, x] = best if best is not None else img[y, x]
    return np.clip(out, 0, 255).astype(np.uint8)


def _posterize(img: np.ndarray, levels: int) -> np.ndarray:
    levels = max(12, min(255, int(levels)))
    step = 255.0 / (levels - 1)
    quantized = np.round(img.astype(np.float32) / step) * step
    return np.clip(quantized, 0, 255).astype(np.uint8)


def _hsv_adjust(img: np.ndarray, sat_mul: float, value_floor: float) -> np.ndarray:
    hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV).astype(np.float32)
    hsv[:, :, 1] = np.clip(hsv[:, :, 1] * sat_mul, 0, 255)
    floor = np.clip(value_floor, 0, 1) * 255
    hsv[:, :, 2] = np.maximum(hsv[:, :, 2], floor)
    return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2RGB)


def _edge_darken(img: np.ndarray, params: dict[str, Any]) -> np.ndarray:
    if not params.get("enabled", True):
        return img
    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(
        gray,
        int(params.get("cannyLow", 50)),
        int(params.get("cannyHigh", 150)),
    )
    blur_r = max(1, int(params.get("blurRadius", 3)))
    k = blur_r * 2 + 1
    edges = cv2.GaussianBlur(edges.astype(np.float32), (k, k), 0) / 255.0
    opacity = float(params.get("opacity", 0.2))
    factor = 1.0 - edges[..., np.newaxis] * opacity
    out = img.astype(np.float32) * factor
    return np.clip(out, 0, 255).astype(np.uint8)


def _granulation(img: np.ndarray, amplitude: float, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    h, w = img.shape[:2]
    noise = rng.normal(0, 1, (h, w)).astype(np.float32)
    noise = cv2.GaussianBlur(noise, (0, 0), sigmaX=2, sigmaY=2)
    noise = (noise - noise.min()) / max(noise.max() - noise.min(), 1e-6)
    factor = 1.0 - noise * amplitude
    out = img.astype(np.float32) * factor[..., np.newaxis]
    return np.clip(out, 0, 255).astype(np.uint8)


def _load_tile_texture(path: Path, h: int, w: int) -> np.ndarray:
    tex = np.array(Image.open(path).convert("RGB"))
    th, tw = tex.shape[:2]
    tiles_y = int(np.ceil(h / th)) + 1
    tiles_x = int(np.ceil(w / tw)) + 1
    tiled = np.tile(tex, (tiles_y, tiles_x, 1))[:h, :w]
    return tiled


def _apply_paper_texture(img: np.ndarray, texture_path: Path, opacity: float) -> np.ndarray:
    if opacity <= 0 or not texture_path.is_file():
        return img
    tex = _load_tile_texture(texture_path, img.shape[0], img.shape[1]).astype(np.float32)
    base = img.astype(np.float32)
    blended = base * (1 - opacity) + (base * tex / 255.0) * opacity
    return np.clip(blended, 0, 255).astype(np.uint8)


def _edge_feather_alpha(h: int, w: int, params: dict[str, Any]) -> np.ndarray:
    margin = float(params.get("marginFraction", 0.08))
    noise_scale = float(params.get("noiseScale", 0.015))
    seed = int(params.get("seed", 7))
    rng = np.random.default_rng(seed)

    y = np.linspace(0, 1, h, dtype=np.float32)[:, np.newaxis]
    x = np.linspace(0, 1, w, dtype=np.float32)[np.newaxis, :]
    dist = np.minimum(np.minimum(x, 1 - x), np.minimum(y, 1 - y))
    base = np.clip(dist / max(margin, 1e-4), 0, 1)

    noise_h = max(4, int(h * noise_scale))
    noise_w = max(4, int(w * noise_scale))
    coarse = rng.random((noise_h, noise_w), dtype=np.float32)
    coarse = cv2.resize(coarse, (w, h), interpolation=cv2.INTER_CUBIC)
    coarse = (coarse - coarse.min()) / max(coarse.max() - coarse.min(), 1e-6)
    alpha = np.clip(base * (0.65 + 0.35 * coarse), 0, 1)
    return (alpha * 255).astype(np.uint8)


def apply_watercolor_texture_only(
    img: np.ndarray,
    params: dict[str, Any],
    paper_texture_path: Path | None = None,
    progress: ProgressFn | None = None,
) -> np.ndarray:
    """Steps 3–7 only (posterize through paper texture), for feature-fill crops."""
    input_h, input_w = img.shape[:2]

    poster = params.get("posterize", {})
    _emit_progress(progress, 10, "posterize")
    posterized = _posterize(img, int(poster.get("levels", 20)))

    hsv_p = params.get("hsv", {})
    _emit_progress(progress, 30, "hsv-adjust")
    adjusted = _hsv_adjust(
        posterized,
        float(hsv_p.get("saturationMultiplier", 1.15)),
        float(hsv_p.get("valueFloor", 0.12)),
    )

    edge_p = params.get("edgeDarkening", {})
    _emit_progress(progress, 50, "edge-darkening")
    edged = _edge_darken(adjusted, edge_p)

    gran = params.get("granulation", {})
    _emit_progress(progress, 70, "granulation")
    grained = _granulation(
        edged,
        float(gran.get("amplitude", 0.035)),
        int(gran.get("seed", 42)),
    )

    paper_p = params.get("paperTexture", {})
    _emit_progress(progress, 90, "paper-texture")
    paper_opacity = float(paper_p.get("opacity", 0.14))
    paper_path = paper_texture_path or Path()
    textured = _apply_paper_texture(grained, paper_path, paper_opacity)

    out_h, out_w = textured.shape[:2]
    if out_h != input_h or out_w != input_w:
        raise AssertionError(
            f"Texture-only output dimensions {out_w}x{out_h} != input {input_w}x{input_h}"
        )

    _emit_progress(progress, 100, "complete")
    return textured


def apply_watercolor(
    img: np.ndarray,
    params: dict[str, Any],
    paper_texture_path: Path | None = None,
    progress: ProgressFn | None = None,
) -> np.ndarray:
    input_h, input_w = img.shape[:2]

    bilateral = params.get("bilateral", {})
    _emit_progress(progress, 5, "pre-clean")
    cleaned = cv2.bilateralFilter(
        img,
        d=int(bilateral.get("d", 9)),
        sigmaColor=float(bilateral.get("sigmaColor", 75)),
        sigmaSpace=float(bilateral.get("sigmaSpace", 75)),
    )

    styl = params.get("stylization", {})
    _emit_progress(progress, 20, "color-simplification")
    method = styl.get("method", "stylization")
    if method == "kuwahara":
        simplified = _kuwahara(cleaned, int(styl.get("kuwaharaRadius", 5)))
    else:
        simplified = cv2.stylization(
            cleaned,
            sigma_s=float(styl.get("sigmaS", 60)),
            sigma_r=float(styl.get("sigmaR", 0.45)),
        )

    poster = params.get("posterize", {})
    _emit_progress(progress, 35, "posterize")
    posterized = _posterize(simplified, int(poster.get("levels", 20)))

    hsv_p = params.get("hsv", {})
    _emit_progress(progress, 50, "hsv-adjust")
    adjusted = _hsv_adjust(
        posterized,
        float(hsv_p.get("saturationMultiplier", 1.15)),
        float(hsv_p.get("valueFloor", 0.12)),
    )

    edge_p = params.get("edgeDarkening", {})
    _emit_progress(progress, 65, "edge-darkening")
    edged = _edge_darken(adjusted, edge_p)

    gran = params.get("granulation", {})
    _emit_progress(progress, 75, "granulation")
    grained = _granulation(
        edged,
        float(gran.get("amplitude", 0.035)),
        int(gran.get("seed", 42)),
    )

    paper_p = params.get("paperTexture", {})
    _emit_progress(progress, 85, "paper-texture")
    paper_opacity = float(paper_p.get("opacity", 0.14))
    paper_path = paper_texture_path or Path()
    textured = _apply_paper_texture(grained, paper_path, paper_opacity)

    feather_p = params.get("edgeFeather", {})
    _emit_progress(progress, 92, "edge-feather")
    alpha = _edge_feather_alpha(input_h, input_w, feather_p)
    rgba = np.dstack([textured, alpha])

    _emit_progress(progress, 98, "dimension-check")
    out_h, out_w = rgba.shape[:2]
    if out_h != input_h or out_w != input_w:
        raise AssertionError(
            f"Watercolor output dimensions {out_w}x{out_h} != input {input_w}x{input_h}"
        )

    if np.any(textured == 0):
        pass  # value floor handles near-black; verify no pure black RGB
    if np.any(np.all(textured == 0, axis=2)):
        raise AssertionError("Watercolor output contains pure black pixels (RGB 0,0,0)")

    _emit_progress(progress, 100, "complete")
    return rgba


def downscale_preview(rgba: np.ndarray, long_edge: int) -> np.ndarray:
    h, w = rgba.shape[:2]
    scale = long_edge / max(w, h) if max(w, h) > long_edge else 1.0
    if scale >= 1.0:
        return rgba
    out_w = max(1, int(round(w * scale)))
    out_h = max(1, int(round(h * scale)))
    rgb = cv2.resize(rgba[:, :, :3], (out_w, out_h), interpolation=cv2.INTER_AREA)
    alpha = cv2.resize(rgba[:, :, 3], (out_w, out_h), interpolation=cv2.INTER_AREA)
    return np.dstack([rgb, alpha])


def run_filter(
    input_path: Path,
    params: dict[str, Any],
    out_full: Path,
    out_preview: Path | None,
    paper_texture: Path | None,
    texture_only: bool = False,
) -> dict[str, Any]:
    img = _load_rgb(input_path)
    input_h, input_w = img.shape[:2]

    progress_log: list[dict[str, Any]] = []

    def progress(pct: int, step: str) -> None:
        progress_log.append({"progress": pct, "step": step})
        print(json.dumps({"type": "progress", "progress": pct, "step": step}), flush=True)

    if texture_only:
        rgb = apply_watercolor_texture_only(img, params, paper_texture, progress)
        assert rgb.shape[0] == input_h and rgb.shape[1] == input_w
        out_full.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(rgb, mode="RGB").save(out_full, format="PNG", optimize=True)
        paper_p = params.get("paperTexture", {})
        paper_opacity = float(paper_p.get("opacity", 0.14))
        paper_applied = bool(
            paper_texture and paper_texture.is_file() and paper_opacity > 0
        )
        edge_p = params.get("edgeDarkening", {})
        return {
            "width": input_w,
            "height": input_h,
            "inputWidth": input_w,
            "inputHeight": input_h,
            "textureOnly": True,
            "paramsUsed": params,
            "paperTextureApplied": paper_applied,
            "pipelineSteps": [
                {"step": "posterize", "executed": True, "progress": 10},
                {"step": "hsv-adjust", "executed": True, "progress": 30},
                {
                    "step": "edge-darkening",
                    "executed": bool(edge_p.get("enabled", True)),
                    "progress": 50,
                },
                {"step": "granulation", "executed": True, "progress": 70},
                {
                    "step": "paper-texture",
                    "executed": paper_applied,
                    "progress": 90,
                },
            ],
        }

    rgba = apply_watercolor(img, params, paper_texture, progress)
    assert rgba.shape[0] == input_h and rgba.shape[1] == input_w

    out_full.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, mode="RGBA").save(out_full, format="PNG", optimize=True)

    preview_long = int(params.get("previewLongEdge", 2000))
    preview = downscale_preview(rgba, preview_long)
    if out_preview:
        out_preview.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(preview, mode="RGBA").save(out_preview, format="PNG", optimize=True)

    paper_p = params.get("paperTexture", {})
    paper_opacity = float(paper_p.get("opacity", 0.14))
    paper_applied = bool(paper_texture and paper_texture.is_file() and paper_opacity > 0)
    edge_p = params.get("edgeDarkening", {})

    return {
        "width": input_w,
        "height": input_h,
        "previewWidth": preview.shape[1],
        "previewHeight": preview.shape[0],
        "inputWidth": input_w,
        "inputHeight": input_h,
        "paramsUsed": params,
        "paperTextureApplied": paper_applied,
        "pipelineSteps": [
            {"step": "pre-clean", "executed": True, "progress": 5},
            {"step": "color-simplification", "executed": True, "progress": 20},
            {"step": "posterize", "executed": True, "progress": 35},
            {"step": "hsv-adjust", "executed": True, "progress": 50},
            {
                "step": "edge-darkening",
                "executed": bool(edge_p.get("enabled", True)),
                "progress": 65,
            },
            {"step": "granulation", "executed": True, "progress": 75},
            {"step": "paper-texture", "executed": paper_applied, "progress": 85},
            {"step": "edge-feather", "executed": True, "progress": 92},
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("--params-json", type=Path, required=True)
    parser.add_argument("--out-full", type=Path, required=True)
    parser.add_argument("--out-preview", type=Path)
    parser.add_argument("--paper-texture", type=Path)
    parser.add_argument(
        "--texture-only",
        action="store_true",
        help="Run steps 3–7 only (posterize through paper texture); RGB output, no preview",
    )
    args = parser.parse_args()

    if not args.input.is_file():
        print(json.dumps({"error": f"Not found: {args.input}"}))
        return 1

    try:
        params = json.loads(args.params_json.read_text(encoding="utf-8"))
        result = run_filter(
            args.input,
            params,
            args.out_full,
            args.out_preview,
            args.paper_texture,
            texture_only=args.texture_only,
        )
        from datetime import datetime, timezone

        result["filteredAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        print(json.dumps(result), flush=True)
        return 0
    except AssertionError as exc:
        print(json.dumps({"error": f"DIMENSION_ASSERT: {exc}"}))
        return 3
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
