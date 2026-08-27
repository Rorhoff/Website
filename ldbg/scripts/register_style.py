#!/usr/bin/env python3
"""Registration correction for style-pass output (Stage 5).

Match composite to styled image via edge-map phase correlation, fit similarity
transform with RANSAC, apply inverse warp, crop to original frame.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import cv2
    import numpy as np
except ImportError as exc:
    print(json.dumps({"error": str(exc)}))
    sys.exit(2)


def _edge_map(img: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    edges = cv2.Canny(gray, 50, 150)
    return edges.astype(np.float32) / 255.0


def _sample_patch_centers(w: int, h: int, count: int = 10) -> list[tuple[int, int]]:
    margin = int(min(w, h) * 0.12)
    xs = np.linspace(margin, w - margin, 4).astype(int)
    ys = np.linspace(margin, h - margin, 3).astype(int)
    pts = [(int(x), int(y)) for y in ys for x in xs]
    return pts[:count]


def _phase_correlate_patch(
    ref_edges: np.ndarray, styled_edges: np.ndarray, cx: int, cy: int, patch: int = 64
) -> tuple[float, float] | None:
    h, w = ref_edges.shape
    half = patch // 2
    x0, x1 = max(0, cx - half), min(w, cx + half)
    y0, y1 = max(0, cy - half), min(h, cy + half)
    if x1 - x0 < 16 or y1 - y0 < 16:
        return None
    ref_patch = ref_edges[y0:y1, x0:x1]
    sh, sw = styled_edges.shape
    search = styled_edges[
        max(0, cy - patch * 2) : min(sh, cy + patch * 2),
        max(0, cx - patch * 2) : min(sw, cx + patch * 2),
    ]
    if search.shape[0] < ref_patch.shape[0] or search.shape[1] < ref_patch.shape[1]:
        return None
    result = cv2.matchTemplate(search, ref_patch, cv2.TM_CCOEFF_NORMED)
    _, _, _, max_loc = cv2.minMaxLoc(result)
    dx = max_loc[0] + max(0, cx - patch * 2) - x0
    dy = max_loc[1] + max(0, cy - patch * 2) - y0
    return float(cx + dx), float(cy + dy)


def _similarity_from_points(
    src: np.ndarray, dst: np.ndarray
) -> tuple[np.ndarray | None, np.ndarray, int, float]:
    """Estimate 2x3 similarity transform src -> dst."""
    if len(src) < 3:
        M = np.array([[1, 0, 0], [0, 1, 0]], dtype=np.float32)
        return M, np.ones(len(src), dtype=bool), len(src), 0.0

    src_f = src.astype(np.float32)
    dst_f = dst.astype(np.float32)
    M, inliers = cv2.estimateAffinePartial2D(
        src_f, dst_f, method=cv2.RANSAC, ransacReprojThreshold=3.0
    )
    if M is None:
        M = np.array([[1, 0, 0], [0, 1, 0]], dtype=np.float32)
        inlier_mask = np.zeros(len(src), dtype=bool)
    else:
        inlier_mask = inliers.ravel().astype(bool) if inliers is not None else np.ones(len(src), dtype=bool)

    inlier_count = int(inlier_mask.sum())
    if inlier_count > 0:
        projected = cv2.transform(src_f[inlier_mask].reshape(-1, 1, 2), M)
        err = np.linalg.norm(projected.reshape(-1, 2) - dst_f[inlier_mask], axis=1)
        residual = float(np.median(err))
    else:
        residual = float("inf")

    return M, inlier_mask, inlier_count, residual


def register_style(
    composite_path: Path,
    styled_path: Path,
    out_path: Path,
    image_width: int,
) -> dict:
    composite = cv2.imread(str(composite_path), cv2.IMREAD_COLOR)
    styled = cv2.imread(str(styled_path), cv2.IMREAD_COLOR)
    if composite is None or styled is None:
        raise ValueError("Could not read composite or styled image")

    ch, cw = composite.shape[:2]
    styled_resized = cv2.resize(styled, (cw, ch), interpolation=cv2.INTER_LINEAR)

    ref_e = _edge_map(composite)
    sty_e = _edge_map(styled_resized)

    src_pts: list[list[float]] = []
    dst_pts: list[list[float]] = []

    for cx, cy in _sample_patch_centers(cw, ch):
        match = _phase_correlate_patch(ref_e, sty_e, cx, cy)
        if match:
            src_pts.append([float(cx), float(cy)])
            dst_pts.append([float(match[0]), float(match[1])])

    src = np.array(src_pts, dtype=np.float32)
    dst = np.array(dst_pts, dtype=np.float32)

    M_fwd, inlier_mask, inlier_count, residual_px = _similarity_from_points(src, dst)
    residual_pct = (residual_px / max(image_width, 1)) * 100.0

    if inlier_count >= 3:
        M_inv = cv2.invertAffineTransform(M_fwd)
        registered = cv2.warpAffine(
            styled_resized, M_inv, (cw, ch), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
        )
    else:
        registered = styled_resized

    out_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_path), registered)

    if inlier_count < 5 or residual_pct > 1.0:
        label_mode = "failed"
        passed = False
    elif residual_pct > 0.2:
        label_mode = "callouts"
        passed = True
    else:
        label_mode = "inline"
        passed = True

    return {
        "inlierCount": inlier_count,
        "residualPct": round(residual_pct, 4),
        "passed": passed,
        "labelMode": label_mode,
        "width": cw,
        "height": ch,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("composite", type=Path)
    parser.add_argument("styled", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--width", type=int, required=True, help="Original image width for residual %")
    args = parser.parse_args()

    try:
        result = register_style(args.composite, args.styled, args.out, args.width)
        print(json.dumps(result))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc), "passed": False, "labelMode": "failed"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
