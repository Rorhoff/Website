#!/usr/bin/env python3
"""Export a phone-friendly annotation base JPEG + sidecar JSON from a GeoTIFF.

Usage:
  python export_annotation_base.py ortho.tif --out annotation-base.jpg --meta-out annotation-base.json
  python export_annotation_base.py ortho.tif --out base.jpg --meta-out base.json --max-edge 4000

Requires: rasterio, pyproj, numpy, Pillow (see requirements-geo.txt)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import numpy as np
    import rasterio
    from PIL import Image
    from rasterio.enums import Resampling
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


def export_annotation_base(
    tif_path: Path,
    jpg_out: Path,
    meta_out: Path,
    max_edge: int = 4000,
) -> dict:
    with rasterio.open(tif_path) as src:
        full_w = int(src.width)
        full_h = int(src.height)
        transform = src.transform
        crs = src.crs
        if crs is None:
            raise ValueError("GeoTIFF has no CRS — cannot georeference")

        epsg = crs.to_epsg()
        crs_label = crs.to_string() if epsg is None else f"EPSG:{epsg}"

        long_edge = max(full_w, full_h)
        if long_edge > max_edge:
            scale = max_edge / long_edge
            out_w = max(1, int(round(full_w * scale)))
            out_h = max(1, int(round(full_h * scale)))
        else:
            out_w, out_h = full_w, full_h
            scale = 1.0

        downscale_factor = full_w / out_w if out_w else 1.0

        data = src.read(
            out_shape=(src.count, out_h, out_w),
            resampling=Resampling.bilinear,
        )

        if src.count >= 3:
            rgb = np.stack([data[0], data[1], data[2]], axis=-1)
        else:
            band = data[0]
            rgb = np.stack([band, band, band], axis=-1)

        if rgb.dtype != np.uint8:
            if np.issubdtype(rgb.dtype, np.floating):
                lo, hi = np.nanpercentile(rgb, [2, 98])
                if hi <= lo:
                    lo, hi = float(np.nanmin(rgb)), float(np.nanmax(rgb))
                rgb = np.clip((rgb - lo) / max(hi - lo, 1e-6) * 255, 0, 255)
            rgb = rgb.astype(np.uint8)

        jpg_out.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(rgb, mode="RGB").save(
            jpg_out, format="JPEG", quality=88, optimize=True
        )

        # Map base pixel (col, row) -> world: scale full transform by downscale_factor
        s = downscale_factor
        base_affine = {
            "a": float(transform.a * s),
            "b": float(transform.b * s),
            "c": float(transform.c),
            "d": float(transform.d * s),
            "e": float(transform.e * s),
            "f": float(transform.f),
        }

        gsd_x = abs(base_affine["a"])
        gsd_y = abs(base_affine["e"])
        gsd_meters = (gsd_x + gsd_y) / 2.0
        pixels_per_foot = 0.3048 / gsd_meters if gsd_meters > 0 else None

        meta = {
            "width": out_w,
            "height": out_h,
            "longEdgePx": max(out_w, out_h),
            "downscaleFactor": downscale_factor,
            "affine": base_affine,
            "pixelsPerFoot": pixels_per_foot,
            "crs": crs_label,
            "epsg": epsg,
            "fullWidthPx": full_w,
            "fullHeightPx": full_h,
            "sourceTif": str(tif_path.name),
        }

        meta_out.parent.mkdir(parents=True, exist_ok=True)
        meta_out.write_text(json.dumps(meta, indent=2), encoding="utf-8")

        return meta


def main() -> int:
    parser = argparse.ArgumentParser(description="Export annotation base JPEG + JSON")
    parser.add_argument("tif", type=Path, help="Source GeoTIFF")
    parser.add_argument("--out", type=Path, required=True, help="Output JPEG path")
    parser.add_argument("--meta-out", type=Path, required=True, help="Output JSON path")
    parser.add_argument(
        "--max-edge",
        type=int,
        default=4000,
        help="Long edge in pixels (default 4000)",
    )
    args = parser.parse_args()

    if not args.tif.is_file():
        print(json.dumps({"error": f"File not found: {args.tif}"}))
        return 1

    try:
        result = export_annotation_base(
            args.tif, args.out, args.meta_out, args.max_edge
        )
        print(json.dumps(result))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
