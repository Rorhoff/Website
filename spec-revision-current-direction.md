# SPEC Revision — Plan Rendering Pipeline

Replaces §3 in prior revisions and supersedes clipped-fills-only watercolor base design in full. §2 division of authority, §4 feature types, §5 board export stand unless amended below.

---

## §1 What testing established

Three approaches were tested against a real annotated orthophoto.

**Whole-image AI fill from a color mask.** Materials rendered well, but the model bled outside marked regions. In one run it read an existing boulder retaining wall as a continuation of a small water feature and rendered a stream the full length of the property. Asking a model to respect a boundary does not work.

**Deterministic watercolor filter.** Preserves geometry exactly, but cannot produce the hand-drawn look. Ink linework around roof planes, boulders, tree canopies, and hardscape edges does not exist in the source photograph, and no pixel filter invents them. Output reads as a desaturated photo.

**Whole-image style transfer applied after material fill.** Produced the target look on the first attempt: pen outlines, watercolor wash, drawn tree symbols, outlined stone. This is the mechanism that works.

The style pass also shifts the frame — zoomed out with white paper margin. Global affine shift, correctable.

## §2 Division of authority

Measured geometry is authoritative for quantities, callouts, labels, and export. Pixel layers (composite, style pass) are illustrative and cannot move vector geometry.

## §3 Pipeline

Ordered stages. Each output is cached; regenerate only when inputs change.

```
1. Clean orthophoto
2. Per-feature material fills, clipped to vector polygons
3. Composite
4. Style pass over the composite          <- shifts the frame
5. Registration correction                 <- undoes the shift
6. Vector overlay: callouts, labels, scale bar, north arrow
```

Stages 2–3 control content. Stage 4 controls appearance. Stage 5 restores geometric truth. Stage 6 is exact by construction (vector at known coordinates).

Style must run over the composite, not under it — one pass unifies new features with existing site and puts consistent linework across both.

### Stage 2 — per-feature material fills

`POST /api/feature-fill`, one feature at a time.

1. Crop clean orthophoto to feature bounding box + 10%.
2. Upscale long edge ≥ 1024px.
3. Single-material prompt with real dimensions.
4. Composite through SVG `clipPath` from smoothed polygon.

Clip is enforcement — do not prompt the model to stay inside a boundary.

Per-feature state: `none | generating | filled | failed`. Fill all empty + per-feature regenerate.

### Stage 4 — style pass

`POST /api/style-pass` on the composited image. Presets in `config/styles.ts`: `watercolor-plan` (default), `ink-only`, `marker`, `photoreal`, `off`.

Every prompt appends the constraint block (no new elements, no text/annotations).

Reference images: 1–3 per preset in `/public/styles/` where supported.

### Stage 5 — registration correction

Patch match on edge maps → similarity transform (RANSAC) → inverse warp → crop to original frame.

Quality gate (residual as % of image width):

- &lt; 0.2%: inline labels OK
- 0.2–1%: numbered callouts only
- &gt; 1% or &lt; 5 inliers: failed — fall back to `off`, surface error

Never silently proceed with failed correction.

### Stage 6 — vector overlay

SVG at project coordinates over corrected image: optional thin outlines, callouts, labels, north arrow (≤ 0.75in sheet), scale bar.

## §4 Feature types

(Unchanged — linear features with width, legend types, polyline buffer, etc.)

## §5 Board export

Fixed canvas export. Style-pass image at print resolution when preset ≠ `off`. Force AI disclosure note (§7).

## §6 Sheet disclosure

When style preset ≠ `off`, force this general note (not togglable):

> Plan graphics include AI-generated renderings for illustrative purposes. All dimensions, areas, and quantities are derived from measured design geometry, not from rendered imagery.

## §7 Cut list (amended)

- **Watercolor filter pipeline** — cut from plan panel; `scripts/watercolor.py` may remain but is not offered in UI. Style transfer supersedes it.
- **Procedural symbology** — cut; style pass produces linework.
- Whole-image AI plan render with color mask — cut.
- Flat translucent fills — **editor canvas only**.

## §8 Build order

1. Fixed-canvas board export
2. Linear feature types + polyline tool
3. Per-feature crop preview UI
4. `/api/feature-fill` + caching
5. Clipped compositing
6. `/api/style-pass` + presets
7. Registration correction + quality gate
8. Vector overlay

Steps 1–5 produce a usable sheet without style pass. Complete 1–5 before starting 6.
