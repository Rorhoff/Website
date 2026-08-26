# SPEC Revision — Current Direction

Living document for LDBG plan sheet architecture. §3 was replaced per the per-feature fill design (Aug 2026).

## §1 Cut list

- Whole-image AI plan render with color mask (replaced by §3 below)
- Phase-correlation registration check (not needed with clipped fills)

**Amendment:** The deterministic watercolor pipeline is **not** cut. It is the plan panel base layer (§2).

## §2 Division of authority

Measured geometry is authoritative for quantities, callouts, and export. Pixel layers (watercolor filter, clipped fills) are illustrative and cannot move vector geometry.

## §3 Base layer — deterministic watercolor filter

Python sidecar `scripts/watercolor.py` (OpenCV + Pillow) on the clean orthophoto.

**Hard constraint:** output dimensions equal input dimensions. Assert and fail loudly.

Pipeline (parameters in `config/watercolor.ts`):

1. Bilateral filter
2. `cv2.stylization`
3. Posterize (16–24 levels)
4. HSV saturation lift + value floor
5. Edge darkening
6. Granulation
7. Paper texture from `/public/textures/paper-cold-press.jpg`
8. Edge feathering with irregular alpha

Presets: `off`, `desaturated`, `watercolor-soft` (default), `watercolor-heavy`, `ink-wash`.

Plan panel only — never on drone thumbnail or clean orthophoto thumbnail.

Cache on source + preset + parameters. Full-res PNG for print, ~2000px preview for browser. Background job with progress.

## §3 (replacement) Feature fills — per-feature crops with hard clipping

Route: `POST /api/feature-fill`

Per feature:

1. Bounding box + 10% margin
2. Crop **clean** orthophoto (not filtered)
3. Upscale long edge to ≥1024px
4. Single-material prompt from `config/legend.ts`
5. Model returns image
6. Composite through SVG `clipPath` from smoothed polygon

Registration is not required — clip enforces boundary.

Returned crop runs watercolor steps 3–7 before compositing. Clip feather 2–4px. Optional thin vector outline.

Per-feature state: `none | generating | filled | failed`. Regenerate one feature or fill all empty. Cache on geometry + material + prompt version.

## §4 Feature types

(Unchanged — linear features with width, legend types, polyline buffer, etc.)

## §5 Board export

Fixed 3600×2400 canvas. Watercolor base ensured at print resolution on export.

## §6 Compositing stack (bottom to top)

1. Watercolor-filtered orthophoto
2. Flat-fill demolition masks (optional)
3. Per-feature clipped material fills
4. Optional vector outlines
5. Numbered callouts
6. Feature labels + areas
7. North arrow + scale bar

## §7 Build order

1. Fixed-canvas board export
2. Linear feature types + polyline tool
3. Watercolor filter pipeline + preset selector
4. Per-feature crop preview UI
5. `/api/feature-fill` + caching + cost tracking
6. Clipped compositing + shared watercolor treatment on fills
7. Callouts, labels, scale bar over composite

## §8 What this does not solve

Bare soil cannot become mature planting via filter alone. Draw planting beds as features or use demolition flat-fill masks.
