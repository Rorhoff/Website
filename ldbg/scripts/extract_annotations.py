#!/usr/bin/env python3
"""CV-based annotation extraction — mask diff, palette classify, geometry extract.

Usage:
  python extract_annotations.py \\
    --annotated path/to/annotated.jpg \\
    [--clean path/to/clean.jpg] \\
    --palette path/to/palette.json \\
    --out-json result.json \\
    [--mask-out mask.png] \\
    [--boundary boundary.json] \\
    [--house house.json] \\
    [--street street.json] \\
    [--width W --height H] \\
    [--pixels-per-foot PPF] \\
    [--delta-e 12] \\
    [--min-area-sqft 4]

Requires: opencv-python-headless, numpy, Pillow, scikit-image (see requirements-geo.txt)
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import uuid
from pathlib import Path
from typing import Any

try:
    import cv2
    import numpy as np
    from PIL import Image
    from skimage.morphology import skeletonize
except ImportError as exc:
    print(json.dumps({"error": f"Missing CV dependencies: {exc}"}))
    sys.exit(2)


def hex_to_bgr(hex_ref: str) -> tuple[int, int, int]:
    h = hex_ref.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return b, g, r


def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    bgr = cv2.cvtColor(rgb.astype(np.uint8), cv2.COLOR_RGB2BGR)
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    return lab


def local_stddev(gray: np.ndarray, ksize: int = 5) -> np.ndarray:
    gray_f = gray.astype(np.float32)
    mean = cv2.blur(gray_f, (ksize, ksize))
    mean_sq = cv2.blur(gray_f * gray_f, (ksize, ksize))
    var = np.maximum(mean_sq - mean * mean, 0)
    return np.sqrt(var)


def compute_ink_mask(
    annotated_bgr: np.ndarray,
    clean_bgr: np.ndarray | None,
    delta_e_threshold: float,
) -> np.ndarray:
    if clean_bgr is not None:
        if clean_bgr.shape[:2] != annotated_bgr.shape[:2]:
            clean_bgr = cv2.resize(clean_bgr, (annotated_bgr.shape[1], annotated_bgr.shape[0]))
        lab_ann = cv2.cvtColor(annotated_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
        lab_clean = cv2.cvtColor(clean_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
        delta_e = np.linalg.norm(lab_ann - lab_clean, axis=2)
        return (delta_e > delta_e_threshold).astype(np.uint8)
    hsv = cv2.cvtColor(annotated_bgr, cv2.COLOR_BGR2HSV)
    s = hsv[:, :, 1].astype(np.float32) / 255.0
    gray = cv2.cvtColor(annotated_bgr, cv2.COLOR_BGR2GRAY)
    std = local_stddev(gray, 5)
    sat_mask = s > 0.28
    flat_mask = std < 18.0
    return (sat_mask & flat_mask).astype(np.uint8)


def load_palette(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("Palette must be a JSON array")
    return data


def palette_lab_refs(palette: list[dict[str, Any]]) -> list[tuple[np.ndarray, dict[str, Any]]]:
    refs = []
    for entry in palette:
        bgr = np.array([[list(hex_to_bgr(entry["hexRef"]))]], dtype=np.uint8)
        lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)[0, 0]
        refs.append((lab, entry))
    return refs


def classify_ink_pixels(
    annotated_bgr: np.ndarray,
    ink_mask: np.ndarray,
    palette: list[dict[str, Any]],
) -> tuple[np.ndarray, np.ndarray]:
    """Returns (label_map int32, distance_map float32). 0 = unclassified."""
    h, w = ink_mask.shape
    label_map = np.zeros((h, w), dtype=np.int32)
    distance_map = np.full((h, w), np.inf, dtype=np.float32)
    refs = palette_lab_refs(palette)
    lab_img = cv2.cvtColor(annotated_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    ys, xs = np.where(ink_mask > 0)
    for y, x in zip(ys, xs):
        px_lab = lab_img[y, x]
        best_i = 0
        best_d = float("inf")
        for i, (ref_lab, entry) in enumerate(refs, start=1):
            d = float(np.linalg.norm(px_lab - ref_lab))
            if d < best_d:
                best_d = d
                best_i = i
        entry = refs[best_i - 1][1]
        if best_d <= float(entry.get("maxLabDistance", 35)):
            label_map[y, x] = best_i
            distance_map[y, x] = best_d
    return label_map, distance_map


def sqft_to_pixels(area_sqft: float, ppf: float) -> float:
    return area_sqft * ppf * ppf


def norm_point(x: float, y: float, w: int, h: int) -> dict[str, float]:
    return {"x": max(0.0, min(1.0, x / w)), "y": max(0.0, min(1.0, y / h))}


def polygon_area_px(points: list[tuple[float, float]]) -> float:
    if len(points) < 3:
        return 0.0
    area = 0.0
    for i in range(len(points)):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % len(points)]
        area += x1 * y2 - x2 * y1
    return abs(area) * 0.5


def point_in_polygon(px: float, py: float, poly: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi + 1e-9) + xi):
            inside = not inside
        j = i
    return inside


def clip_polyline_to_polygon(
    points: list[tuple[float, float]], boundary: list[tuple[float, float]]
) -> list[tuple[float, float]]:
    return [(x, y) for x, y in points if point_in_polygon(x, y, boundary)]


def clip_polygon_to_boundary(
    points: list[tuple[float, float]], boundary: list[tuple[float, float]]
) -> list[tuple[float, float]]:
    if all(point_in_polygon(x, y, boundary) for x, y in points):
        return points
    kept = [(x, y) for x, y in points if point_in_polygon(x, y, boundary)]
    return kept if len(kept) >= 3 else []


def order_skeleton_pixels(skel: np.ndarray) -> list[tuple[int, int]]:
    ys, xs = np.where(skel)
    if len(xs) == 0:
        return []
    pts = list(zip(xs.tolist(), ys.tolist()))
    if len(pts) <= 2:
        return pts
    # Build adjacency
    pt_set = set(pts)
    neighbors: dict[tuple[int, int], list[tuple[int, int]]] = {p: [] for p in pts}
    for x, y in pts:
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                n = (x + dx, y + dy)
                if n in pt_set:
                    neighbors[(x, y)].append(n)
    endpoints = [p for p in pts if len(neighbors[p]) == 1]
    start = endpoints[0] if endpoints else pts[0]
    path = [start]
    visited = {start}
    cur = start
    while True:
        nbs = [n for n in neighbors[cur] if n not in visited]
        if not nbs:
            break
        nxt = nbs[0]
        path.append(nxt)
        visited.add(nxt)
        cur = nxt
    return path


def simplify_polyline(points: list[tuple[float, float]], epsilon: float) -> list[tuple[float, float]]:
    if len(points) < 3:
        return points
    arr = np.array(points, dtype=np.float32).reshape(-1, 1, 2)
    approx = cv2.approxPolyDP(arr, epsilon, False)
    return [(float(p[0][0]), float(p[0][1])) for p in approx]


def extract_area_contours(
    comp_mask: np.ndarray, w: int, h: int, epsilon_px: float = 2.0
) -> list[list[dict[str, float]]]:
    contours, _ = cv2.findContours(comp_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    rings: list[list[dict[str, float]]] = []
    for cnt in contours:
        if len(cnt) < 3:
            continue
        approx = cv2.approxPolyDP(cnt, epsilon_px, True)
        if len(approx) < 3:
            continue
        ring = [norm_point(float(p[0][0]), float(p[0][1]), w, h) for p in approx]
        rings.append(ring)
    return rings


def extract_line_path(comp_mask: np.ndarray, w: int, h: int) -> list[dict[str, float]]:
    skel = skeletonize(comp_mask > 0)
    ordered = order_skeleton_pixels(skel.astype(np.uint8))
    if len(ordered) < 2:
        return []
    simplified = simplify_polyline([(float(x), float(y)) for x, y in ordered], epsilon=2.0)
    return [norm_point(x, y, w, h) for x, y in simplified]


def extract_point_centroid(comp_mask: np.ndarray, w: int, h: int) -> list[dict[str, float]]:
    m = cv2.moments(comp_mask, binaryImage=True)
    if m["m00"] <= 0:
        return []
    cx = m["m10"] / m["m00"]
    cy = m["m01"] / m["m00"]
    return [norm_point(cx, cy, w, h)]


def load_boundary_polygon(data: dict[str, Any] | None, w: int, h: int) -> list[tuple[float, float]] | None:
    if not data or "points" not in data:
        return None
    return [(p["x"] * w, p["y"] * h) for p in data["points"]]


def feature_intersects_polygon(
    points_norm: list[dict[str, float]], boundary: list[tuple[float, float]], w: int, h: int
) -> bool:
    px_pts = [(p["x"] * w, p["y"] * h) for p in points_norm]
    return any(not point_in_polygon(x, y, boundary) for x, y in px_pts)


def centroid_inside(
    points_norm: list[dict[str, float]], poly: list[tuple[float, float]], w: int, h: int
) -> bool:
    if not points_norm:
        return False
    cx = sum(p["x"] for p in points_norm) / len(points_norm) * w
    cy = sum(p["y"] for p in points_norm) / len(points_norm) * h
    return point_in_polygon(cx, cy, poly)


def merge_nearby_masks(masks: list[np.ndarray], dilation_px: int) -> np.ndarray:
    if not masks:
        return np.zeros((1, 1), dtype=np.uint8)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilation_px * 2 + 1, dilation_px * 2 + 1))
    combined = np.zeros_like(masks[0], dtype=np.uint8)
    for m in masks:
        combined = cv2.bitwise_or(combined, m)
    combined = cv2.dilate(combined, kernel, iterations=1)
    return combined


def run_extraction(args: argparse.Namespace) -> dict[str, Any]:
    annotated = cv2.imread(str(args.annotated))
    if annotated is None:
        raise ValueError(f"Cannot read annotated image: {args.annotated}")
    h, w = annotated.shape[:2]

    clean = cv2.imread(str(args.clean)) if args.clean else None
    ink_mask = compute_ink_mask(annotated, clean, args.delta_e)

    palette = load_palette(args.palette)
    label_map, distance_map = classify_ink_pixels(annotated, ink_mask, palette)

    if args.mask_out:
        vis = np.zeros((h, w, 3), dtype=np.uint8)
        for i, entry in enumerate(palette, start=1):
            bgr = hex_to_bgr(entry["hexRef"])
            vis[label_map == i] = bgr
        cv2.imwrite(str(args.mask_out), vis)

    boundary_data = json.loads(args.boundary.read_text()) if args.boundary else None
    house_data = json.loads(args.house.read_text()) if args.house else None
    street_data = json.loads(args.street.read_text()) if args.street else None
    boundary_px = load_boundary_polygon(boundary_data, w, h)
    house_px = load_boundary_polygon(house_data, w, h)
    street_px = load_boundary_polygon(street_data, w, h)

    ppf = args.pixels_per_foot or 10.0
    min_area_px = sqft_to_pixels(args.min_area_sqft, ppf)

    features: list[dict[str, Any]] = []
    ambiguities: list[str] = []
    warnings: list[str] = []
    label_counts: dict[str, int] = {}

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))

    for i, entry in enumerate(palette, start=1):
        comp = (label_map == i).astype(np.uint8)
        if comp.sum() == 0:
            continue
        geom_type = entry.get("geometryType", "area")
        if geom_type == "line":
            closed = comp
        else:
            closed = cv2.morphologyEx(comp, cv2.MORPH_CLOSE, kernel, iterations=1)

        n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(closed, connectivity=8)
        component_masks: list[np.ndarray] = []
        for comp_id in range(1, n_labels):
            area_px = stats[comp_id, cv2.CC_STAT_AREA]
            if area_px < max(min_area_px, 16):
                continue
            comp_mask = (labels == comp_id).astype(np.uint8)
            component_masks.append(comp_mask)

        if geom_type in ("area", "line") and len(component_masks) > 1:
            merged = merge_nearby_masks(component_masks, args.merge_dilation_px)
            n2, labels2, stats2, _ = cv2.connectedComponentsWithStats(merged, connectivity=8)
            component_masks = [(labels2 == cid).astype(np.uint8) for cid in range(1, n2)]

        for comp_mask in component_masks:
            area_px = int(comp_mask.sum())
            if area_px < max(min_area_px, 16):
                continue

            avg_dist = float(distance_map[(label_map == i) & (comp_mask > 0)].mean()) if area_px else 0
            confidence = max(0.0, min(1.0, 1.0 - avg_dist / float(entry.get("maxLabDistance", 35))))
            if avg_dist > float(entry.get("maxLabDistance", 35)) * 0.85:
                warnings.append(
                    f"High palette distance ({avg_dist:.1f}) for {entry['label']} component"
                )

            if geom_type == "area":
                rings = extract_area_contours(comp_mask, w, h)
                if not rings:
                    continue
                points_norm = rings[0]
                px_pts = [(p["x"] * w, p["y"] * h) for p in points_norm]
                if polygon_area_px(px_pts) < min_area_px:
                    continue
                kind = "polygon"
            elif geom_type == "line":
                points_norm = extract_line_path(comp_mask, w, h)
                if len(points_norm) < 2:
                    ambiguities.append(f"Line feature {entry['label']} has fewer than 2 vertices")
                    continue
                if len(points_norm) < 3:
                    warnings.append(f"Line feature {entry['label']} has fewer than 3 vertices after simplify")
                kind = "polyline"
            else:
                points_norm = extract_point_centroid(comp_mask, w, h)
                if not points_norm:
                    continue
                kind = "point"

            if boundary_px:
                if kind == "polygon":
                    px_ring = [(p["x"] * w, p["y"] * h) for p in points_norm]
                    clipped = clip_polygon_to_boundary(px_ring, boundary_px)
                    if len(clipped) < 3:
                        continue
                    points_norm = [norm_point(x, y, w, h) for x, y in clipped]
                elif kind == "polyline":
                    px_ring = [(p["x"] * w, p["y"] * h) for p in points_norm]
                    clipped = clip_polyline_to_polygon(px_ring, boundary_px)
                    if len(clipped) < 2:
                        continue
                    points_norm = [norm_point(x, y, w, h) for x, y in clipped]
                else:
                    cx, cy = points_norm[0]["x"] * w, points_norm[0]["y"] * h
                    if not point_in_polygon(cx, cy, boundary_px):
                        continue

            if house_px and kind == "polygon" and centroid_inside(points_norm, house_px, w, h):
                continue

            if street_px and feature_intersects_polygon(points_norm, street_px, w, h):
                ambiguities.append(f"{entry['label']} intersects street polygon — review clipping")
                continue

            label_counts[entry["featureType"]] = label_counts.get(entry["featureType"], 0) + 1
            suffix = f" {label_counts[entry['featureType']]}" if label_counts[entry["featureType"]] > 1 else ""
            base_label = entry["label"]

            frame_area = w * h
            if kind == "polygon":
                px_pts = [(p["x"] * w, p["y"] * h) for p in points_norm]
                if polygon_area_px(px_pts) > frame_area * 0.25:
                    warnings.append(f"{base_label}{suffix} covers >25% of frame")

            if boundary_px and feature_intersects_polygon(points_norm, boundary_px, w, h):
                warnings.append(f"{base_label}{suffix} intersects property boundary edge")

            features.append(
                {
                    "id": str(uuid.uuid4()),
                    "featureType": entry["featureType"],
                    "label": f"{base_label}{suffix}".strip(),
                    "geometry": {"kind": kind, "points": points_norm},
                    "existing": False,
                    "confidence": round(confidence, 3),
                    "notes": f"CV import; avg Lab distance {avg_dist:.1f}",
                    "paletteMatchDistance": round(avg_dist, 2),
                }
            )

    # Duplicate label check
    labels_seen: set[str] = set()
    for f in features:
        lbl = f["label"]
        if lbl in labels_seen:
            ambiguities.append(f"Duplicate label emitted: {lbl}")
        labels_seen.add(lbl)

    return {
        "imageSize": {"width": w, "height": h},
        "features": features,
        "siteObservations": [
            "Geometry extracted via CV mask diff + palette classification (no coordinate LLM)."
        ],
        "ambiguities": ambiguities,
        "warnings": warnings,
        "method": "cv" if clean is not None else "cv-hsv-fallback",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract annotated features via CV pipeline")
    parser.add_argument("--annotated", type=Path, required=True)
    parser.add_argument("--clean", type=Path, default=None)
    parser.add_argument("--palette", type=Path, required=True)
    parser.add_argument("--out-json", type=Path, required=True)
    parser.add_argument("--mask-out", type=Path, default=None)
    parser.add_argument("--boundary", type=Path, default=None)
    parser.add_argument("--house", type=Path, default=None)
    parser.add_argument("--street", type=Path, default=None)
    parser.add_argument("--pixels-per-foot", type=float, default=None)
    parser.add_argument("--delta-e", type=float, default=12.0)
    parser.add_argument("--min-area-sqft", type=float, default=4.0)
    parser.add_argument("--merge-dilation-px", type=int, default=8)
    args = parser.parse_args()

    try:
        result = run_extraction(args)
        args.out_json.write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(json.dumps({"ok": True, "features": len(result["features"])}))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
