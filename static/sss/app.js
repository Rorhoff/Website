/* Secret Space Society — game client */
"use strict";

// ── Constants ──────────────────────────────────────────────────────────────

const RACES = {
  vorrkai:       { name: "Vorrkai",       color: "#e74c3c" },
  nexari:        { name: "Nexari",        color: "#3498db" },
  luminae:       { name: "Luminae",       color: "#ff69b4" },
  thornveld:     { name: "Thornveld",     color: "#27ae60" },
  obsidian_pact: { name: "Obsidian Pact", color: "#9b59b6" },
  dust_runners:  { name: "Dust Runners",  color: "#8B4513" },
};

const R = 24; // flat-top circumradius px

function hexPoints(cx, cy) {
  const r = R + 0.6;  // inflate by 0.6px so adjacent polygons overlap and close anti-alias seams
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

// ── State ──────────────────────────────────────────────────────────────────

let ws = null;
let myName = "";
let myRole = "";
let gameCode = "";
let myRace = null;
let _connectingBtn = null;   // button to restore after connect attempt
let _connectingErrId = null; // error element to write to on failure

// ── WebSocket ──────────────────────────────────────────────────────────────

const WS_BASE = `ws://${location.host}/api/sss/ws/`;

function connectWs(code, onOpen, errId, btn) {
  if (ws) { try { ws.close(); } catch (_) {} }
  _connectingBtn   = btn   ?? null;
  _connectingErrId = errId ?? null;

  if (btn) { btn.disabled = true; btn.textContent = "Connecting…"; }

  ws = new WebSocket(WS_BASE + code);

  ws.onopen = () => {
    setWsStatus(true);
    if (onOpen) onOpen();
  };

  ws.onclose = (ev) => {
    setWsStatus(false);
    // Only show error if we never got a "joined" (myName not set yet)
    if (!myName && _connectingErrId) {
      showError(_connectingErrId, "Could not connect — make sure the server is running.");
    }
    if (_connectingBtn) { _connectingBtn.disabled = false; _connectingBtn.textContent = _connectingBtn.dataset.label; }
    _connectingBtn = null; _connectingErrId = null;
  };

  ws.onerror = () => setWsStatus(false);

  ws.onmessage = (e) => { try { handleMsg(JSON.parse(e.data)); } catch (_) {} };
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ── Message handler ────────────────────────────────────────────────────────

function handleMsg(msg) {
  switch (msg.type) {
    case "joined":
      myName = msg.name;
      myRole = msg.role;
      gameCode = msg.code;
      // Restore button now that connection succeeded
      if (_connectingBtn) { _connectingBtn.disabled = false; _connectingBtn.textContent = _connectingBtn.dataset.label; }
      _connectingBtn = null; _connectingErrId = null;
      break;
    case "game_state":
    case "board_ready":
    case "player_disconnected":
      applyState(msg);
      break;
    case "race_taken":
      showError("race-error", "That race was just taken — pick another.");
      break;
    case "error":
      routeError(msg.msg);
      break;
  }
}

function routeError(msg) {
  const active = document.querySelector(".screen.active");
  if (!active) return;
  const map = {
    "screen-host-name":  "host-error",
    "screen-join-entry": "join-error",
    "screen-watch-entry":"watch-error",
    "screen-lobby":      "lobby-error",
    "screen-race-pick":  "race-error",
  };
  const errId = map[active.id];
  if (errId) showError(errId, msg);
}

// ── State → UI ─────────────────────────────────────────────────────────────

function applyState(state) {
  $("status-phase").textContent = state.phase ?? "";
  $("status-code").textContent  = state.code  ? `Code: ${state.code}` : "";

  switch (state.phase) {
    case "lobby":     showScreen("screen-lobby");     renderLobby(state);    break;
    case "race_pick": showScreen("screen-race-pick"); renderRacePick(state); break;
    case "board":     showScreen("screen-board");     renderBoard(state);    break;
  }
}

// ── Lobby ──────────────────────────────────────────────────────────────────

function renderLobby(state) {
  $("lobby-code").textContent = state.code;
  const list = $("lobby-player-list");
  list.innerHTML = "";
  for (const p of state.players) {
    const li = document.createElement("li");
    const badge = document.createElement("span");
    badge.className = "player-badge" + (p.role === "host" ? " host" : "");
    li.appendChild(badge);
    li.appendChild(document.createTextNode(p.name + (p.role === "host" ? " (Host)" : "")));
    list.appendChild(li);
  }
  $("lobby-host-actions").style.display = myRole === "host" ? "" : "none";
}

// ── Race pick ──────────────────────────────────────────────────────────────

function renderRacePick(state) {
  const grid = $("race-grid");
  grid.innerHTML = "";
  const takenBy = state.races_taken ?? {};
  const raceList = state.races ?? RACES;

  for (const [id, race] of Object.entries(raceList)) {
    const taker = takenBy[id];
    const isMine  = taker === myName;
    const isTaken = !!taker && !isMine;

    const card = document.createElement("div");
    card.className = "race-card" + (isMine ? " selected" : "") + (isTaken ? " taken" : "");
    card.innerHTML = `
      <div class="race-dot" style="background:${race.color}"></div>
      <div class="race-name">${race.name}</div>
      <div class="race-taker">${taker ? (isMine ? "You" : taker) : ""}</div>
    `;
    if (!isTaken && myRole !== "watcher") {
      card.addEventListener("click", () => { myRace = id; send({ type: "pick_race", race: id }); });
    }
    grid.appendChild(card);
  }

  const confirmBtn = $("btn-confirm-race");
  if (myRole === "host") confirmBtn.classList.remove("hidden");
  else confirmBtn.classList.add("hidden");
}

// ── Board ──────────────────────────────────────────────────────────────────

// Triforce arrangement: top=soft-yellow, bottom-left=soft-red, bottom-right=soft-blue
// Centers of the 3 small triangles relative to the group centre, circumradius r each.
const TRI_CONFIGS = [
  { dx:  0,      dy: -1,   fill: "#f0d060" },  // top      — soft yellow
  { dx: -0.866,  dy:  0.5, fill: "#e07878" },  // BL       — soft red
  { dx:  0.866,  dy:  0.5, fill: "#6fa8dc" },  // BR       — soft blue
];

function drawTriangles(layer, h) {
  const r = 7;  // circumradius of each small triangle (overall triforce ≈ 2r tall)
  for (const { dx, dy, fill } of TRI_CONFIGS) {
    const tx = h.x + dx * r;
    const ty = h.y + dy * r;
    // Upward-pointing equilateral triangle vertices
    const top = `${tx.toFixed(2)},${(ty - r).toFixed(2)}`;
    const bl  = `${(tx - r * 0.866).toFixed(2)},${(ty + r * 0.5).toFixed(2)}`;
    const br  = `${(tx + r * 0.866).toFixed(2)},${(ty + r * 0.5).toFixed(2)}`;
    const tri = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    tri.setAttribute("points", `${top} ${bl} ${br}`);
    tri.setAttribute("fill", fill);
    tri.setAttribute("stroke", "rgba(0,0,0,0.3)");
    tri.setAttribute("stroke-width", "0.8");
    layer.appendChild(tri);
  }
}

function renderBoard(state) {
  const banner = $("watcher-banner");
  if (myRole === "watcher") banner.classList.remove("hidden");
  else banner.classList.add("hidden");

  const infoCard = $("board-player-info");
  if (myRole !== "watcher") {
    const me = (state.players ?? []).find(p => p.name === myName);
    if (me && me.race) {
      infoCard.innerHTML = `<span style="color:${me.color};font-weight:700;font-size:1.1rem">${me.race_name}</span>&nbsp; — <strong>${me.name}</strong>`;
    } else {
      infoCard.innerHTML = `<strong>${myName}</strong>`;
    }
  } else {
    infoCard.innerHTML = `<span class="hint">Spectating</span>`;
  }

  const hexLayer   = $("hex-layer");
  const pieceLayer = $("piece-layer");
  const labelLayer = $("label-layer");
  hexLayer.innerHTML   = "";
  pieceLayer.innerHTML = "";
  labelLayer.innerHTML = "";

  const hexes = state.board ?? [];

  for (const h of hexes) {
    // Draw hex polygon
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    poly.setAttribute("points", hexPoints(h.x, h.y));
    poly.setAttribute("class", `hex-poly hex-${h.type}`);
    poly.setAttribute("data-id", h.id);
    hexLayer.appendChild(poly);

    // Cluster label on center hex
    if (h.local === 0 && h.label) {
      const lbl = document.createElementNS("http://www.w3.org/2000/svg", "text");
      lbl.setAttribute("x", h.x);
      lbl.setAttribute("y", h.y + 4);
      lbl.setAttribute("text-anchor", "middle");
      lbl.setAttribute("font-size", "7");
      lbl.setAttribute("font-weight", "bold");
      lbl.setAttribute("fill",
        h.type === "black_hole" ? "#b39ddb" : "rgba(0,0,0,0.6)"
      );
      lbl.textContent = `CORE ${h.label}`;
      labelLayer.appendChild(lbl);
    }

    // System triangles — server marks exactly which surrounding hex gets them (never local 0)
    if (h.tri) {
      drawTriangles(pieceLayer, h);
    }
  }

  // Legend
  const legend = $("board-legend");
  legend.innerHTML = "";
  const tiles = [
    { color: "#d0d0d0", label: "White system" },
    { color: "#1a5296", label: "Blue system" },
    { color: "#1a5c32", label: "Green system" },
    { color: "#7a1515", label: "Red system" },
    { color: "#7a6315", label: "Yellow system" },
    { color: "#000",    label: "Black Hole", border: "#7c3aed" },
    { color: "#0e1825", label: "Deep space" },
  ];
  for (const t of tiles) {
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `<div class="legend-dot" style="background:${t.color};${t.border ? `border-color:${t.border}` : ""}"></div><span>${t.label}</span>`;
    legend.appendChild(item);
  }
  for (const p of (state.players ?? [])) {
    if (!p.race) continue;
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `<div class="legend-dot" style="background:${p.color}"></div><span>${p.race_name} — ${p.name}</span>`;
    legend.appendChild(item);
  }
}

// ── Screens / helpers ──────────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
}

function $(id) { return document.getElementById(id); }

function showError(id, msg) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 5000);
}

function setWsStatus(connected) {
  $("ws-dot").className = "dot" + (connected ? " connected" : "");
  $("ws-status").textContent = connected ? "Connected" : "Disconnected";
}

// ── Button wiring ──────────────────────────────────────────────────────────

$("btn-host").addEventListener("click",  () => showScreen("screen-host-name"));
$("btn-join").addEventListener("click",  () => showScreen("screen-join-entry"));
$("btn-watch").addEventListener("click", () => showScreen("screen-watch-entry"));

$("btn-host-back").addEventListener("click",  () => showScreen("screen-landing"));
$("btn-join-back").addEventListener("click",  () => showScreen("screen-landing"));
$("btn-watch-back").addEventListener("click", () => showScreen("screen-landing"));

// Store original labels so we can restore them after connect attempt
["btn-host-submit","btn-join-submit","btn-watch-submit"].forEach(id => {
  const el = $(id);
  el.dataset.label = el.textContent;
});

$("btn-host-submit").addEventListener("click", () => {
  const name = $("host-name-input").value.trim();
  if (name.length < 2) { showError("host-error", "Name must be at least 2 characters."); return; }
  const btn = $("btn-host-submit");
  connectWs("NEW", () => send({ type: "host", name }), "host-error", btn);
});
$("host-name-input").addEventListener("keydown", e => { if (e.key === "Enter") $("btn-host-submit").click(); });

$("btn-join-submit").addEventListener("click", () => {
  const name = $("join-name-input").value.trim();
  const code = $("join-code-input").value.trim().toUpperCase();
  if (name.length < 2) { showError("join-error", "Name must be at least 2 characters."); return; }
  if (code.length !== 4) { showError("join-error", "Code must be 4 letters."); return; }
  const btn = $("btn-join-submit");
  connectWs(code, () => send({ type: "join", name, code }), "join-error", btn);
});
["join-name-input","join-code-input"].forEach(id => {
  $(id).addEventListener("keydown", e => { if (e.key === "Enter") $("btn-join-submit").click(); });
});

$("btn-watch-submit").addEventListener("click", () => {
  const code = $("watch-code-input").value.trim().toUpperCase();
  if (code.length !== 4) { showError("watch-error", "Code must be 4 letters."); return; }
  const btn = $("btn-watch-submit");
  connectWs(code, () => send({ type: "watch", code }), "watch-error", btn);
});
$("watch-code-input").addEventListener("keydown", e => { if (e.key === "Enter") $("btn-watch-submit").click(); });

$("btn-start-game").addEventListener("click",   () => send({ type: "start_game" }));
$("btn-confirm-race").addEventListener("click", () => send({ type: "confirm_race" }));

setInterval(() => send({ type: "ping" }), 25_000);
