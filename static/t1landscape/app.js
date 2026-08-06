import {
  parseGeoJSON,
  featureLabel,
  processFeature,
  fmtNum,
} from "./geo.js";
import { generateDxf, originCommentText } from "./dxf.js";
import {
  calibrationText,
  generateKml,
  generateCsv,
  downloadText,
} from "./export.js";

const state = {
  geojson: null,
  features: [],
  selectedIndex: 0,
  units: "feet",
  dropShortFt: 0,
  simplifyFt: 0,
  processed: null,
  fileName: "",
};

const els = {
  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("fileInput"),
  fileLabel: document.getElementById("fileLabel"),
  featurePanel: document.getElementById("featurePanel"),
  featureList: document.getElementById("featureList"),
  attrPanel: document.getElementById("attrPanel"),
  attrTable: document.getElementById("attrTable"),
  workPanels: document.getElementById("workPanels"),
  unitsFeet: document.getElementById("unitsFeet"),
  unitsMeters: document.getElementById("unitsMeters"),
  dropShortSlider: document.getElementById("dropShortSlider"),
  dropShortVal: document.getElementById("dropShortVal"),
  simplifySlider: document.getElementById("simplifySlider"),
  simplifyVal: document.getElementById("simplifyVal"),
  previewCanvas: document.getElementById("previewCanvas"),
  originBox: document.getElementById("originBox"),
  statsGrid: document.getElementById("statsGrid"),
  acreCompare: document.getElementById("acreCompare"),
  segmentTable: document.getElementById("segmentTable"),
  calibrationBox: document.getElementById("calibrationBox"),
  errorBox: document.getElementById("errorBox"),
  btnDxf: document.getElementById("btnDxf"),
  btnCalibration: document.getElementById("btnCalibration"),
  btnKml: document.getElementById("btnKml"),
  btnCsv: document.getElementById("btnCsv"),
};

function showError(message) {
  els.errorBox.textContent = message;
  els.errorBox.classList.remove("hidden");
}

function clearError() {
  els.errorBox.textContent = "";
  els.errorBox.classList.add("hidden");
}

function currentFeature() {
  return state.features[state.selectedIndex];
}

function recompute() {
  clearError();
  const feature = currentFeature();
  if (!feature) return;

  try {
    state.processed = processFeature(feature, {
      units: state.units,
      dropShortFt: state.dropShortFt,
      simplifyFt: state.simplifyFt,
    });
    renderAll();
  } catch (err) {
    showError(err.message || String(err));
  }
}

function renderAttributes(feature) {
  const tbody = els.attrTable.querySelector("tbody");
  tbody.innerHTML = "";
  const props = feature.properties || {};
  const keys = Object.keys(props).sort();
  if (keys.length === 0) {
    tbody.innerHTML = "<tr><td colspan='2' class='hint'>No properties on this feature.</td></tr>";
    return;
  }
  for (const key of keys) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<th>${escapeHtml(key)}</th><td>${escapeHtml(String(props[key]))}</td>`;
    tbody.appendChild(tr);
  }
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderFeaturePicker() {
  if (state.features.length <= 1) {
    els.featurePanel.classList.add("hidden");
    return;
  }
  els.featurePanel.classList.remove("hidden");
  els.featureList.innerHTML = "";
  state.features.forEach((feature, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = featureLabel(feature, idx);
    if (idx === state.selectedIndex) btn.classList.add("primary");
    btn.addEventListener("click", () => {
      state.selectedIndex = idx;
      renderFeaturePicker();
      renderAttributes(currentFeature());
      recompute();
    });
    els.featureList.appendChild(btn);
  });
}

function renderStats() {
  const p = state.processed;
  if (!p) return;
  const unitLen = p.units === "feet" ? "ft" : "m";
  const props = currentFeature().properties || {};
  const parcelAcres = props.PARCEL_ACRES != null ? Number(props.PARCEL_ACRES) : null;
  let acreLine = "";
  if (parcelAcres != null && p.units === "feet") {
    const delta = p.area.secondary - parcelAcres;
    const warn = Math.abs(delta) > 0.02 ? "warn" : "";
    acreLine = `<div class="stat"><div class="label">PARCEL_ACRES vs computed</div><div class="value ${warn}">${fmtNum(parcelAcres, 4)} / ${fmtNum(p.area.secondary, 4)} acres (Δ ${fmtNum(delta, 4)})</div></div>`;
  }

  els.statsGrid.innerHTML = `
    <div class="stat"><div class="label">Area</div><div class="value">${fmtNum(p.area.primary, 1)} ${p.area.primaryLabel}</div></div>
    <div class="stat"><div class="label">Area (alt)</div><div class="value">${fmtNum(p.area.secondary, 4)} ${p.area.secondaryLabel}</div></div>
    <div class="stat"><div class="label">Perimeter</div><div class="value">${fmtNum(p.perimeter, 2)} ${unitLen}</div></div>
    <div class="stat"><div class="label">Vertices</div><div class="value">${p.cleanVertexCount} <span class="hint">(was ${p.rawVertexCount})</span></div></div>
    <div class="stat"><div class="label">UTM zone</div><div class="value">${p.zone}</div></div>
    ${acreLine}
  `;

  els.originBox.textContent = originCommentText(p);

  const tbody = els.segmentTable.querySelector("tbody");
  tbody.innerHTML = "";
  p.segments.forEach((seg) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="mono">${seg.fromIndex + 1}→${seg.toIndex + 1}</td><td class="mono">${fmtNum(seg.length, 3)}</td><td class="mono">${fmtNum(seg.bearing, 2)}</td>`;
    tbody.appendChild(tr);
  });

  els.calibrationBox.textContent = calibrationText(p);
}

function fitBounds(rings) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const p of ring) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

function drawPreview() {
  const canvas = els.previewCanvas;
  const ctx = canvas.getContext("2d");
  const p = state.processed;
  if (!p) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const rings = p.cleanedRings.map((ringWrap) => ringWrap.open);
  const bounds = fitBounds(rings);
  const pad = 36;
  const spanX = Math.max(bounds.maxX - bounds.minX, 1);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.min((rect.width - pad * 2) / spanX, (rect.height - pad * 2) / spanY);

  const toScreen = (pt) => ({
    x: pad + (pt.x - bounds.minX) * scale,
    y: rect.height - pad - (pt.y - bounds.minY) * scale,
  });

  ctx.lineWidth = 2;
  rings.forEach((ring, ringIdx) => {
    if (ring.length < 2) return;
    const isHole = p.ringMeta[ringIdx]?.isHole;
    ctx.beginPath();
    const first = toScreen(ring[0]);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < ring.length; i++) {
      const s = toScreen(ring[i]);
      ctx.lineTo(s.x, s.y);
    }
    ctx.closePath();
    ctx.strokeStyle = isHole ? "#f85149" : "#58a6ff";
    ctx.fillStyle = isHole ? "rgba(248,81,73,0.08)" : "rgba(88,166,255,0.12)";
    ctx.fill();
    ctx.stroke();
  });

  for (const pt of p.removedVertices) {
    const s = toScreen(pt);
    ctx.fillStyle = "#ffa657";
    ctx.beginPath();
    ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  rings.forEach((ring) => {
    ring.forEach((pt, idx) => {
      const s = toScreen(pt);
      ctx.fillStyle = "#e6edf3";
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#8b949e";
      ctx.font = "11px Consolas, monospace";
      ctx.fillText(String(idx + 1), s.x + 6, s.y - 6);
    });
  });

  const segs = p.segments;
  segs.forEach((seg) => {
    const a = toScreen(seg.from);
    const b = toScreen(seg.to);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    ctx.fillStyle = "#c9d1d9";
    ctx.font = "10px Consolas, monospace";
    ctx.fillText(fmtNum(seg.length, 1), mx + 4, my + 4);
  });
}

function renderAll() {
  renderStats();
  drawPreview();
  els.workPanels.classList.remove("hidden");
  els.attrPanel.classList.remove("hidden");
}

function loadGeoJSONText(text, fileName) {
  clearError();
  const data = parseGeoJSON(text);
  state.geojson = data;
  state.features = data.features.filter((f) => f.geometry);
  state.fileName = fileName || "parcel.geojson";
  state.selectedIndex = 0;
  if (state.features.length === 0) {
    throw new Error("No features with geometry found.");
  }
  els.fileLabel.textContent = `${state.fileName} — ${state.features.length} feature(s)`;
  renderFeaturePicker();
  renderAttributes(currentFeature());
  recompute();
}

function handleFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      loadGeoJSONText(String(reader.result), file.name);
    } catch (err) {
      showError(err.message || String(err));
    }
  };
  reader.readAsText(file);
}

function baseName() {
  const stem = (state.fileName || "parcel").replace(/\.(geo)?json$/i, "");
  const feature = currentFeature();
  const pid = feature?.properties?.PARCEL_ID;
  return pid ? String(pid) : stem;
}

els.dropzone.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", (e) => handleFile(e.target.files[0]));
els.dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  els.dropzone.classList.add("dragover");
});
els.dropzone.addEventListener("dragleave", () => els.dropzone.classList.remove("dragover"));
els.dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  els.dropzone.classList.remove("dragover");
  handleFile(e.dataTransfer.files[0]);
});

for (const input of [els.unitsFeet, els.unitsMeters]) {
  input.addEventListener("change", () => {
    if (input.checked) {
      state.units = input.value;
      recompute();
    }
  });
}

els.dropShortSlider.addEventListener("input", () => {
  state.dropShortFt = Number(els.dropShortSlider.value);
  els.dropShortVal.textContent = fmtNum(state.dropShortFt, 2);
  recompute();
});

els.simplifySlider.addEventListener("input", () => {
  state.simplifyFt = Number(els.simplifySlider.value);
  els.simplifyVal.textContent = fmtNum(state.simplifyFt, 2);
  recompute();
});

els.btnDxf.addEventListener("click", () => {
  const p = state.processed;
  if (!p) return;
  const comment = originCommentText(p);
  downloadText(`${baseName()}.dxf`, generateDxf(p, comment), "application/dxf");
});

els.btnCalibration.addEventListener("click", () => {
  const p = state.processed;
  if (!p) return;
  downloadText(`${baseName()}-calibration.txt`, calibrationText(p));
});

els.btnKml.addEventListener("click", () => {
  const p = state.processed;
  if (!p) return;
  downloadText(`${baseName()}.kml`, generateKml(currentFeature(), p.rings4326), "application/vnd.google-earth.kml+xml");
});

els.btnCsv.addEventListener("click", () => {
  const p = state.processed;
  if (!p) return;
  downloadText(`${baseName()}-vertices.csv`, generateCsv(p), "text/csv");
});

window.addEventListener("resize", () => drawPreview());
