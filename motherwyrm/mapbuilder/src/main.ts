import { blankMap, defaultArenaMap } from "./default-map";
import { DEFAULT_GRID, SKIN_PRESETS, W } from "./constants";
import {
  addBackupSpawn,
  addGem,
  addPlatform,
  addWall,
  captureMultiSnapshot,
  createEditorState,
  deleteSelection,
  findHoardSlot,
  findPlatform,
  findWall,
  gemBlockReason,
  hitTestCow,
  hitTestFinishTop,
  hitTestGem,
  hitTestHoardSlot,
  hitTestMultiSelection,
  hitTestPlatform,
  hitTestSpawn,
  hitTestWall,
  moveGem,
  moveHoardSlot,
  moveMultiSelection,
  movePlatform,
  moveSpawn,
  moveWall,
  resizePlatform,
  selectInRect,
  setCowGroundY,
  setFinishHeight,
  setPlatformPalette,
  setPlatformSkin,
  syncDocGrid,
  type EditorState,
} from "./editor/state";
import { defaultTransform, renderArena, screenToWorld, type DrawPreview, type ViewTransform } from "./editor/render";
import { createHistory } from "./editor/history";
import { exportMap, parseMap, serializeMap, snap, snapGem, validateMap } from "./schema";
import { deleteSprite, flushPendingSprites, publishMap, saveMapDraft, uploadSprite } from "./api";
import { loadRecentMaps, rememberMap } from "./storage";
import { invalidateSpriteCache, preloadMapSprites, resolveSpriteUrl, SPRITE_GROUPS, SPRITE_LABELS } from "./sprites";
import { singleSelectionId, type MapDocument, type MapSpriteSlot, type PlatformPalette, type Selection } from "./types";
import "./style.css";

type DragMode =
  | { kind: "pan"; sx: number; sy: number; ox: number; oy: number }
  | { kind: "move"; id: string; kindObj: "platform" | "gem" | "hoardSlot" | "wall"; ox: number; oy: number }
  | { kind: "cow"; startY: number }
  | { kind: "finishTop"; startHeight: number; startY: number }
  | { kind: "spawnMove"; team: "blue" | "red"; role: "main" | "backup"; index: number; ox: number; oy: number }
  | { kind: "draw"; tool: "platform" | "wall"; x0: number; y0: number }
  | { kind: "boxSelect"; x0: number; y0: number }
  | { kind: "multiMove"; startX: number; startY: number; snapshot: ReturnType<typeof captureMultiSnapshot> }
  | null;

function mountApp(root: HTMLElement): void {
  root.innerHTML = `
    <header class="toolbar">
      <h1>MotherWyrm Map Builder</h1>
      <div class="toolbar-actions">
        <button type="button" data-act="new">New</button>
        <button type="button" data-act="default">Load default arena</button>
        <button type="button" data-act="open">Open JSON…</button>
        <button type="button" data-act="export">Export JSON</button>
        <button type="button" data-act="save">Save</button>
        <button type="button" data-act="publish" class="primary">Publish</button>
        <button type="button" data-act="undo" id="undoBtn" disabled>Undo</button>
        <label class="mirror-toggle">
          <input type="checkbox" id="mirrorLock" checked> Mirror lock
        </label>
        <label class="mirror-toggle">
          <input type="checkbox" id="gemGravity" checked> Gem gravity
        </label>
        <label class="grid-field" title="Snap size in pixels — 8 means positions snap to every 8px">
          Snap <input type="number" id="gridSize" min="1" max="64" value="${DEFAULT_GRID}"> px
        </label>
      </div>
    </header>
    <div class="tools" role="toolbar" aria-label="Tools">
      <button type="button" data-tool="select" class="active">Select</button>
      <button type="button" data-tool="platform">Platform</button>
      <button type="button" data-tool="wall">Wall</button>
      <button type="button" data-tool="gem">Gem seam</button>
      <button type="button" data-tool="hoard">Hoard anchor</button>
      <button type="button" data-tool="spawn">Spawns</button>
      <button type="button" data-tool="wyrm">Wyrm path</button>
    </div>
    <div class="main">
      <aside class="panel" id="propsPanel">
        <h2>Properties</h2>
        <div id="propsBody"><p class="muted">Nothing selected.</p></div>
        <section class="recent">
          <h3>Recent maps</h3>
          <ul id="recentList"></ul>
        </section>
        <p class="note">Save stores a draft on the server. Publish adds the map to the TV lobby and random rotation.</p>
      </aside>
      <div class="canvas-wrap">
        <canvas id="arena" width="960" height="540"></canvas>
        <div id="statusBar" class="status"></div>
      </div>
    </div>
    <input type="file" id="fileInput" accept="application/json,.json" hidden>
  `;

  const canvas = root.querySelector("#arena") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  const statusBar = root.querySelector("#statusBar") as HTMLElement;
  const propsBody = root.querySelector("#propsBody") as HTMLElement;
  const fileInput = root.querySelector("#fileInput") as HTMLInputElement;
  const mirrorLockEl = root.querySelector("#mirrorLock") as HTMLInputElement;
  const gemGravityEl = root.querySelector("#gemGravity") as HTMLInputElement;
  const gridSizeEl = root.querySelector("#gridSize") as HTMLInputElement;
  const undoBtn = root.querySelector("#undoBtn") as HTMLButtonElement;

  let state = createEditorState(blankMap());
  const history = createHistory();
  let view = defaultTransform(canvas.width, canvas.height);
  let drag: DragMode = null;
  let hover: { x: number; y: number } | null = null;
  let drawPreview: DrawPreview = null;
  let spacePan = false;

  function updateUndoButton(): void {
    undoBtn.disabled = !history.canUndo();
  }

  function recordHistory(): void {
    history.record(state.doc);
    updateUndoButton();
  }

  function restoreDoc(doc: MapDocument): void {
    const id = singleSelectionId(state.selection);
    state.doc = doc;
    state.dirty = true;
    if (id && state.selection && state.selection.kind !== "multi" && state.selection.kind !== "wyrmCow" && state.selection.kind !== "wyrmFinish" && state.selection.kind !== "spawn") {
      const still =
        (state.selection.kind === "platform" && state.doc.platforms.some((p) => p.id === id))
        || (state.selection.kind === "gem" && state.doc.gemSeams.some((g) => g.id === id))
        || (state.selection.kind === "hoardSlot" && [...state.doc.hoardSlots.blue, ...state.doc.hoardSlots.red].some((s) => s.id === id))
        || (state.selection.kind === "wall" && state.doc.walls.some((w) => w.id === id));
      if (!still) state.selection = null;
    }
    renderProps();
    redraw();
    updateUndoButton();
  }

  function doUndo(): void {
    const prev = history.undo(state.doc);
    if (!prev) return;
    restoreDoc(prev);
    setStatus("Undid last edit");
  }

  function gemPlacementMessage(reason: "occupied" | "mirror_occupied"): string {
    return reason === "mirror_occupied"
      ? "Mirror slot occupied — a gem already exists at the mirrored position."
      : "Gem already exists here.";
  }

  function setStatus(msg: string, isError = false): void {
    statusBar.textContent = msg;
    statusBar.classList.toggle("error", isError);
  }

  function refreshValidation(): void {
    const issues = validateMap(state.doc, state.mirrorLock);
    const errors = issues.filter((i) => i.level === "error");
    const warns = issues.filter((i) => i.level === "warn");
    if (errors.length) {
      setStatus(`⚠ ${errors.length} error(s): ${errors[0]!.message}`, true);
    } else if (warns.length) {
      setStatus(`⚠ ${warns[0]!.message}`);
    } else {
      setStatus(`${state.doc.name} · ${state.doc.platforms.length} platforms · ${state.doc.gemSeams.length} gems`);
    }
  }

  function renderProps(): void {
    const sel = state.selection;
    if (!sel) {
      propsBody.innerHTML = `
        <label>Map id <input id="mapId" value="${esc(state.doc.id)}"></label>
        <label>Map name <input id="mapName" value="${esc(state.doc.name)}"></label>
        <section class="sprites-panel">
          <h3>Character art</h3>
          <p class="muted">Upload PNGs per mother frame (idle, dive, claw). Map preview uses idle at spawns. Wyrm feet align to the ground line.</p>
          ${spriteRowsHtml()}
        </section>
        <p class="muted">Select an object to edit it, or edit map metadata above.</p>`;
      bindMapMeta();
      bindSpriteArt();
      return;
    }

    if (sel.kind === "multi") {
      const n = sel.platforms.length + sel.gems.length + sel.hoardSlots.length + sel.walls.length;
      propsBody.innerHTML = `
        <p><strong>${n} items selected</strong></p>
        <p class="muted">${sel.platforms.length} platforms · ${sel.gems.length} gems · ${sel.hoardSlots.length} slots · ${sel.walls.length} walls</p>
        <button type="button" id="delBtn" class="danger">Delete selected</button>`;
      propsBody.querySelector("#delBtn")?.addEventListener("click", () => {
        recordHistory();
        deleteSelection(state);
        renderProps();
        redraw();
      });
      return;
    }

    if (sel.kind === "platform" && sel.ids.length === 1) {
      const p = findPlatform(state.doc, sel.ids[0]!);
      if (!p) return;
      const skins = Object.keys(SKIN_PRESETS);
      const pal = p.palette ?? SKIN_PRESETS[p.skin ?? "soil_default"]!;
      propsBody.innerHTML = `
        <p><strong>Platform</strong>${p.ground ? " (ground)" : ""}</p>
        <label>X <input type="number" id="pX" value="${p.x}" ${p.ground ? "disabled" : ""}></label>
        <label>Y <input type="number" id="pY" value="${p.y}" ${p.ground ? "disabled" : ""}></label>
        <label>W <input type="number" id="pW" value="${p.w}" ${p.ground ? "disabled" : ""}></label>
        <label>H <input type="number" id="pH" value="${p.h}" ${p.ground ? "disabled" : ""}></label>
        <label>Skin preset
          <select id="pSkin">${skins.map((s) => `<option value="${s}" ${p.skin === s ? "selected" : ""}>${s}</option>`).join("")}</select>
        </label>
        <fieldset class="palette">
          <legend>Palette slots</legend>
          ${paletteFields("pal", pal)}
        </fieldset>
        <button type="button" id="delBtn" class="danger">${p.ground ? "Remove ground floor" : "Delete platform"}</button>`;
      bindPlatformProps(p);
      return;
    }

    if (sel.kind === "gem" && sel.ids.length === 1) {
      const g = state.doc.gemSeams.find((x) => x.id === sel.ids[0]);
      if (!g) return;
      propsBody.innerHTML = `
        <p><strong>Gem seam</strong></p>
        <label>X <input type="number" id="gX" value="${g.x}"></label>
        <label>Y <input type="number" id="gY" value="${g.y}"></label>
        <p class="muted">${state.gemGravity ? "Gems drop to the nearest platform below." : `Snaps to ${state.doc.grid}px grid intersections.`}</p>
        <button type="button" id="delBtn" class="danger">Delete gem</button>`;
      bindGemProps(g.id);
      return;
    }

    if (sel.kind === "wall" && sel.ids.length === 1) {
      const w = findWall(state.doc, sel.ids[0]!);
      if (!w) return;
      propsBody.innerHTML = `
        <p><strong>Wall</strong></p>
        <label>X <input type="number" id="wX" value="${w.x}"></label>
        <label>Y <input type="number" id="wY" value="${w.y}"></label>
        <label>W <input type="number" id="wW" value="${w.w}"></label>
        <label>H <input type="number" id="wH" value="${w.h}"></label>
        <button type="button" id="delBtn" class="danger">Delete wall</button>`;
      const apply = () => {
        recordHistory();
        moveWall(state, w.id, Number((propsBody.querySelector("#wX") as HTMLInputElement).value), Number((propsBody.querySelector("#wY") as HTMLInputElement).value));
        w.w = Math.max(4, snap(Number((propsBody.querySelector("#wW") as HTMLInputElement).value), state.grid));
        w.h = Math.max(4, snap(Number((propsBody.querySelector("#wH") as HTMLInputElement).value), state.grid));
        redraw();
      };
      ["wX", "wY", "wW", "wH"].forEach((i) => propsBody.querySelector(`#${i}`)?.addEventListener("change", apply));
      propsBody.querySelector("#delBtn")?.addEventListener("click", () => {
        recordHistory();
        deleteSelection(state);
        renderProps();
        redraw();
      });
      return;
    }

    if (sel.kind === "hoardSlot" && sel.ids.length === 1) {
      const found = findHoardSlot(state.doc, sel.ids[0]!);
      if (!found) return;
      const { slot, team } = found;
      propsBody.innerHTML = `
        <p><strong>${team.toUpperCase()} hoard slot #${slot.index + 1}</strong></p>
        <label>X <input type="number" id="hX" value="${slot.x}"></label>
        <label>Y <input type="number" id="hY" value="${slot.y}"></label>`;
      bindHoardSlotProps(slot.id);
      return;
    }

    if (sel.kind === "spawn") {
      const pt = sel.role === "main"
        ? state.doc.spawns[sel.team].main
        : state.doc.spawns[sel.team].backup[sel.index]!;
      propsBody.innerHTML = `
        <p><strong>${sel.team.toUpperCase()} ${sel.role === "main" ? "main" : `backup #${sel.index + 1}`} spawn</strong></p>
        <label>X <input type="number" id="sX" value="${pt.x}"></label>
        <label>Y <input type="number" id="sY" value="${pt.y}"></label>`;
      const apply = () => {
        recordHistory();
        moveSpawn(state, sel.team, sel.role, sel.index, Number((propsBody.querySelector("#sX") as HTMLInputElement).value), Number((propsBody.querySelector("#sY") as HTMLInputElement).value));
        renderProps();
        redraw();
      };
      ["sX", "sY"].forEach((i) => propsBody.querySelector(`#${i}`)?.addEventListener("change", apply));
      return;
    }

    if (sel.kind === "wyrmCow" || sel.kind === "wyrmFinish") {
      const wp = state.doc.wyrmPath;
      propsBody.innerHTML = `
        <p><strong>Wyrm path & finish lines</strong></p>
        <label>Blue finish (left x) <input type="number" id="wLeft" value="${wp.left}"></label>
        <label>Red finish (right x) <input type="number" id="wRight" value="${wp.right}"></label>
        <label>Cow ground y <input type="number" id="wY" value="${wp.y}"></label>
        <label>Finish height <input type="number" id="wH" value="${wp.finishHeight}"></label>
        <p class="muted">Drag the cow to move ground y; drag finish line tops to resize height.</p>`;
      bindWyrmProps();
    }
  }

  function paletteFields(prefix: string, pal: PlatformPalette): string {
    return (["base", "shadow", "highlight", "trim"] as const)
      .map(
        (k) =>
          `<label>${k} <input type="color" id="${prefix}_${k}" value="${pal[k]}"></label>`
      )
      .join("");
  }

  function bindMapMeta(): void {
    const idEl = propsBody.querySelector("#mapId") as HTMLInputElement;
    const nameEl = propsBody.querySelector("#mapName") as HTMLInputElement;
    idEl?.addEventListener("change", () => {
      state.doc.id = idEl.value.trim() || "untitled";
      state.dirty = true;
      refreshValidation();
    });
    nameEl?.addEventListener("change", () => {
      state.doc.name = nameEl.value.trim() || "Untitled";
      state.dirty = true;
      refreshValidation();
    });
  }

  function bindPlatformProps(p: ReturnType<typeof findPlatform>): void {
    if (!p) return;
    const apply = () => {
      recordHistory();
      movePlatform(state, p.id, Number((propsBody.querySelector("#pX") as HTMLInputElement).value), Number((propsBody.querySelector("#pY") as HTMLInputElement).value));
      resizePlatform(state, p.id, Number((propsBody.querySelector("#pW") as HTMLInputElement).value), Number((propsBody.querySelector("#pH") as HTMLInputElement).value));
      redraw();
    };
    ["pX", "pY", "pW", "pH"].forEach((id) => propsBody.querySelector(`#${id}`)?.addEventListener("change", apply));

    propsBody.querySelector("#pSkin")?.addEventListener("change", (e) => {
      recordHistory();
      setPlatformSkin(state, p.id, (e.target as HTMLSelectElement).value);
      renderProps();
      redraw();
    });

    for (const k of ["base", "shadow", "highlight", "trim"] as const) {
      propsBody.querySelector(`#pal_${k}`)?.addEventListener("input", (e) => {
        recordHistory();
        const cur = p.palette ?? { ...SKIN_PRESETS[p.skin ?? "soil_default"]! };
        setPlatformPalette(state, p.id, { ...cur, [k]: (e.target as HTMLInputElement).value });
        redraw();
      });
    }

    propsBody.querySelector("#delBtn")?.addEventListener("click", () => {
      recordHistory();
      deleteSelection(state);
      renderProps();
      redraw();
    });
  }

  function bindGemProps(id: string): void {
    const apply = () => {
      recordHistory();
      const ok = moveGem(
        state,
        id,
        Number((propsBody.querySelector("#gX") as HTMLInputElement).value),
        Number((propsBody.querySelector("#gY") as HTMLInputElement).value)
      );
      if (!ok) {
        doUndo();
        setStatus("Cannot move gem — position or mirror slot is occupied.", true);
        renderProps();
      }
      redraw();
    };
    ["gX", "gY"].forEach((i) => propsBody.querySelector(`#${i}`)?.addEventListener("change", apply));
    propsBody.querySelector("#delBtn")?.addEventListener("click", () => {
      recordHistory();
      deleteSelection(state);
      renderProps();
      redraw();
    });
  }

  function bindHoardSlotProps(id: string): void {
    const apply = () => {
      recordHistory();
      moveHoardSlot(state, id, Number((propsBody.querySelector("#hX") as HTMLInputElement).value), Number((propsBody.querySelector("#hY") as HTMLInputElement).value));
      redraw();
    };
    ["hX", "hY"].forEach((i) => propsBody.querySelector(`#${i}`)?.addEventListener("change", apply));
  }

  function bindWyrmProps(): void {
    const apply = () => {
      recordHistory();
      state.doc.wyrmPath.left = Number((propsBody.querySelector("#wLeft") as HTMLInputElement).value);
      state.doc.wyrmPath.right = Number((propsBody.querySelector("#wRight") as HTMLInputElement).value);
      setCowGroundY(state, Number((propsBody.querySelector("#wY") as HTMLInputElement).value));
      setFinishHeight(state, Number((propsBody.querySelector("#wH") as HTMLInputElement).value));
      redraw();
    };
    ["wLeft", "wRight", "wY", "wH"].forEach((i) => propsBody.querySelector(`#${i}`)?.addEventListener("change", apply));
  }

  function esc(s: string): string {
    return s.replace(/"/g, "&quot;");
  }

  function redraw(): void {
    renderArena(
      ctx,
      state,
      view,
      canvas.width,
      canvas.height,
      state.selection,
      hover,
      drawPreview,
      () => redraw()
    );
    refreshValidation();
  }

  function spriteRowsHtml(): string {
    return SPRITE_GROUPS.map((group) => {
      const rows = group.slots
        .map((slot) => {
          const url = resolveSpriteUrl(state.doc, slot, state.spritePreviews);
          const custom = Boolean(state.doc.sprites?.[slot] || state.pendingSprites[slot]);
          return `
        <div class="sprite-row">
          <img class="sprite-thumb" src="${esc(url)}" alt="" width="40" height="40">
          <div class="sprite-meta">
            <span class="sprite-label">${SPRITE_LABELS[slot]}</span>
            <label class="sprite-upload">
              <input type="file" accept="image/png" data-sprite="${slot}" hidden>
              Choose PNG…
            </label>
          </div>
          ${custom ? `<button type="button" class="sprite-clear" data-clear-sprite="${slot}">Reset</button>` : ""}
        </div>`;
        })
        .join("");
      return `<h4 class="sprite-group-title">${group.title}</h4>${rows}`;
    }).join("");
  }

  function bindSpriteArt(): void {
    propsBody.querySelectorAll<HTMLInputElement>("input[data-sprite]").forEach((input) => {
      input.addEventListener("change", () => {
        const slot = input.dataset.sprite as MapSpriteSlot;
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;
        void applySpriteUpload(slot, file);
      });
    });
    propsBody.querySelectorAll("[data-clear-sprite]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const slot = (btn as HTMLElement).dataset.clearSprite as MapSpriteSlot;
        void clearSprite(slot);
      });
    });
  }

  async function applySpriteUpload(slot: MapSpriteSlot, file: File): Promise<void> {
    if (!file.type.includes("png")) {
      setStatus("Sprite must be a PNG file.", true);
      return;
    }
    const prev = state.spritePreviews[slot];
    if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
    state.spritePreviews[slot] = URL.createObjectURL(file);
    state.pendingSprites[slot] = file;
    state.dirty = true;

    if (state.doc.id.trim()) {
      const result = await uploadSprite(state.doc.id, slot, file);
      if (!result.ok) {
        setStatus(`Upload failed: ${result.error}`, true);
        renderProps();
        redraw();
        return;
      }
      invalidateSpriteCache(state.doc.sprites?.[slot]);
      state.doc.sprites = { ...(state.doc.sprites ?? {}), [slot]: result.url };
      delete state.pendingSprites[slot];
      if (state.spritePreviews[slot]?.startsWith("blob:")) {
        URL.revokeObjectURL(state.spritePreviews[slot]!);
      }
      delete state.spritePreviews[slot];
      setStatus(`Updated ${SPRITE_LABELS[slot]}`);
    } else {
      setStatus(`Previewing ${SPRITE_LABELS[slot]} — set map id and Save to keep it.`);
    }
    renderProps();
    redraw();
  }

  async function clearSprite(slot: MapSpriteSlot): Promise<void> {
    recordHistory();
    if (state.doc.id.trim() && state.doc.sprites?.[slot]) {
      await deleteSprite(state.doc.id, slot);
    }
    invalidateSpriteCache(state.doc.sprites?.[slot]);
    if (state.spritePreviews[slot]?.startsWith("blob:")) {
      URL.revokeObjectURL(state.spritePreviews[slot]!);
    }
    delete state.spritePreviews[slot];
    delete state.pendingSprites[slot];
    if (state.doc.sprites) {
      const next = { ...state.doc.sprites };
      delete next[slot];
      state.doc.sprites = Object.keys(next).length ? next : undefined;
    }
    state.dirty = true;
    renderProps();
    redraw();
  }

  async function prepareDocForSave(): Promise<MapDocument | null> {
    syncDocGrid(state);
    if (Object.keys(state.pendingSprites).length) {
      const flushed = await flushPendingSprites(state.doc, state.pendingSprites);
      if (!flushed.ok) {
        setStatus(`Sprite upload failed: ${flushed.error}`, true);
        return null;
      }
      state.doc = flushed.doc;
      state.pendingSprites = {};
      for (const url of Object.values(state.spritePreviews)) {
        if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
      }
      state.spritePreviews = {};
    }
    return exportMap(state.doc);
  }

  function loadDoc(doc: MapDocument): void {
    state = createEditorState(doc);
    state.mirrorLock = mirrorLockEl.checked;
    state.gemGravity = gemGravityEl.checked;
    state.grid = Number(gridSizeEl.value) || DEFAULT_GRID;
    syncDocGrid(state);
    history.clear();
    updateUndoButton();
    renderProps();
    refreshRecent();
    preloadMapSprites(state.doc, () => redraw(), state.spritePreviews);
    redraw();
  }

  function doExport(): void {
    syncDocGrid(state);
    const issues = validateMap(state.doc, state.mirrorLock);
    const errors = issues.filter((i) => i.level === "error");
    if (errors.length) {
      const proceed = confirm(
        `Export has ${errors.length} symmetry/validation error(s):\n\n${errors.map((e) => e.message).join("\n")}\n\nExport anyway?`
      );
      if (!proceed) return;
    }
    const out = exportMap(state.doc);
    const json = serializeMap(out);
    rememberMap(out.id, out.name, json);
    refreshRecent();
    download(json, `${out.id || "map"}.json`);
    state.dirty = false;
    setStatus(`Exported ${out.name}`);
  }

  async function doSave(): Promise<void> {
    if (!state.doc.id.trim()) {
      setStatus("Set a map id in Properties before saving.", true);
      return;
    }
    const out = await prepareDocForSave();
    if (!out) return;
    const json = serializeMap(out);
    const result = await saveMapDraft(out);
    if (!result.ok) {
      setStatus(`Save failed: ${result.error}`, true);
      return;
    }
    rememberMap(out.id, out.name, json);
    refreshRecent();
    state.dirty = false;
    setStatus(`Saved draft “${out.name}”`);
  }

  async function doPublish(): Promise<void> {
    const issues = validateMap(state.doc, state.mirrorLock);
    const errors = issues.filter((i) => i.level === "error");
    if (errors.length) {
      setStatus(`Fix ${errors.length} error(s) before publishing: ${errors[0]!.message}`, true);
      return;
    }
    if (!state.doc.id.trim()) {
      setStatus("Set a map id in Properties before publishing.", true);
      return;
    }
    const out = await prepareDocForSave();
    if (!out) return;
    const json = serializeMap(out);
    const result = await publishMap(out);
    if (!result.ok) {
      setStatus(`Publish failed: ${result.error}`, true);
      return;
    }
    rememberMap(out.id, out.name, json);
    refreshRecent();
    state.dirty = false;
    setStatus(`Published “${result.name}” — now in TV map list and random pool`);
  }

  function refreshRecent(): void {
    const ul = root.querySelector("#recentList") as HTMLUListElement;
    const recent = loadRecentMaps();
    ul.innerHTML = recent.length
      ? recent
          .map(
            (e) =>
              `<li><button type="button" data-recent="${esc(e.id)}">${esc(e.name)}</button></li>`
          )
          .join("")
      : `<li class="muted">No recent maps</li>`;
    ul.querySelectorAll("[data-recent]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = (btn as HTMLElement).dataset.recent!;
        const entry = loadRecentMaps().find((e) => e.id === id);
        if (entry) loadDoc(parseMap(entry.json));
      });
    });
  }

  // Toolbar
  root.querySelector('[data-act="new"]')?.addEventListener("click", () => {
    if (state.dirty && !confirm("Discard unsaved changes?")) return;
    loadDoc(blankMap());
  });
  root.querySelector('[data-act="default"]')?.addEventListener("click", () => {
    if (state.dirty && !confirm("Replace current map with default arena?")) return;
    loadDoc(defaultArenaMap());
  });
  root.querySelector('[data-act="open"]')?.addEventListener("click", () => fileInput.click());
  root.querySelector('[data-act="export"]')?.addEventListener("click", doExport);
  root.querySelector('[data-act="save"]')?.addEventListener("click", () => void doSave());
  root.querySelector('[data-act="publish"]')?.addEventListener("click", () => void doPublish());
  root.querySelector('[data-act="undo"]')?.addEventListener("click", doUndo);

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      loadDoc(parseMap(text));
      setStatus(`Opened ${file.name}`);
    } catch (err) {
      setStatus(`Failed to open: ${(err as Error).message}`, true);
    }
    fileInput.value = "";
  });

  mirrorLockEl.addEventListener("change", () => {
    state.mirrorLock = mirrorLockEl.checked;
    refreshValidation();
  });

  gemGravityEl.addEventListener("change", () => {
    state.gemGravity = gemGravityEl.checked;
    renderProps();
    redraw();
  });

  gridSizeEl.addEventListener("change", () => {
    state.grid = Math.max(1, Number(gridSizeEl.value) || DEFAULT_GRID);
    syncDocGrid(state);
    redraw();
  });

  root.querySelectorAll("[data-tool]").forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelectorAll("[data-tool]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.tool = (btn as HTMLElement).dataset.tool as EditorState["tool"];
    });
  });

  // Canvas interaction
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const before = screenToWorld(view, sx, sy);
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    view.scale = Math.min(3, Math.max(0.25, view.scale * factor));
    view.offsetX = sx - before.x * view.scale;
    view.offsetY = sy - before.y * view.scale;
    redraw();
  }, { passive: false });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") spacePan = true;
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      e.preventDefault();
      doUndo();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      recordHistory();
      deleteSelection(state);
      renderProps();
      redraw();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") spacePan = false;
  });

  function beginEdit(): void {
    recordHistory();
  }

  canvas.addEventListener("mousedown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(view, sx, sy);

    if (e.button === 1 || spacePan || (e.button === 0 && e.altKey)) {
      drag = { kind: "pan", sx, sy, ox: view.offsetX, oy: view.offsetY };
      return;
    }

    if (e.button !== 0) return;

    if (state.tool === "select") {
      if (state.selection?.kind === "multi" && hitTestMultiSelection(state.doc, state.selection, world.x, world.y)) {
        beginEdit();
        drag = {
          kind: "multiMove",
          startX: world.x,
          startY: world.y,
          snapshot: captureMultiSnapshot(state.doc, state.selection),
        };
        renderProps();
        redraw();
        return;
      }
      const wall = hitTestWall(state.doc, world.x, world.y);
      if (wall) {
        beginEdit();
        state.selection = { kind: "wall", ids: [wall.id] };
        drag = { kind: "move", id: wall.id, kindObj: "wall", ox: world.x - wall.x, oy: world.y - wall.y };
        renderProps();
        redraw();
        return;
      }
      const plat = hitTestPlatform(state.doc, world.x, world.y);
      if (plat) {
        beginEdit();
        state.selection = { kind: "platform", ids: [plat.id] };
        drag = { kind: "move", id: plat.id, kindObj: "platform", ox: world.x - plat.x, oy: world.y - plat.y };
        renderProps();
        redraw();
        return;
      }
      const slot = hitTestHoardSlot(state.doc, world.x, world.y);
      if (slot) {
        beginEdit();
        state.selection = { kind: "hoardSlot", ids: [slot.id] };
        drag = { kind: "move", id: slot.id, kindObj: "hoardSlot", ox: world.x - slot.x, oy: world.y - slot.y };
        renderProps();
        redraw();
        return;
      }
      const gem = hitTestGem(state.doc, world.x, world.y);
      if (gem) {
        beginEdit();
        state.selection = { kind: "gem", ids: [gem.id] };
        drag = { kind: "move", id: gem.id, kindObj: "gem", ox: world.x - gem.x, oy: world.y - gem.y };
        renderProps();
        redraw();
        return;
      }
      const spawn = hitTestSpawn(state.doc, world.x, world.y);
      if (spawn) {
        beginEdit();
        state.selection = { kind: "spawn", ...spawn };
        const pt = spawn.role === "main"
          ? state.doc.spawns[spawn.team].main
          : state.doc.spawns[spawn.team].backup[spawn.index]!;
        drag = { kind: "spawnMove", ...spawn, ox: world.x - pt.x, oy: world.y - pt.y };
        renderProps();
        redraw();
        return;
      }
      if (hitTestFinishTop(state.doc, world.x, world.y)) {
        beginEdit();
        state.selection = { kind: "wyrmFinish" };
        drag = {
          kind: "finishTop",
          startHeight: state.doc.wyrmPath.finishHeight,
          startY: world.y,
        };
        renderProps();
        redraw();
        return;
      }
      if (hitTestCow(state.doc, world.x, world.y)) {
        beginEdit();
        state.selection = { kind: "wyrmCow" };
        drag = { kind: "cow", startY: world.y };
        renderProps();
        redraw();
        return;
      }
      drag = { kind: "boxSelect", x0: world.x, y0: world.y };
      return;
    }

    if (state.tool === "platform") {
      beginEdit();
      drag = { kind: "draw", tool: "platform", x0: snap(world.x, state.grid), y0: snap(world.y, state.grid) };
      return;
    }

    if (state.tool === "wall") {
      beginEdit();
      drag = { kind: "draw", tool: "wall", x0: snap(world.x, state.grid), y0: snap(world.y, state.grid) };
      return;
    }

    if (state.tool === "gem") {
      const existing = hitTestGem(state.doc, world.x, world.y);
      if (existing) {
        state.selection = { kind: "gem", ids: [existing.id] };
        renderProps();
        redraw();
        return;
      }
      const blocked = gemBlockReason(state, world.x, world.y);
      if (blocked) {
        setStatus(gemPlacementMessage(blocked), true);
        return;
      }
      beginEdit();
      addGem(state, world.x, world.y);
      renderProps();
      redraw();
      return;
    }

    if (state.tool === "spawn") {
      const hit = hitTestSpawn(state.doc, world.x, world.y);
      if (hit) {
        beginEdit();
        state.selection = { kind: "spawn", ...hit };
        const pt = hit.role === "main" ? state.doc.spawns[hit.team].main : state.doc.spawns[hit.team].backup[hit.index]!;
        drag = { kind: "spawnMove", ...hit, ox: world.x - pt.x, oy: world.y - pt.y };
        renderProps();
        redraw();
        return;
      }
      const team = world.x < W / 2 ? "blue" : "red";
      beginEdit();
      addBackupSpawn(state, team, world.x, world.y);
      const idx = state.doc.spawns[team].backup.length - 1;
      state.selection = { kind: "spawn", team, role: "backup", index: idx };
      renderProps();
      redraw();
      return;
    }

    if (state.tool === "hoard") {
      const slot = hitTestHoardSlot(state.doc, world.x, world.y);
      if (slot) {
        beginEdit();
        state.selection = { kind: "hoardSlot", ids: [slot.id] };
        drag = { kind: "move", id: slot.id, kindObj: "hoardSlot", ox: world.x - slot.x, oy: world.y - slot.y };
      }
      renderProps();
      redraw();
      return;
    }

    if (state.tool === "wyrm") {
      if (hitTestCow(state.doc, world.x, world.y)) {
        beginEdit();
        state.selection = { kind: "wyrmCow" };
        drag = { kind: "cow", startY: world.y };
      } else if (hitTestFinishTop(state.doc, world.x, world.y)) {
        beginEdit();
        state.selection = { kind: "wyrmFinish" };
        drag = { kind: "finishTop", startHeight: state.doc.wyrmPath.finishHeight, startY: world.y };
      }
      renderProps();
      redraw();
    }
  });

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = screenToWorld(view, sx, sy);
    hover =
      state.tool === "gem"
        ? { x: snapGem(world.x, state.grid), y: snapGem(world.y, state.grid) }
        : { x: snap(world.x, state.grid), y: snap(world.y, state.grid) };

    if (drag?.kind === "pan") {
      view.offsetX = drag.ox + (sx - drag.sx);
      view.offsetY = drag.oy + (sy - drag.sy);
      redraw();
      return;
    }

    if (drag?.kind === "multiMove") {
      const dx = snap(world.x, state.grid) - snap(drag.startX, state.grid);
      const dy = snap(world.y, state.grid) - snap(drag.startY, state.grid);
      moveMultiSelection(state, drag.snapshot, dx, dy);
      renderProps();
      redraw();
      return;
    }

    if (drag?.kind === "move") {
      if (drag.kindObj === "platform") {
        movePlatform(state, drag.id, world.x - drag.ox, world.y - drag.oy);
      } else if (drag.kindObj === "hoardSlot") {
        moveHoardSlot(state, drag.id, world.x - drag.ox, world.y - drag.oy);
      } else if (drag.kindObj === "wall") {
        moveWall(state, drag.id, world.x - drag.ox, world.y - drag.oy);
      } else {
        moveGem(state, drag.id, world.x - drag.ox, world.y - drag.oy);
      }
      renderProps();
      redraw();
      return;
    }

    if (drag?.kind === "spawnMove") {
      moveSpawn(state, drag.team, drag.role, drag.index, world.x - drag.ox, world.y - drag.oy);
      renderProps();
      redraw();
      return;
    }

    if (drag?.kind === "cow") {
      setCowGroundY(state, world.y);
      renderProps();
      redraw();
      return;
    }

    if (drag?.kind === "finishTop") {
      const delta = drag.startY - world.y;
      setFinishHeight(state, drag.startHeight + delta);
      renderProps();
      redraw();
      return;
    }

    if (drag?.kind === "draw") {
      const x = Math.min(drag.x0, snap(world.x, state.grid));
      const y = Math.min(drag.y0, snap(world.y, state.grid));
      const w = Math.abs(snap(world.x, state.grid) - drag.x0) || (drag.tool === "wall" ? 16 : 96);
      const h = Math.abs(snap(world.y, state.grid) - drag.y0) || (drag.tool === "wall" ? 120 : 16);
      drawPreview = { kind: drag.tool, x, y, w, h };
      redraw();
      return;
    }

    if (drag?.kind === "boxSelect") {
      drawPreview = { kind: "boxSelect", x0: drag.x0, y0: drag.y0, x1: world.x, y1: world.y };
      redraw();
      return;
    }

    drawPreview = null;
    redraw();
  });

  canvas.addEventListener("mouseup", (e) => {
    if (drag?.kind === "draw") {
      const rect = canvas.getBoundingClientRect();
      const world = screenToWorld(view, e.clientX - rect.left, e.clientY - rect.top);
      const x = Math.min(drag.x0, snap(world.x, state.grid));
      const y = Math.min(drag.y0, snap(world.y, state.grid));
      let w = Math.abs(snap(world.x, state.grid) - drag.x0);
      let h = Math.abs(snap(world.y, state.grid) - drag.y0);
      if (drag.tool === "wall") {
        if (w < 4) w = 16;
        if (h < 4) h = 120;
        addWall(state, x, y, w, h);
      } else {
        if (w < 8) w = 96;
        if (h < 4) h = 16;
        addPlatform(state, x, y, w, h);
      }
      renderProps();
    } else if (drag?.kind === "boxSelect") {
      const rect = canvas.getBoundingClientRect();
      const world = screenToWorld(view, e.clientX - rect.left, e.clientY - rect.top);
      const sel = selectInRect(state.doc, drag.x0, drag.y0, world.x, world.y);
      const total = sel.platforms.length + sel.gems.length + sel.hoardSlots.length + sel.walls.length;
      state.selection = total > 0 ? sel : null;
      renderProps();
    }
    drawPreview = null;
    drag = null;
    redraw();
  });

  canvas.addEventListener("mouseleave", () => {
    hover = null;
    drawPreview = null;
    drag = null;
    redraw();
  });

  window.addEventListener("resize", () => {
    const wrap = canvas.parentElement!;
    canvas.width = wrap.clientWidth;
    canvas.height = Math.max(400, window.innerHeight - 160);
    redraw();
  });

  window.dispatchEvent(new Event("resize"));
  refreshRecent();
  renderProps();
  refreshValidation();
}

function download(text: string, filename: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

mountApp(document.getElementById("app")!);
