import { blankMap, defaultArenaMap } from "./default-map";
import { DEFAULT_GRID, SKIN_PRESETS, W } from "./constants";
import {
  addGem,
  addPlatform,
  createEditorState,
  deleteSelection,
  findHoardSlot,
  findPlatform,
  gemBlockReason,
  gemHoverBlocked,
  hitTestCow,
  hitTestFinishTop,
  hitTestGem,
  hitTestHoardSlot,
  hitTestPlatform,
  moveGem,
  moveHoardSlot,
  movePlatform,
  resizePlatform,
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
import { loadRecentMaps, rememberMap } from "./storage";
import type { MapDocument, PlatformPalette, Selection } from "./types";
import "./style.css";

type DragMode =
  | { kind: "pan"; sx: number; sy: number; ox: number; oy: number }
  | { kind: "move"; id: string; kindObj: "platform" | "gem" | "hoardSlot"; ox: number; oy: number }
  | { kind: "cow"; startY: number }
  | { kind: "finishTop"; startHeight: number; startY: number }
  | { kind: "draw"; x0: number; y0: number }
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
        <button type="button" data-act="undo" id="undoBtn" disabled>Undo</button>
        <label class="mirror-toggle">
          <input type="checkbox" id="mirrorLock" checked> Mirror lock
        </label>
        <label class="grid-field">Grid <input type="number" id="gridSize" min="1" max="64" value="${DEFAULT_GRID}"></label>
      </div>
    </header>
    <div class="tools" role="toolbar" aria-label="Tools">
      <button type="button" data-tool="select" class="active">Select</button>
      <button type="button" data-tool="platform">Platform</button>
      <button type="button" data-tool="gem">Gem seam</button>
      <button type="button" data-tool="hoard">Hoard anchor</button>
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
        <p class="note">Platform art uses indexed palette slots (base / shadow / highlight / trim). The game renderer does not load map JSON yet — export is for future use.</p>
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
    const sel = state.selection;
    state.doc = doc;
    state.dirty = true;
    if (sel?.kind === "platform" && !state.doc.platforms.some((p) => p.id === sel.id)) {
      state.selection = null;
    } else if (sel?.kind === "gem" && !state.doc.gemSeams.some((g) => g.id === sel.id)) {
      state.selection = null;
    } else if (sel?.kind === "hoardSlot") {
      const still = state.doc.hoardSlots.blue.some((s) => s.id === sel.id)
        || state.doc.hoardSlots.red.some((s) => s.id === sel.id);
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
        <p class="muted">Select an object to edit it, or edit map metadata above.</p>`;
      bindMapMeta();
      return;
    }

    if (sel.kind === "platform") {
      const p = findPlatform(state.doc, sel.id);
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
        ${p.ground ? "" : `<button type="button" id="delBtn" class="danger">Delete platform</button>`}`;
      bindPlatformProps(p);
      return;
    }

    if (sel.kind === "gem") {
      const g = state.doc.gemSeams.find((x) => x.id === sel.id);
      if (!g) return;
      propsBody.innerHTML = `
        <p><strong>Gem seam</strong></p>
        <label>X <input type="number" id="gX" value="${g.x}"></label>
        <label>Y <input type="number" id="gY" value="${g.y}"></label>
        <p class="muted">Pixel coords — not snapped to the platform grid.</p>
        <button type="button" id="delBtn" class="danger">Delete gem</button>`;
      bindGemProps(g.id);
      return;
    }

    if (sel.kind === "hoardSlot") {
      const found = findHoardSlot(state.doc, sel.id);
      if (!found) return;
      const { slot, team } = found;
      propsBody.innerHTML = `
        <p><strong>${team.toUpperCase()} hoard slot #${slot.index + 1}</strong></p>
        <label>X <input type="number" id="hX" value="${slot.x}"></label>
        <label>Y <input type="number" id="hY" value="${slot.y}"></label>`;
      bindHoardSlotProps(slot.id);
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
    renderArena(ctx, state, view, canvas.width, canvas.height, state.selection, hover, drawPreview);
    refreshValidation();
  }

  function loadDoc(doc: MapDocument): void {
    state = createEditorState(doc);
    state.mirrorLock = mirrorLockEl.checked;
    state.grid = Number(gridSizeEl.value) || DEFAULT_GRID;
    syncDocGrid(state);
    history.clear();
    updateUndoButton();
    renderProps();
    refreshRecent();
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
      const plat = hitTestPlatform(state.doc, world.x, world.y);
      if (plat) {
        beginEdit();
        state.selection = { kind: "platform", id: plat.id };
        drag = { kind: "move", id: plat.id, kindObj: "platform", ox: world.x - plat.x, oy: world.y - plat.y };
        renderProps();
        redraw();
        return;
      }
      const slot = hitTestHoardSlot(state.doc, world.x, world.y);
      if (slot) {
        beginEdit();
        state.selection = { kind: "hoardSlot", id: slot.id };
        drag = { kind: "move", id: slot.id, kindObj: "hoardSlot", ox: world.x - slot.x, oy: world.y - slot.y };
        renderProps();
        redraw();
        return;
      }
      const gem = hitTestGem(state.doc, world.x, world.y);
      if (gem) {
        beginEdit();
        state.selection = { kind: "gem", id: gem.id };
        drag = { kind: "move", id: gem.id, kindObj: "gem", ox: world.x - gem.x, oy: world.y - gem.y };
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
      state.selection = null;
      renderProps();
      redraw();
      return;
    }

    if (state.tool === "platform") {
      beginEdit();
      drag = { kind: "draw", x0: snap(world.x, state.grid), y0: snap(world.y, state.grid) };
      return;
    }

    if (state.tool === "gem") {
      const existing = hitTestGem(state.doc, world.x, world.y);
      if (existing) {
        state.selection = { kind: "gem", id: existing.id };
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

    if (state.tool === "hoard") {
      const slot = hitTestHoardSlot(state.doc, world.x, world.y);
      if (slot) {
        beginEdit();
        state.selection = { kind: "hoardSlot", id: slot.id };
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
        ? { x: snapGem(world.x), y: snapGem(world.y) }
        : { x: snap(world.x, state.grid), y: snap(world.y, state.grid) };

    if (drag?.kind === "pan") {
      view.offsetX = drag.ox + (sx - drag.sx);
      view.offsetY = drag.oy + (sy - drag.sy);
      redraw();
      return;
    }

    if (drag?.kind === "move") {
      if (drag.kindObj === "platform") {
        movePlatform(state, drag.id, world.x - drag.ox, world.y - drag.oy);
      } else if (drag.kindObj === "hoardSlot") {
        moveHoardSlot(state, drag.id, world.x - drag.ox, world.y - drag.oy);
      } else {
        moveGem(state, drag.id, world.x - drag.ox, world.y - drag.oy);
      }
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
      const w = Math.abs(snap(world.x, state.grid) - drag.x0) || 96;
      const h = Math.abs(snap(world.y, state.grid) - drag.y0) || 16;
      drawPreview = { kind: "platform", x, y, w, h };
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
      if (w < 8) w = 96;
      if (h < 4) h = 16;
      addPlatform(state, x, y, w, h);
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
