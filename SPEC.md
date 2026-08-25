# LDBG — Landscape Design Board Generator — Build Spec

Paste this into Cursor as `SPEC.md` at the project root, then work through the milestones in order. Do not skip ahead. Ask me before adding dependencies not listed here.

For WebODM georeferenced projects, use the revised build order in **§13** (from Addendum A §A9). Read [`SPEC-A-webodm.md`](SPEC-A-webodm.md) alongside this file; where they conflict, the addendum wins.

---

## 1. What this app does

I do landscape design. I fly a drone over a property, process it in WebODM to get an orthophoto, then scribble on that photo with my phone using a color code to mark out what goes where. The app takes that scribbled image and turns it into a client-ready presentation board: a clean scaled plan drawing, a legend, a materials and plant list, concept copy, and perspective renders.

Input: one annotated orthophoto (required), one clean unannotated orthophoto of the same frame (optional but strongly preferred), plus property metadata.

Output: a multi-panel presentation board exported as PNG and PDF, plus a JSON project file that can be reopened and edited.

## 2. Hard constraints

- The Anthropic API does **not** generate images. Claude is used for vision interpretation, structured data extraction, and written copy only.
- All rendered graphics (plan overlay, legend, callouts, board layout) are produced deterministically with SVG and HTML, not by an AI image model.
- Photorealistic perspective renders come from a separate image model behind a provider interface (see §8). This is optional and gated behind a feature flag. Build everything else first.
- The API key lives server-side in `.env.local` only. Never expose it to the browser, never commit it, never put it in a client bundle. All Anthropic calls go through server routes.

## 3. Stack

- Next.js (App Router) + TypeScript
- Tailwind for UI
- Zod for schema validation of all AI responses
- `@anthropic-ai/sdk` for Claude calls
- Konva (react-konva) for the canvas polygon editor
- Puppeteer for HTML to PDF/PNG export
- File storage: local `./storage` directory in dev, behind a `StorageProvider` interface so I can swap in S3 later. I host on AWS.
- No database for v1. Projects are folders on disk containing `project.json` plus source images.

## 4. The color legend

This is my personal annotation code and it must be configuration, not hardcoded logic. Put it in `config/legend.ts` as a typed array so I can edit it without touching the AI prompt code. The prompt builder reads this file and injects it into the system prompt at request time.

Starting legend:

| Marking | Feature type | Notes |
|---|---|---|
| Bright/light green fill | `putting_green` | Synthetic turf putting green |
| Plain green fill (unmarked area) | `lawn` | Default fill for remaining planted area |
| Dark green outlined blob | `tree` | Deciduous shade tree |
| Orange filled circle with brown lightning-bolt scribble inside | `tree_specimen` | Feature/ornamental tree, different species than `tree` |
| Blue curvy shape with circles at the top | `water_feature` | Waterfall with pond, circles indicate the boulder header/source |
| Grey fill | `paver_patio` | Hardscape paving |
| Black rectilinear line structure | `pergola` | Freestanding or attached shade structure |
| Red/orange scribble inside the pergola | `fire_pit` | |
| Small green tick/chevron marks | `ornamental_grass` | Usually clustered in beds |

Each legend entry carries: `id`, `label`, `featureType`, `colorHint` (hex + human description), `shapeHint`, `defaultMaterial`, `renderStyle` (fill color, stroke, pattern id for the plan drawing), and `unit` (`sqft`, `each`, `lf`).

Include a Legend Editor page in the app so I can add entries later. Adding an entry must automatically flow into the prompt and the plan renderer with no code change.

## 5. Milestone 1 — Upload and calibrate

1. Upload page: drag-and-drop the annotated image and optionally the clean orthophoto. Store both, record natural pixel dimensions.
2. Scale calibration tool: I click two points on the image and type the real-world distance between them (I usually use the driveway width or a ground control target). Store `pixelsPerFoot`. Every area and length calculation downstream uses this. If not set, show areas as "not calibrated" rather than guessing.
3. Optional north arrow: I drag a rotation handle to set north. Store `northRotationDeg`.
4. Project metadata form: client name, property address, project title, design style (dropdown: Modern, Traditional, Xeriscape, Mountain Modern, Mediterranean), climate zone (default USDA 6b/7a, Salt Lake Valley), and a free-text notes field.

## 6. Milestone 2 — Claude vision interpretation

Server route: `POST /api/interpret`. Sends the annotated image as base64 to Claude with the legend injected, gets back validated JSON.

### Request shape

```ts
const response = await anthropic.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 8000,
  system: buildInterpretSystemPrompt(legend, projectMeta),
  messages: [{
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64Annotated } },
      { type: "text", text: buildInterpretUserPrompt(projectMeta) }
    ]
  }]
});
```

If the image is over 5MB or over roughly 1568px on the long edge, downscale server-side with `sharp` before encoding. Record the downscale factor and multiply returned coordinates back up to full resolution.

### System prompt content (build this string from config, do not hardcode the legend)

```
You are a landscape design assistant. You are looking at a top-down drone orthophoto of a
residential property that has been hand-annotated by a designer on a touchscreen. Your job is
to interpret the annotations into structured design data.

The designer uses this color and shape code:
{{LEGEND_TABLE}}

Rules:
- Report coordinates as normalized floats 0.0 to 1.0, where (0,0) is the top-left of the image
  and (1,1) is the bottom-right.
- For area features return a polygon of 6 to 24 points tracing the annotation boundary.
- For point features (trees, fire pit) return a single center point and an estimated canopy or
  fixture radius in normalized units.
- Annotations are rough freehand. Smooth obvious hand-jitter into a clean shape but do not
  relocate anything or change its overall footprint.
- Any area inside the property boundary that is not covered by another annotation and is not
  the house footprint, driveway, or existing hardscape should be returned as one or more `lawn`
  features.
- Also identify unannotated existing site conditions you can see: house roof footprint, driveway,
  sidewalks, fence lines, existing sheds, utility boxes, and neighboring structures. Tag these
  with `"existing": true`.
- Set `confidence` per feature from 0 to 1. Be honest. Use below 0.6 for anything ambiguous.
- Never invent a feature that has no annotation and no visible site evidence.
- Return only valid JSON matching the schema. No markdown fences, no preamble, no commentary.
```

### Output schema (validate with Zod, reject and retry once on failure)

```ts
{
  imageSize: { width: number, height: number },
  features: [{
    id: string,                    // stable slug, e.g. "tree-01"
    featureType: string,           // must match a legend featureType or "existing_*"
    label: string,                 // human label for the legend, e.g. "Specimen Maple"
    geometry: {
      kind: "polygon" | "point" | "polyline",
      points: [{ x: number, y: number }],
      radius?: number
    },
    existing: boolean,
    confidence: number,
    notes: string
  }],
  siteObservations: string[],      // e.g. "steep grade toward the northwest corner"
  ambiguities: string[]            // annotations Claude could not confidently classify
}
```

Surface `ambiguities` and any feature under 0.6 confidence in the UI as a review queue I have to clear before continuing.

## 7. Milestone 3 — Polygon editor (this is the important one)

Claude's polygons will be approximately right and not exactly right. Do not pretend otherwise in the UI.

Build a Konva canvas that shows the clean orthophoto as the base layer with the interpreted features on top. I need to:

- Drag individual vertices, add a vertex by clicking a segment midpoint, delete a vertex
- Move, rotate, and scale a whole feature
- Draw a new feature from scratch and assign it a legend type
- Change a feature's type from a dropdown
- Delete a feature
- Toggle layer visibility per feature type
- See live area in square feet and perimeter in linear feet for the selected feature, computed from `pixelsPerFoot` using the shoelace formula
- Snap-to-edge toggle for aligning against the house or driveway

Autosave to `project.json` on every change, debounced. Undo/redo with a bounded history stack.

## 8. Milestone 4 — Plan drawing renderer

Pure SVG generated from the feature list. No AI involved. Component: `<PlanDrawing project={project} />`.

- Base layer: the clean orthophoto at reduced opacity/saturation, or a flat white background with just the house footprint drawn, selectable per project.
- Each feature type gets a defined `renderStyle` from the legend config: fill color, stroke, and an SVG `<pattern>` for texture. Build pattern defs for paver running bond, turf stipple, gravel, mulch, and water. Keep them subtle.
- Trees render as a canopy circle with a light radial texture and a trunk dot at center.
- Numbered callout markers: dark filled circle with white number, placed at each feature's centroid, nudged apart if they collide.
- Auto-generated legend list keyed to those numbers, ordered by feature type then by area descending.
- North arrow honoring `northRotationDeg`, plus a graphic scale bar computed from `pixelsPerFoot`, plus a text scale like `1/8" = 1'-0"` derived from the output page size.
- Everything must scale cleanly to a 24x36 sheet at 300 DPI.

## 9. Milestone 5 — Claude-generated design content

Second server route: `POST /api/design-content`. Sends the validated feature list (as JSON text, no image needed) and project metadata, gets back the written and tabular content for the board.

Ask for, in one call, returning a single JSON object:

- `conceptOverview`: 4 to 5 bullets in the voice of a designer presenting to a homeowner. Reference the actual features present, not generic filler.
- `plantPalette`: 8 to 10 plants appropriate to the stated climate zone and design style, each with `commonName`, `botanicalName`, `matureSize`, `waterNeeds`, `sunExposure`, `whyChosen`, and `placement` referencing a feature id. Bias hard toward water-wise and Utah-hardy species. Include the exact species for any `tree` and `tree_specimen` feature.
- `materialsAndFinishes`: for each hardscape feature, a suggested material with a short description, e.g. paver style, boulder type, pergola material and finish.
- `takeoff`: quantity per feature using the calculated areas I pass in. Claude does not calculate areas, I supply them and it just formats and groups them. Include a waste factor column at 10 percent for hardscape and 5 percent for turf.
- `renderPrompts`: three text-to-image prompts, one each for an entry/pathway view, a fire pit and pergola view, and a hero perspective of the whole yard at dusk. Each prompt must describe the actual materials, plants, and layout from this project, plus camera angle, time of day, and lighting.

Same rules: JSON only, Zod validated, one retry on parse failure.

Every field must be editable by me in the UI afterward. Claude drafts, I approve.

## 10. Milestone 6 — Board composition and export

An HTML template styled to match a professional design board, roughly this layout:

- Left rail: source drone photo thumbnail, clean orthophoto thumbnail
- Center: the large plan drawing with its numbered legend
- Right: perspective render slot, materials and finishes swatch strip, plant palette grid with photos
- Bottom band: concept overview bullets and three supporting render slots with captions
- Bottom right: my logo, project title, and tagline block

Requirements:

- Template must be data-driven from `project.json`, with panels that gracefully collapse if a section is empty (for example when renders are disabled).
- Page size selector: 24x36 landscape, 18x24, 11x17.
- Export via Puppeteer at 300 DPI to both PDF and PNG.
- Branding config file for my logo, business name, tagline, and accent color.

## 11. Milestone 7 — Perspective renders (feature-flagged, build last)

Interface: `ImageRenderProvider` with a single method `generate(prompt: string, referenceImage?: Buffer): Promise<Buffer>`.

Implement one provider to start and leave the others stubbed. Candidates worth evaluating, in rough order of usefulness for this job:

1. Google Gemini image generation, good at editing an existing photo while preserving the real structure, which matters because the render should look like *this* house
2. Flux via Replicate or fal.ai, strong general quality, image-to-image supported
3. OpenAI image generation

The prompts come from `renderPrompts` in Milestone 5. Pass the clean orthophoto or a ground-level site photo as the reference image where the provider supports it. Cache generated images in the project folder and never regenerate on page reload.

Also let me upload my own render or photo into any render slot manually. Sometimes I will just want a photo I already have.

## 12. Cost and error handling

- Log token usage per call and show a running per-project API cost estimate in the UI.
- Rate limit interpret calls to prevent me from accidentally spamming a 4MB image in a loop.
- On a 429 or 529, retry with exponential backoff up to 3 attempts, then surface a clear error.
- If JSON parsing fails twice, show me the raw response rather than silently failing.
- Everything expensive is idempotent and cached. Re-running the board export must not re-call any AI endpoint.

## 13. Build order, do not deviate

**Superseded for WebODM projects by Addendum A §A9.** The list below is the authoritative order when ingesting a georeferenced WebODM export. Legacy single-image upload (§5) remains supported for dev and samples, but new production work follows this path.

1. **WebODM folder ingest** — GeoTIFF parsing, CRS and transform extraction, tile pyramid generation (Addendum A1, A8)
2. **Annotation base export and re-upload matching** (A3)
3. **`POST /api/interpret`** with immediate conversion to projected coordinates (A4)
4. **Polygon editor** working in projected space with true areas (A4)
5. **Scale verification gate and accuracy banner** (A2)
6. **SVG plan renderer** with legend and callouts (SPEC §7)
7. **DTM sampling, slope analysis, cut and fill** (A5)
8. **`POST /api/design-content`** with elevation facts included when DTM is present (A5)
9. **Board template and PDF/PNG export** (SPEC §9)
10. **DXF and GeoJSON export** — projected DXF for Vectorworks, WGS84 GeoJSON, KML/KMZ, stakeout CSV, contours DXF (A7)
11. **Blender render pipeline** from textured OBJ (A6)
12. **Image-to-image finishing pass** behind a feature flag (A6)

Steps **1 through 6** are the product. Everything after is upside.

### Legacy build order (pre-WebODM, single JPEG upload)

1. Project scaffold, storage layer, project.json read/write, upload page
2. Scale calibration and metadata form
3. `/api/interpret` with Zod validation, results shown as a raw JSON dump
4. Konva polygon editor with area calculation
5. SVG plan renderer with legend and callouts
6. `/api/design-content` and the editable content panels
7. Board template and Puppeteer export
8. Image render provider behind a flag

Get a real end-to-end pass working with sample images at step 5 before adding anything cosmetic.

## 14. Test assets

I will drop two files in `./samples`: the annotated image and the clean orthophoto from the same flight. Write a script `npm run test:interpret` that runs the interpret step against the sample and prints the parsed feature list, so I can iterate on the prompt without clicking through the UI.
