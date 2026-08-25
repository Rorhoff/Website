#!/usr/bin/env python3
"""Fixture tests for CV annotation extraction.

Generates a synthetic clean/annotated ortho pair, runs extract_annotations.py,
and asserts no feature intersects the street polygon and labels are unique.

Usage: python scripts/test_cv_import_fixtures.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

try:
    import cv2
    import numpy as np
except ImportError:
    print("SKIP: install opencv-python-headless and numpy")
    sys.exit(0)


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "extract_annotations.py"
PALETTE = ROOT / "src" / "config" / "annotation-palette.json"


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


def feature_intersects_street(feature: dict, street_poly: list[tuple[float, float]], w: int, h: int) -> bool:
    geom = feature["geometry"]
    pts = geom["points"]
    px_pts = [(p["x"] * w, p["y"] * h) for p in pts]
    return any(point_in_polygon(x, y, street_poly) for x, y in px_pts)


def make_fixture(clean_path: Path, ann_path: Path) -> None:
    w, h = 400, 300
    clean = np.ones((h, w, 3), dtype=np.uint8) * 180
    clean[80:220, 60:340] = (120, 150, 90)
    cv2.imwrite(str(clean_path), clean)

    ann = clean.copy()
    # Lawn area inside property (green)
    cv2.fillPoly(ann, [np.array([[80, 100], [320, 100], [320, 200], [80, 200]], np.int32)], (34, 139, 34))
    # Steel edging line (blue) — thin line, not closed blob
    cv2.line(ann, (90, 210), (310, 210), (225, 105, 65), 3)
    # Tree point (dark green circle)
    cv2.circle(ann, (200, 150), 12, (0, 100, 0), -1)
    # Street overspill ink (grey) outside property — should be clipped/rejected
    cv2.fillPoly(ann, [np.array([[0, 0], [50, 0], [50, h], [0, h]], np.int32)], (128, 128, 128))
    cv2.imwrite(str(ann_path), ann)


def main() -> int:
    if not SCRIPT.is_file() or not PALETTE.is_file():
        print("ERR  missing script or palette")
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        clean = tmp_path / "clean.jpg"
        ann = tmp_path / "annotated.jpg"
        out_json = tmp_path / "out.json"
        boundary = tmp_path / "boundary.json"
        street = tmp_path / "street.json"

        make_fixture(clean, ann)

        # Property boundary — inset from frame
        boundary.write_text(
            json.dumps(
                {
                    "points": [
                        {"x": 0.15, "y": 0.25},
                        {"x": 0.85, "y": 0.25},
                        {"x": 0.85, "y": 0.85},
                        {"x": 0.15, "y": 0.85},
                    ]
                }
            ),
            encoding="utf-8",
        )
        # Street band along left edge (normalized)
        street.write_text(
            json.dumps(
                {
                    "points": [
                        {"x": 0.0, "y": 0.0},
                        {"x": 0.12, "y": 0.0},
                        {"x": 0.12, "y": 1.0},
                        {"x": 0.0, "y": 1.0},
                    ]
                }
            ),
            encoding="utf-8",
        )

        proc = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--annotated",
                str(ann),
                "--clean",
                str(clean),
                "--palette",
                str(PALETTE),
                "--out-json",
                str(out_json),
                "--boundary",
                str(boundary),
                "--street",
                str(street),
                "--pixels-per-foot",
                "10",
                "--min-area-sqft",
                "1",
            ],
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            print("ERR  extractor failed:", proc.stderr or proc.stdout)
            return 1

        result = json.loads(out_json.read_text(encoding="utf-8"))
        features = result.get("features", [])
        w = result["imageSize"]["width"]
        h = result["imageSize"]["height"]
        street_poly = [(0.0, 0.0), (0.12 * w, 0.0), (0.12 * w, h), (0.0, h)]

        labels = [f["label"] for f in features]
        if len(labels) != len(set(labels)):
            print("ERR  duplicate labels:", labels)
            return 1

        for f in features:
            if feature_intersects_street(f, street_poly, w, h):
                print("ERR  feature intersects street:", f["label"], f["featureType"])
                return 1

        print(f"OK   {len(features)} features, unique labels, no street intersection")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
