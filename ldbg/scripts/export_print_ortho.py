#!/usr/bin/env python3
"""Export a downsampled full-site orthophoto JPEG for print/board export (A8).

Usage:
  python export_print_ortho.py /path/to/ortho.tif --out /path/to/print-ortho.jpg --long-edge 12000
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import numpy as np
    import rasterio
    from rasterio.enums import Resampling
    from PIL import Image
except ImportError as exc:
    print(json.dumps({"error": str(exc)}))
    sys.exit(2)


def export_print_ortho(tif_path: Path, out_path: Path, long_edge: int) -> dict:
    with rasterio.open(tif_path) as src:
        w, h = int(src.width), int(src.height)
        scale = long_edge / max(w, h) if max(w, h) > long_edge else 1.0
        out_w = max(1, int(round(w * scale)))
        out_h = max(1, int(round(h * scale)))

        if src.count >= 3:
            data = src.read(
                out_shape=(src.count, out_h, out_w),
                resampling=Resampling.lanczos,
            )
            rgb = np.stack([data[0], data[1], data[2]], axis=-1)
        else:
            band = src.read(1, out_shape=(out_h, out_w), resampling=Resampling.lanczos)
            rgb = np.stack([band, band, band], axis=-1)

        if rgb.dtype != np.uint8:
            lo, hi = np.percentile(rgb[rgb > 0], [2, 98]) if np.any(rgb > 0) else (0, 1)
            if hi <= lo:
                lo, hi = float(np.min(rgb)), float(np.max(rgb))
            rgb = np.clip((rgb - lo) / max(hi - lo, 1e-6) * 255, 0, 255).astype(np.uint8)

        out_path.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(rgb.astype(np.uint8), mode="RGB").save(
            out_path, format="JPEG", quality=90, optimize=True
        )

        return {
            "width": out_w,
            "height": out_h,
            "longEdgePx": long_edge,
            "sourceWidthPx": w,
            "sourceHeightPx": h,
            "downscaleFactor": w / out_w if out_w else 1,
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("tif", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--long-edge", type=int, default=12000)
    args = parser.parse_args()

    if not args.tif.is_file():
        print(json.dumps({"error": f"Not found: {args.tif}"}))
        return 1

    try:
        from datetime import datetime, timezone

        result = export_print_ortho(args.tif, args.out, args.long_edge)
        result["exportedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        print(json.dumps(result))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
