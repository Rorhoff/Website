#!/usr/bin/env python3
"""Geospatial helpers for geometry export (Addendum A7)."""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

METERS_TO_FEET = 3.280839895


def cmd_wgs84(args: argparse.Namespace) -> int:
    try:
        from pyproj import Transformer
    except ImportError:
        print(json.dumps({"error": "pyproj not installed"}))
        return 2

    points = json.loads(args.points)
    epsg = args.epsg
    transformer = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)

    out = []
    for pt in points:
        lon, lat = transformer.transform(float(pt["x"]), float(pt["y"]))
        entry = {"lon": round(lon, 8), "lat": round(lat, 8)}
        if pt.get("z") is not None:
            entry["z"] = float(pt["z"])
        out.append(entry)

    print(json.dumps({"points": out}))
    return 0


def cmd_sample_elev(args: argparse.Namespace) -> int:
    try:
        import numpy as np
    except ImportError:
        print(json.dumps({"error": "numpy not installed"}))
        return 2

    cache_path = Path(args.cache)
    if not cache_path.is_file():
        print(json.dumps({"error": f"DTM cache not found: {cache_path}"}))
        return 1

    cache = json.loads(cache_path.read_text(encoding="utf-8"))
    w = int(cache["width"])
    h = int(cache["height"])
    flat = cache.get("elevations") or cache.get("grid")
    if flat is None:
        print(json.dumps({"error": "DTM cache has no elevation grid"}))
        return 1

    grid = np.array(flat, dtype=float).reshape((h, w))
    t = cache["transform"]
    nodata = cache.get("nodata")

    points = json.loads(args.points)
    elevations_ft: list[float | None] = []

    for pt in points:
        x = float(pt["x"])
        y = float(pt["y"])
        det = t["a"] * t["e"] - t["b"] * t["d"]
        if abs(det) < 1e-12:
            elevations_ft.append(None)
            continue
        dx = x - t["c"]
        dy = y - t["f"]
        col = (t["e"] * dx - t["b"] * dy) / det
        row = (-t["d"] * dx + t["a"] * dy) / det
        h, w = grid.shape
        if col < 0 or row < 0 or col >= w - 1 or row >= h - 1:
            elevations_ft.append(None)
            continue
        c0 = int(math.floor(col))
        r0 = int(math.floor(row))
        dc = col - c0
        dr = row - r0
        z00 = grid[r0, c0]
        z10 = grid[r0, c0 + 1]
        z01 = grid[r0 + 1, c0]
        z11 = grid[r0 + 1, c0 + 1]
        vals = [z00, z10, z01, z11]
        if nodata is not None and any(v == nodata or math.isnan(v) for v in vals):
            elevations_ft.append(None)
            continue
        z = (
            z00 * (1 - dc) * (1 - dr)
            + z10 * dc * (1 - dr)
            + z01 * (1 - dc) * dr
            + z11 * dc * dr
        )
        elevations_ft.append(round(float(z) * METERS_TO_FEET, 3))

    print(json.dumps({"elevationsFt": elevations_ft}))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    wgs = sub.add_parser("wgs84")
    wgs.add_argument("--epsg", type=int, required=True)
    wgs.add_argument("--points", required=True)
    wgs.set_defaults(func=cmd_wgs84)

    elev = sub.add_parser("sample-elev")
    elev.add_argument("--cache", required=True)
    elev.add_argument("--points", required=True)
    elev.set_defaults(func=cmd_sample_elev)

    args = parser.parse_args()
    try:
        return args.func(args)
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
