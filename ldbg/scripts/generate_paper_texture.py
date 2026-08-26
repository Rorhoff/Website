#!/usr/bin/env python3
"""Generate tileable cold-press paper texture for watercolor filter (Addendum C7)."""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def generate_paper_texture(size: int = 2048, seed: int = 11) -> np.ndarray:
    rng = np.random.default_rng(seed)
    base = np.full((size, size, 3), 245, dtype=np.float32)

    noise = rng.normal(0, 1, (size, size)).astype(np.float32)
    for sigma in (1.2, 3.5, 8.0, 18.0):
        noise += cv2.GaussianBlur(rng.normal(0, 1, (size, size)).astype(np.float32), (0, 0), sigma)

    noise = (noise - noise.min()) / max(noise.max() - noise.min(), 1e-6)
    base -= noise[..., np.newaxis] * 18

    # Subtle directional fibers
    fiber = rng.normal(0, 1, (size, size)).astype(np.float32)
    fiber = cv2.GaussianBlur(fiber, (0, 0), sigmaX=0.8, sigmaY=12)
    fiber = (fiber - fiber.min()) / max(fiber.max() - fiber.min(), 1e-6)
    base -= fiber[..., np.newaxis] * 6

    # Make tileable by blending edges
    blend = 64
    for axis in (0, 1):
        sl = [slice(None)] * 3
        opp = [slice(None)] * 3
        sl[axis] = slice(0, blend)
        opp[axis] = slice(-blend, None)
        a = base[tuple(sl)]
        b = base[tuple(opp)]
        ramp = np.linspace(1, 0, blend, dtype=np.float32)
        if axis == 0:
            ramp = ramp[:, np.newaxis, np.newaxis]
        else:
            ramp = ramp[np.newaxis, :, np.newaxis]
        base[tuple(sl)] = a * ramp + b * (1 - ramp)

    return np.clip(base, 210, 255).astype(np.uint8)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--size", type=int, default=2048)
    args = parser.parse_args()
    tex = generate_paper_texture(args.size)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(tex, mode="RGB").save(args.out, format="JPEG", quality=92)
    print(f"Wrote {args.out} ({args.size}x{args.size})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
