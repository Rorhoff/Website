#!/usr/bin/env python3
"""Verify cv2, numpy, and Pillow import for LDBG Python sidecars."""

from __future__ import annotations

import json
import sys


def main() -> int:
    try:
        import cv2  # noqa: F401
        import numpy  # noqa: F401
        from PIL import Image  # noqa: F401

        print(json.dumps({"ok": True}))
        return 0
    except ImportError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
