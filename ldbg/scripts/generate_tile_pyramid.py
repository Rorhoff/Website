#!/usr/bin/env python3
"""Build a pixel-space XYZ tile pyramid from a GeoTIFF (Addendum A8).

Usage:
  python generate_tile_pyramid.py /path/to/ortho.tif --out /path/to/tiles/dir

Output layout: {out}/{z}/{x}/{y}.jpg plus writes manifest JSON to stdout.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

try:
    import numpy as np
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.windows import Window
    from PIL import Image
except ImportError as exc:
    print(json.dumps({"error": str(exc), "hint": "pip install -r scripts/requirements-geo.txt"}))
    sys.exit(2)

TILE_SIZE = 256


def build_pyramid(tif_path: Path, out_dir: Path, tile_size: int = TILE_SIZE) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)

    with rasterio.open(tif_path) as src:
        full_w = int(src.width)
        full_h = int(src.height)
        if full_w <= 0 or full_h <= 0:
            raise ValueError("Invalid raster dimensions")

        max_zoom = max(0, math.ceil(math.log2(max(full_w, full_h) / tile_size)))

        for z in range(max_zoom + 1):
            px_per_tile = tile_size * (2 ** (max_zoom - z))
            grid_w = max(1, math.ceil(full_w / px_per_tile))
            grid_h = max(1, math.ceil(full_h / px_per_tile))
            z_dir = out_dir / str(z)
            z_dir.mkdir(parents=True, exist_ok=True)

            for ty in range(grid_h):
                for tx in range(grid_w):
                    x0 = tx * px_per_tile
                    y0 = ty * px_per_tile
                    win_w = min(px_per_tile, full_w - x0)
                    win_h = min(px_per_tile, full_h - y0)
                    if win_w <= 0 or win_h <= 0:
                        continue

                    data = src.read(
                        1,
                        window=Window(x0, y0, win_w, win_h),
                        boundless=True,
                        fill_value=0,
                        out_shape=(int(win_h), int(win_w)),
                        resampling=Resampling.bilinear,
                    )

                    if src.count >= 3:
                        r = src.read(1, window=Window(x0, y0, win_w, win_h), boundless=True, fill_value=0,
                                     out_shape=(int(win_h), int(win_w)), resampling=Resampling.bilinear)
                        g = src.read(2, window=Window(x0, y0, win_w, win_h), boundless=True, fill_value=0,
                                     out_shape=(int(win_h), int(win_w)), resampling=Resampling.bilinear)
                        b = src.read(3, window=Window(x0, y0, win_w, win_h), boundless=True, fill_value=0,
                                     out_shape=(int(win_h), int(win_w)), resampling=Resampling.bilinear)
                        rgb = np.stack([r, g, b], axis=-1)
                    else:
                        rgb = np.stack([data, data, data], axis=-1)

                    if rgb.dtype != np.uint8:
                        lo, hi = np.percentile(rgb[rgb > 0], [2, 98]) if np.any(rgb > 0) else (0, 1)
                        if hi <= lo:
                            lo, hi = float(np.min(rgb)), float(np.max(rgb))
                        rgb = np.clip((rgb - lo) / max(hi - lo, 1e-6) * 255, 0, 255).astype(np.uint8)

                    img = Image.fromarray(rgb.astype(np.uint8), mode="RGB")
                    if img.width != tile_size or img.height != tile_size:
                        canvas = Image.new("RGB", (tile_size, tile_size), (0, 0, 0))
                        canvas.paste(img, (0, 0))
                        img = canvas

                    x_dir = z_dir / str(tx)
                    x_dir.mkdir(parents=True, exist_ok=True)
                    img.save(x_dir / f"{ty}.jpg", format="JPEG", quality=82, optimize=True)

    manifest = {
        "root": "tiles/orthophoto",
        "tileSize": tile_size,
        "minZoom": 0,
        "maxZoom": max_zoom,
        "fullWidthPx": full_w,
        "fullHeightPx": full_h,
    }
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate orthophoto tile pyramid")
    parser.add_argument("tif", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--tile-size", type=int, default=TILE_SIZE)
    args = parser.parse_args()

    if not args.tif.is_file():
        print(json.dumps({"error": f"Not found: {args.tif}"}))
        return 1

    try:
        manifest = build_pyramid(args.tif, args.out, args.tile_size)
        from datetime import datetime, timezone

        manifest["builtAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        print(json.dumps(manifest))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
