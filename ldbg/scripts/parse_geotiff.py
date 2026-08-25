#!/usr/bin/env python3
"""Parse a georeferenced orthophoto GeoTIFF and emit metadata as JSON.

Usage:
  python parse_geotiff.py /path/to/odm_orthophoto.tif
  python parse_geotiff.py /path/to.tif --preview-out /path/to/preview.jpg --preview-max-edge 4000

Requires: rasterio, pyproj, numpy (see requirements-geo.txt)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import rasterio
    from pyproj import Transformer
    from rasterio.warp import transform_bounds
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
        ),
        file=sys.stdout,
    )
    sys.exit(2)


def parse_geotiff(
    tif_path: Path,
    preview_out: Path | None = None,
    preview_max_edge: int = 4000,
) -> dict:
    with rasterio.open(tif_path) as src:
        transform = src.transform
        width_px = int(src.width)
        height_px = int(src.height)
        crs = src.crs
        if crs is None:
            raise ValueError("GeoTIFF has no CRS — cannot georeference")

        crs_wkt = crs.to_string()
        epsg = crs.to_epsg()

        gsd_x = abs(float(transform.a))
        gsd_y = abs(float(transform.e))
        gsd_meters = (gsd_x + gsd_y) / 2.0
        gsd_inches = gsd_meters / 0.0254

        bounds = src.bounds
        bounds_projected = {
            "minX": float(bounds.left),
            "minY": float(bounds.bottom),
            "maxX": float(bounds.right),
            "maxY": float(bounds.top),
        }

        try:
            wgs_bounds = transform_bounds(crs, "EPSG:4326", *bounds)
            bounds_wgs84 = {
                "minX": float(wgs_bounds[0]),
                "minY": float(wgs_bounds[1]),
                "maxX": float(wgs_bounds[2]),
                "maxY": float(wgs_bounds[3]),
            }
        except Exception:
            # Fallback manual transform
            transformer = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
            corners = [
                (bounds.left, bounds.bottom),
                (bounds.right, bounds.bottom),
                (bounds.right, bounds.top),
                (bounds.left, bounds.top),
            ]
            lons, lats = transformer.transform(*zip(*corners))
            bounds_wgs84 = {
                "minX": float(min(lons)),
                "minY": float(min(lats)),
                "maxX": float(max(lons)),
                "maxY": float(max(lats)),
            }

        affine = {
            "a": float(transform.a),
            "b": float(transform.b),
            "c": float(transform.c),
            "d": float(transform.d),
            "e": float(transform.e),
            "f": float(transform.f),
        }

        preview_width: int | None = None
        preview_height: int | None = None

        if preview_out is not None:
            preview_out.parent.mkdir(parents=True, exist_ok=True)
            long_edge = max(width_px, height_px)
            if long_edge > preview_max_edge:
                scale = preview_max_edge / long_edge
                out_w = max(1, int(round(width_px * scale)))
                out_h = max(1, int(round(height_px * scale)))
            else:
                out_w, out_h = width_px, height_px

            from rasterio.enums import Resampling

            data = src.read(
                out_shape=(src.count, out_h, out_w),
                resampling=Resampling.bilinear,
            )

            import numpy as np
            from PIL import Image

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

            Image.fromarray(rgb, mode="RGB").save(
                preview_out, format="JPEG", quality=85, optimize=True
            )

            preview_width = out_w
            preview_height = out_h

        meters_per_foot = 0.3048
        pixels_per_foot = meters_per_foot / gsd_meters if gsd_meters > 0 else None

        result: dict = {
            "crs": crs_wkt if epsg is None else f"EPSG:{epsg}",
            "epsg": epsg,
            "affine": affine,
            "widthPx": width_px,
            "heightPx": height_px,
            "gsdMeters": gsd_meters,
            "gsdInches": gsd_inches,
            "boundsProjected": bounds_projected,
            "boundsWgs84": bounds_wgs84,
            "pixelsPerFoot": pixels_per_foot,
        }

        if preview_width is not None:
            result["previewWidth"] = preview_width
            result["previewHeight"] = preview_height

        return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Parse georeferenced GeoTIFF metadata")
    parser.add_argument("tif", type=Path, help="Path to GeoTIFF")
    parser.add_argument(
        "--preview-out",
        type=Path,
        default=None,
        help="Write a downsampled JPEG preview to this path",
    )
    parser.add_argument(
        "--preview-max-edge",
        type=int,
        default=4000,
        help="Long edge of preview JPEG in pixels (default 4000)",
    )
    args = parser.parse_args()

    if not args.tif.is_file():
        print(json.dumps({"error": f"File not found: {args.tif}"}))
        return 1

    try:
        result = parse_geotiff(args.tif, args.preview_out, args.preview_max_edge)
        print(json.dumps(result))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
