# Addendum A — WebODM Georeferenced Inputs

Supplements `SPEC.md`. Where the two conflict, this document wins. Read both before starting.

The source data is not just a JPEG. It is a georeferenced photogrammetry dataset produced by WebODM from a drone flight with ground control points. That means the pixel-to-real-world transform, true north, and per-point elevation are all known values, not things to be estimated. Build the app around that fact.

---

## A1. Project ingest, replacing SPEC §5

A project is created by pointing the app at a WebODM export folder, not by uploading a single image. Ingest these files if present, ignore what is missing, and show me a checklist of what was found.

| File | Purpose in this app | Required |
|---|---|---|
| `odm_orthophoto/odm_orthophoto.tif` | Georeferenced base raster, source of the pixel-to-world transform | Yes |
| `odm_dem/dtm.tif` | Bare-earth elevation. Grading, slope, cut/fill | No but expected |
| `odm_dem/dsm.tif` | Surface elevation including vegetation and structures. Tree heights, roof heights, shade study | No |
| `odm_georeferencing/odm_georeferenced_model.laz` | Point cloud. Used for spot-checking flat surfaces where the DTM has been over-smoothed | No |
| `odm_texturing/odm_textured_model_geo.obj` + `.mtl` + texture PNGs | Real 3D model of the site, used for perspective renders (§A6) | No |
| `odm_georeferencing/proj.txt` | CRS of the dataset, typically WGS 84 / UTM zone 12N in Utah | Yes |
| `gcp_list.txt` | Ground control points. Read to display an accuracy statement | No |
| `odm_report/report.pdf`, `shots.geojson` | Flight metadata, GSD, image count, reprojection error | No |

Parse the GeoTIFF with a Python sidecar using `rasterio` (spawn it from a Node route, or run a small FastAPI service, your call, but keep the geospatial math in Python rather than reimplementing affine handling in TypeScript). Extract and store in `project.json`:

- CRS / EPSG code
- Affine transform (six coefficients)
- Raster width and height in pixels
- Ground sample distance in metres and in inches
- Bounding box in projected coordinates and in WGS84 lat/lon

Everything the SPEC called `pixelsPerFoot` now derives from the affine transform. Delete the two-click calibration tool. Delete the manual north arrow handle, north comes from the CRS.

## A2. Accuracy handling, do not skip this

Georeferencing quality varies and getting this wrong wrecks the deliverable. On a previous project of mine the GPS-only georeferencing was off by 30 percent linear and it took a recorded survey to catch it.

Requirements:

1. On ingest, detect whether the task used GCPs or GPS-only. If `gcp_list.txt` exists, read the point count and label the project "GCP georeferenced". If not, label it "GPS georeferenced" and show a persistent amber banner reading that scale is unverified.
2. Always require one independent scale check before the project can be exported. I click two points on a feature of known real dimension (garage door, driveway width, a surveyed property line) and enter the true measurement. The app computes the ratio and displays it. Within 2 percent, pass. Beyond that, block export and show the discrepancy.
3. Store `scaleVerification` in the project file with the check I performed, the expected value, the measured value, and the ratio. Print it in small type on the exported sheet.
4. Never label output as survey grade. The sheet gets a note: derived from aerial photogrammetry, not a boundary survey, subject to verification.

## A3. Annotation base export, replacing SPEC §5.1

I annotate on my phone, so I need a right-sized image to draw on. The app generates it rather than me exporting something arbitrary.

Add an "Export annotation base" action that writes `annotation-base.jpg` at a configurable long edge, default 4000px, plus `annotation-base.json` containing the downscale factor and the affine transform for that exact raster. I draw on that file, upload it back, and the app has an exact pixel-to-world mapping with no guesswork.

Reject an uploaded annotated image whose dimensions do not match the recorded base, with a clear message telling me to re-export.

## A4. Feature geometry is georeferenced, replacing SPEC §6 and §7

Change the canonical geometry store. Real-world coordinates are the source of truth, pixel coordinates are derived for display.

```ts
geometry: {
  kind: "polygon" | "point" | "polyline",
  crs: string,                       // e.g. "EPSG:32612"
  coordinates: [{ x: number, y: number, z?: number }],  // projected metres
  radius?: number                    // metres
}
```

Claude still returns normalized 0 to 1 image coordinates as described in SPEC §6, since that is what a vision model can actually do. Convert to projected coordinates immediately on receipt using the affine transform, then discard the normalized values. The polygon editor works in screen space and writes back through the inverse transform.

Consequences worth building on:

- Areas and lengths are computed geometrically in metres and displayed in feet, no calibration factor involved
- Every feature has a real address on the ground, so it can be staked out with a GPS rover
- Two flights of the same property register against each other automatically

## A5. Elevation, the thing the flat JPEG could never give you

Sample the DTM raster at feature vertices and across feature interiors on a grid. This unlocks the following, and each should be its own module built after the core pipeline works:

1. **Slope analysis.** Per-feature min, max, and mean slope percentage. Flag any `paver_patio` over 2 percent, any `putting_green` over 1.5 percent, any `lawn` over 25 percent, and anything over 33 percent as needing a wall or terracing.
2. **Contours.** Generate contours from the DTM at a configurable interval, 1ft minor and 5ft major by default. Smooth them, because raw DTM contours off a vegetated site are noisy garbage. Render as an optional layer on the plan sheet and export to DXF.
3. **Cut and fill.** For any feature with a `targetElevation` or `targetSlope` I set, compute cut volume, fill volume, and net in cubic yards by differencing the proposed pad against the DTM. This feeds the takeoff directly. A level putting green pad on a sloped lot is where the real money is and clients never believe it until they see the number.
4. **Water feature head.** For a `water_feature`, report the elevation drop from the top circle to the bottom of the pond. That is the pump sizing input and the thing that determines whether the waterfall reads as a trickle or a feature.
5. **Retaining wall heights.** For any `retaining_wall` feature drawn as a polyline, sample elevation along both sides and report exposed height at intervals. Flag anything over 4ft as requiring engineering by others.
6. **Drainage arrows.** Compute the flow direction grid from the DTM and draw sparse flow arrows on the grading sheet. Flag any proposed hardscape that sits in a flow path.

Pass the computed slope and elevation numbers to Claude in the design content call as facts. Claude formats and comments on them, Claude does not calculate them.

## A6. Real 3D renders, replacing SPEC §11

The textured mesh is a model of the actual house on the actual lot. Use it.

Pipeline:

1. Headless Blender via a Python script. Import `odm_textured_model_geo.obj`.
2. Place proposed features into the scene as extruded geometry from the georeferenced polygons: patio slabs at their pad elevation, pergola as a parametric frame, walls as extrusions, water feature as a plane with a water shader, trees as billboard or low-poly proxies scaled to the mature size from the plant palette.
3. Camera positions defined in project coordinates so I can set a view once and re-render it after design changes. Include presets: front elevation, rear yard hero, oblique overhead at 45 degrees, and eye-level from the back door.
4. Sun position computed from the site's real lat/lon and a chosen date and time, which also gives a genuine shade study rather than a guess.
5. Render to PNG, cache in the project folder.

The output will be geometrically true and visually plain, which is the opposite trade-off from an AI render. So keep the image model provider from SPEC §11 as a second stage: feed the Blender render in as the image-to-image reference at moderate denoising strength, with the prompt from `renderPrompts`. You get the real house and the real layout with a rendered finish on top. That is the whole trick, and it is why the image model is a post-process rather than the source.

Build order within this section: static Blender render first, verify it looks like the property, only then add the image-to-image pass behind a flag.

## A7. Exports, new section

The georeferenced geometry needs to leave this app in formats other software accepts. Add an export panel:

- **DXF** of all proposed features, in projected coordinates, layered by class using my Vectorworks scheme: `Ex-Building`, `Ex-Boundary`, `Ex-Trees`, `Prop-Hardscape`, `Prop-Wall`, `Prop-Structure`, `Prop-Plant`. Units in feet. I import this into Vectorworks Landmark for the buildable plan set, so getting the layer names and units right saves me an hour every time.
- **GeoJSON** of the same features in WGS84, for GIS and for anything web-based.
- **KML/KMZ** for viewing in Google Earth and for handing a contractor something they can open on a phone.
- **CSV of stakeout points**, one row per polygon vertex with a point ID, northing, easting, elevation, and feature label.
- **Contours DXF** at the chosen interval.

## A8. Performance notes

- A full resolution ortho at 0.24in GSD runs around 26,000 px wide. Never load that into the browser and never send it to Claude.
- Generate a tile pyramid on ingest with `gdal2tiles` or convert to a Cloud Optimized GeoTIFF and serve tiles. The canvas editor reads tiles.
- Claude vision gets a downsampled copy at 1568px long edge maximum. That is plenty for reading marker scribbles.
- Keep the full resolution raster for print export only, cropped to the sheet viewport before rasterizing.
- DEM sampling for a whole site can be slow in a request cycle. Compute it once on ingest into a cached grid, then sample the cache.

## A9. Revised build order

Replaces SPEC §13 (applied in `SPEC.md`).

1. WebODM folder ingest, GeoTIFF parsing, CRS and transform extraction, tile pyramid generation
2. Annotation base export and re-upload matching
3. `/api/interpret` with immediate conversion to projected coordinates
4. Polygon editor working in projected space with true areas
5. Scale verification gate and accuracy banner
6. SVG plan renderer
7. DTM sampling, slope analysis, cut and fill
8. `/api/design-content` with elevation facts included
9. Board template and PDF export
10. DXF and GeoJSON export
11. Blender render pipeline
12. Image-to-image finishing pass behind a flag

Steps 1 through 6 are the product. Everything after is upside.
