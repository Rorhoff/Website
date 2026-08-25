#!/usr/bin/env python3
"""DTM cache builder and elevation analysis for georeferenced projects.

Usage:
  python dtm_analyze.py build-cache /path/to/dtm.tif --out /path/to/dtm-cache.json
  python dtm_analyze.py analyze /path/to/dtm.tif --features /path/to/features.json \\
      [--cache /path/to/dtm-cache.json] [--contour-minor-ft 1] [--contour-major-ft 5]

Requires: rasterio, numpy, scipy, pyproj (see requirements-geo.txt)
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

try:
    import numpy as np
    import rasterio
    from rasterio.enums import Resampling
    from scipy.ndimage import gaussian_filter
except ImportError as exc:
    print(
        json.dumps(
            {
                "error": (
                    "Missing geospatial dependencies. "
                    "Run: pip install -r scripts/requirements-geo.txt"
                ),
                "detail": str(exc),
            }
        )
    )
    sys.exit(2)

METERS_TO_FEET = 3.280839895
FEET_TO_METERS = 0.3048
CUBIC_METERS_TO_CY = 1.0 / 0.764555


def point_in_polygon(x: float, y: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    n = len(ring)
    if n < 3:
        return False
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if ((yi > y) != (yj > y)) and (
            x < (xj - xi) * (y - yi) / (yj - yi + 1e-15) + xi
        ):
            inside = not inside
        j = i
    return inside


def ring_from_coords(coords: list[dict[str, float]]) -> list[tuple[float, float]]:
    return [(float(c["x"]), float(c["y"])) for c in coords]


def slope_pct_from_grid(z: np.ndarray, cell_m: float) -> np.ndarray:
    dz_dy, dz_dx = np.gradient(z, cell_m, cell_m)
    slope = np.sqrt(dz_dx**2 + dz_dy**2) * 100.0
    return slope


def build_cache(dtm_path: Path, out_path: Path, max_cells: int = 400_000) -> dict[str, Any]:
    with rasterio.open(dtm_path) as src:
        crs = src.crs
        if crs is None:
            raise ValueError("DTM has no CRS")

        nodata = src.nodata
        width = int(src.width)
        height = int(src.height)
        total = width * height
        scale = 1.0
        if total > max_cells:
            scale = math.sqrt(max_cells / total)

        out_w = max(1, int(round(width * scale)))
        out_h = max(1, int(round(height * scale)))

        data = src.read(
            1,
            out_shape=(out_h, out_w),
            resampling=Resampling.bilinear,
        ).astype(np.float64)

        if nodata is not None:
            data[data == nodata] = np.nan

        transform = src.transform * src.transform.scale(
            (src.width / out_w), (src.height / out_h)
        )

        cell_x = abs(float(transform.a))
        cell_y = abs(float(transform.e))
        cell_m = (cell_x + cell_y) / 2.0

        # Light smoothing for contour / slope stability
        filled = np.where(np.isnan(data), np.nanmedian(data), data)
        smoothed = gaussian_filter(filled, sigma=1.0)
        smoothed = np.where(np.isnan(data), np.nan, smoothed)

        bounds = rasterio.transform.array_bounds(out_h, out_w, transform)

        cache = {
            "crs": crs.to_string() if crs.to_epsg() is None else f"EPSG:{crs.to_epsg()}",
            "width": out_w,
            "height": out_h,
            "cellSizeMeters": cell_m,
            "transform": {
                "a": float(transform.a),
                "b": float(transform.b),
                "c": float(transform.c),
                "d": float(transform.d),
                "e": float(transform.e),
                "f": float(transform.f),
            },
            "boundsProjected": {
                "minX": float(bounds[0]),
                "minY": float(bounds[1]),
                "maxX": float(bounds[2]),
                "maxY": float(bounds[3]),
            },
            "nodata": float(nodata) if nodata is not None else None,
            "minElevationMeters": float(np.nanmin(smoothed)),
            "maxElevationMeters": float(np.nanmax(smoothed)),
            "elevations": [
                None if math.isnan(v) else round(float(v), 4)
                for v in smoothed.flatten(order="C")
            ],
            "builtAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        }

        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(cache), encoding="utf-8")
        return {"cachePath": str(out_path), "width": out_w, "height": out_h, "cellSizeMeters": cell_m}


def load_cache(cache_path: Path) -> dict[str, Any]:
    return json.loads(cache_path.read_text(encoding="utf-8"))


def cache_to_grid(cache: dict[str, Any]) -> tuple[np.ndarray, dict[str, float], float]:
    w = int(cache["width"])
    h = int(cache["height"])
    arr = np.array(
        [np.nan if v is None else float(v) for v in cache["elevations"]],
        dtype=np.float64,
    ).reshape((h, w))
    t = cache["transform"]
    cell_m = float(cache["cellSizeMeters"])
    return arr, t, cell_m


def world_to_cell(x: float, y: float, t: dict[str, float]) -> tuple[float, float]:
    det = t["a"] * t["e"] - t["b"] * t["d"]
    if abs(det) < 1e-12:
        raise ValueError("Singular DTM transform")
    dx = x - t["c"]
    dy = y - t["f"]
    col = (t["e"] * dx - t["b"] * dy) / det
    row = (-t["d"] * dx + t["a"] * dy) / det
    return col, row


def sample_grid_bilinear(grid: np.ndarray, col: float, row: float) -> float | None:
    h, w = grid.shape
    if col < 0 or row < 0 or col > w - 1 or row > h - 1:
        return None
    c0 = int(math.floor(col))
    r0 = int(math.floor(row))
    c1 = min(c0 + 1, w - 1)
    r1 = min(r0 + 1, h - 1)
    dc = col - c0
    dr = row - r0
    vals = []
    weights = []
    for r, wr in ((r0, 1 - dr), (r1, dr)):
        for c, wc in ((c0, 1 - dc), (c1, dc)):
            v = grid[r, c]
            if not math.isnan(v):
                vals.append(v)
                weights.append(wr * wc)
    if not vals:
        return None
    return float(sum(v * w for v, w in zip(vals, weights)) / sum(weights))


def sample_elevation_at(
    grid: np.ndarray, t: dict[str, float], x: float, y: float
) -> float | None:
    col, row = world_to_cell(x, y, t)
    return sample_grid_bilinear(grid, col, row)


def sample_slope_at(
    slope_grid: np.ndarray, t: dict[str, float], x: float, y: float
) -> float | None:
    col, row = world_to_cell(x, y, t)
    return sample_grid_bilinear(slope_grid, col, row)


def interior_sample_points(
    ring: list[tuple[float, float]], spacing_m: float
) -> list[tuple[float, float]]:
    if len(ring) < 3:
        return []
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    points: list[tuple[float, float]] = []
    x = min_x
    while x <= max_x:
        y = min_y
        while y <= max_y:
            if point_in_polygon(x, y, ring):
                points.append((x, y))
            y += spacing_m
        x += spacing_m
    return points


def slope_flags(feature_type: str, max_slope: float, mean_slope: float) -> list[str]:
    flags: list[str] = []
    if feature_type == "paver_patio" and max_slope > 2.0:
        flags.append(f"Patio slope {max_slope:.1f}% exceeds 2% — regrade or drain.")
    if feature_type == "putting_green" and max_slope > 1.5:
        flags.append(f"Green slope {max_slope:.1f}% exceeds 1.5%.")
    if feature_type in ("lawn", "ornamental_grass") and max_slope > 25.0:
        flags.append(f"Lawn slope {max_slope:.1f}% exceeds 25%.")
    if max_slope > 33.0:
        flags.append(
            f"Slope {max_slope:.1f}% exceeds 33% — retaining wall or terracing likely."
        )
    return flags


def compute_cut_fill(
    ring: list[tuple[float, float]],
    grid: np.ndarray,
    t: dict[str, float],
    cell_m: float,
    target_elev_m: float,
) -> dict[str, float]:
    spacing = max(cell_m, 0.5)
    pts = interior_sample_points(ring, spacing)
    if len(pts) < 4:
        pts = ring
    cell_area = spacing * spacing
    cut_m3 = 0.0
    fill_m3 = 0.0
    for x, y in pts:
        z = sample_elevation_at(grid, t, x, y)
        if z is None:
            continue
        diff = z - target_elev_m
        if diff > 0:
            cut_m3 += diff * cell_area
        elif diff < 0:
            fill_m3 += (-diff) * cell_area
    return {
        "cutCubicYards": round(cut_m3 * CUBIC_METERS_TO_CY, 2),
        "fillCubicYards": round(fill_m3 * CUBIC_METERS_TO_CY, 2),
        "netCubicYards": round((cut_m3 - fill_m3) * CUBIC_METERS_TO_CY, 2),
    }


def offset_polyline_side(
    a: tuple[float, float], b: tuple[float, float], offset_m: float
) -> tuple[tuple[float, float], tuple[float, float]]:
    dx = b[0] - a[0]
    dy = b[1] - a[1]
    length = math.hypot(dx, dy)
    if length < 1e-6:
        return a, b
    nx = -dy / length * offset_m
    ny = dx / length * offset_m
    return (a[0] + nx, a[1] + ny), (b[0] + nx, b[1] + ny)


def generate_contours(
    grid: np.ndarray,
    t: dict[str, float],
    minor_ft: float,
    major_ft: float,
) -> list[dict[str, Any]]:
    h, w = grid.shape
    valid = grid[~np.isnan(grid)]
    if valid.size == 0:
        return []

    z_min = float(np.min(valid))
    z_max = float(np.max(valid))
    z_min_ft = z_min * METERS_TO_FEET
    z_max_ft = z_max * METERS_TO_FEET

    def level_meters(ft: float) -> float:
        return ft * FEET_TO_METERS

    levels_ft: list[float] = []
    start = math.floor(z_min_ft / minor_ft) * minor_ft
    ft = start
    while ft <= z_max_ft + minor_ft:
        levels_ft.append(round(ft, 3))
        ft += minor_ft

    contours: list[dict[str, Any]] = []

    for level_ft in levels_ft:
        level_m = level_meters(level_ft)
        mask = grid >= level_m
        # March along grid edges — simplified: collect cell centers near level
        lines: list[list[dict[str, float]]] = []
        current: list[dict[str, float]] = []
        for row in range(h - 1):
            for col in range(w - 1):
                z00 = grid[row, col]
                z10 = grid[row, col + 1]
                z01 = grid[row + 1, col]
                if any(math.isnan(v) for v in (z00, z10, z01)):
                    continue
                vals = [z00, z10, z01]
                if min(vals) <= level_m <= max(vals):
                    x = t["c"] + (col + 0.5) * t["a"] + (row + 0.5) * t["b"]
                    y = t["f"] + (col + 0.5) * t["d"] + (row + 0.5) * t["e"]
                    pt = {"x": round(x, 3), "y": round(y, 3)}
                    if not current or math.hypot(pt["x"] - current[-1]["x"], pt["y"] - current[-1]["y"]) < 5.0:
                        current.append(pt)
                    else:
                        if len(current) >= 2:
                            lines.append(current)
                        current = [pt]
        if len(current) >= 2:
            lines.append(current)

        for line in lines:
            if len(line) < 2:
                continue
            is_major = abs(level_ft % major_ft) < 0.01 or abs(level_ft % major_ft - major_ft) < 0.01
            contours.append(
                {
                    "elevationFeet": level_ft,
                    "major": is_major,
                    "coordinates": line,
                }
            )

    return contours


def drainage_arrows(
    grid: np.ndarray, t: dict[str, float], cell_m: float, spacing_m: float = 8.0
) -> list[dict[str, Any]]:
    slope_grid = slope_pct_from_grid(np.nan_to_num(grid, nan=np.nanmean(grid)), cell_m)
    h, w = grid.shape
    arrows: list[dict[str, Any]] = []
    step = max(1, int(round(spacing_m / cell_m)))
    dz_dy, dz_dx = np.gradient(grid, cell_m, cell_m)

    for row in range(0, h, step):
        for col in range(0, w, step):
            if math.isnan(grid[row, col]):
                continue
            dx = -float(dz_dx[row, col])
            dy = -float(dz_dy[row, col])
            mag = math.hypot(dx, dy)
            if mag < 1e-6:
                continue
            x = t["c"] + col * t["a"] + row * t["b"]
            y = t["f"] + col * t["d"] + row * t["e"]
            arrows.append(
                {
                    "x": round(x, 2),
                    "y": round(y, 2),
                    "dx": round(dx / mag, 4),
                    "dy": round(dy / mag, 4),
                    "slopePct": round(float(slope_grid[row, col]), 2),
                }
            )
    return arrows


def analyze(
    dtm_path: Path,
    features: list[dict[str, Any]],
    cache_path: Path | None,
    contour_minor_ft: float,
    contour_major_ft: float,
) -> dict[str, Any]:
    if cache_path and cache_path.is_file():
        cache = load_cache(cache_path)
    else:
        cache = load_cache(
            Path(
                build_cache(dtm_path, dtm_path.parent / "dtm-cache.json")["cachePath"]
            )
        )

    grid, t, cell_m = cache_to_grid(cache)
    slope_grid = slope_pct_from_grid(
        np.nan_to_num(grid, nan=np.nanmedian(grid)), cell_m
    )

    feature_results: list[dict[str, Any]] = []

    for feat in features:
        if feat.get("existing"):
            continue
        geom = feat.get("geometry") or {}
        kind = geom.get("kind")
        coords = geom.get("coordinates") or []
        if not coords:
            continue

        feature_type = feat.get("featureType", "")
        fid = feat.get("id", "")
        label = feat.get("label", fid)

        ring = ring_from_coords(coords)
        sample_pts = list(ring)
        if kind == "polygon":
            sample_pts.extend(interior_sample_points(ring, max(cell_m * 2, 1.0)))

        elevations_m: list[float] = []
        slopes: list[float] = []
        for x, y in sample_pts:
            z = sample_elevation_at(grid, t, x, y)
            s = sample_slope_at(slope_grid, t, x, y)
            if z is not None:
                elevations_m.append(z)
            if s is not None:
                slopes.append(s)

        if not elevations_m:
            continue

        min_e = min(elevations_m)
        max_e = max(elevations_m)
        mean_e = sum(elevations_m) / len(elevations_m)
        min_slope = min(slopes) if slopes else 0.0
        max_slope = max(slopes) if slopes else 0.0
        mean_slope = sum(slopes) / len(slopes) if slopes else 0.0

        result: dict[str, Any] = {
            "featureId": fid,
            "featureType": feature_type,
            "label": label,
            "elevationFeet": {
                "min": round(min_e * METERS_TO_FEET, 2),
                "max": round(max_e * METERS_TO_FEET, 2),
                "mean": round(mean_e * METERS_TO_FEET, 2),
            },
            "slopePct": {
                "min": round(min_slope, 2),
                "max": round(max_slope, 2),
                "mean": round(mean_slope, 2),
            },
            "flags": slope_flags(feature_type, max_slope, mean_slope),
        }

        target_ft = feat.get("targetElevationFeet")
        if target_ft is not None and kind == "polygon":
            target_m = float(target_ft) * FEET_TO_METERS
            result["cutFill"] = compute_cut_fill(ring, grid, t, cell_m, target_m)
            result["targetElevationFeet"] = float(target_ft)

        if feature_type == "water_feature" and len(ring) >= 1:
            top_z = max_e
            bottom_z = min_e
            result["waterFeatureHead"] = {
                "topElevationFeet": round(top_z * METERS_TO_FEET, 2),
                "bottomElevationFeet": round(bottom_z * METERS_TO_FEET, 2),
                "headFeet": round((top_z - bottom_z) * METERS_TO_FEET, 2),
            }

        if feature_type == "retaining_wall" and kind == "polyline" and len(ring) >= 2:
            offset = max(cell_m, 0.3)
            samples: list[dict[str, Any]] = []
            for i in range(len(ring) - 1):
                a, b = ring[i], ring[i + 1]
                left_a, left_b = offset_polyline_side(a, b, offset)
                right_a, right_b = offset_polyline_side(a, b, -offset)
                mid_x = (a[0] + b[0]) / 2
                mid_y = (a[1] + b[1]) / 2
                z_left = sample_elevation_at(grid, t, left_a[0], left_a[1])
                z_right = sample_elevation_at(grid, t, right_a[0], right_a[1])
                if z_left is None or z_right is None:
                    continue
                exposed_ft = abs(z_left - z_right) * METERS_TO_FEET
                entry: dict[str, Any] = {
                    "x": round(mid_x, 2),
                    "y": round(mid_y, 2),
                    "exposedHeightFeet": round(exposed_ft, 2),
                }
                if exposed_ft > 4.0:
                    entry["flag"] = "Exposed height exceeds 4 ft — engineering by others."
                samples.append(entry)
            if samples:
                result["retainingWall"] = {"samples": samples}

        feature_results.append(result)

    contours = generate_contours(grid, t, contour_minor_ft, contour_major_ft)
    arrows = drainage_arrows(grid, t, cell_m)

    return {
        "crs": cache.get("crs"),
        "dtmBounds": cache.get("boundsProjected"),
        "features": feature_results,
        "contours": contours,
        "drainageArrows": arrows,
        "contourSettings": {
            "minorFeet": contour_minor_ft,
            "majorFeet": contour_major_ft,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="DTM cache and elevation analysis")
    sub = parser.add_subparsers(dest="command", required=True)

    cache_p = sub.add_parser("build-cache")
    cache_p.add_argument("dtm", type=Path)
    cache_p.add_argument("--out", type=Path, required=True)
    cache_p.add_argument("--max-cells", type=int, default=400_000)

    analyze_p = sub.add_parser("analyze")
    analyze_p.add_argument("dtm", type=Path)
    analyze_p.add_argument("--features", type=Path, required=True)
    analyze_p.add_argument("--cache", type=Path, default=None)
    analyze_p.add_argument("--contour-minor-ft", type=float, default=1.0)
    analyze_p.add_argument("--contour-major-ft", type=float, default=5.0)

    args = parser.parse_args()

    try:
        if args.command == "build-cache":
            if not args.dtm.is_file():
                print(json.dumps({"error": f"DTM not found: {args.dtm}"}))
                return 1
            result = build_cache(args.dtm, args.out, args.max_cells)
            print(json.dumps(result))
            return 0

        if args.command == "analyze":
            if not args.dtm.is_file():
                print(json.dumps({"error": f"DTM not found: {args.dtm}"}))
                return 1
            features = json.loads(args.features.read_text(encoding="utf-8"))
            if isinstance(features, dict):
                features = features.get("features", [])
            result = analyze(
                args.dtm,
                features,
                args.cache,
                args.contour_minor_ft,
                args.contour_major_ft,
            )
            print(json.dumps(result))
            return 0

        print(json.dumps({"error": "Unknown command"}))
        return 1
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
