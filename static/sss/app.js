/* Secret Space Society — game client */
"use strict";

// ── Constants ──────────────────────────────────────────────────────────────

const RACES = {
  vorrkai:       { name: "Vorrkai",       color: "#e74c3c" },
  nexari:        { name: "Nexari",        color: "#1a5fa8" },
  luminae:       { name: "Luminae",       color: "#ff69b4" },
  thornveld:     { name: "Thornveld",     color: "#27ae60" },
  obsidian_pact: { name: "Obsidian Pact", color: "#9b59b6" },
  dust_runners:  { name: "Dust Runners",  color: "#8B4513" },
};

const R = 25.2; // flat-top circumradius px (5 % larger than original 24)

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
let boardCache = null;   // last received board data
let viewMode = "map";    // "map" | "card"
let _connectingBtn = null;
let _connectingErrId = null;
let _lastStateSeq = -1;  // monotonic seq; reject any state with seq <= this
let _boardPhaseOpened = false;
let _actionMode      = null;  // { type: "flight"|"invasion"|"attack"|"construction" }
let _selectedCluster = null;  // cluster index of selected source, or null
let _selectedRoutes  = [];    // routes from _selectedCluster
let _constructionPiece = null; // { type, cost } when in construction placement mode
let _lastState       = null;  // most recent full state for re-renders

// ── WebSocket ──────────────────────────────────────────────────────────────

const WS_BASE = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/sss/ws/`;

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
      _lastStateSeq = -1;
      _boardPhaseOpened = false;
      if (_connectingBtn) { _connectingBtn.disabled = false; _connectingBtn.textContent = _connectingBtn.dataset.label; }
      _connectingBtn = null; _connectingErrId = null;
      break;
    case "draft_start":
    case "place_pieces_start":
    case "game_state":
    case "board_ready":
    case "player_disconnected":
      if (msg.seq !== undefined && msg.seq <= _lastStateSeq) break; // stale out-of-order state
      if (msg.seq !== undefined) _lastStateSeq = msg.seq;
      if (msg.board) boardCache = msg.board;
      applyState(msg);
      break;
    case "invasion_prompt":
      if (msg.board) boardCache = msg.board;
      _lastState = msg;
      applyState(msg);
      showInvasionPrompt(msg);
      break;
    case "invasion_result":
      if (msg.seq !== undefined && msg.seq <= _lastStateSeq) break;
      if (msg.seq !== undefined) _lastStateSeq = msg.seq;
      if (msg.board) boardCache = msg.board;
      _lastState = msg;
      applyState(msg);
      showInvasionResult(msg);
      break;
    case "combat_prompt":
      if (msg.board) boardCache = msg.board;
      _lastState = msg;
      applyState(msg);
      showCombatPrompt(msg);
      break;
    case "combat_result":
      if (msg.seq !== undefined && msg.seq <= _lastStateSeq) break;
      if (msg.seq !== undefined) _lastStateSeq = msg.seq;
      if (msg.board) boardCache = msg.board;
      _lastState = msg;
      applyState(msg);
      showCombatResult(msg);
      break;
    case "race_taken":
      showError("race-error", "That race was just taken — pick another.");
      break;
    case "error":
      console.error("[SSS server error]", msg.msg);
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
  _lastState = state;
  $("status-phase").textContent = state.phase ?? "";
  $("status-code").textContent  = state.code  ? `Code: ${state.code}` : "";
  // If the turn changed while we had a selection, clear it
  if (state.current_turn !== myName) {
    _actionMode = null; _selectedCluster = null; _selectedRoutes = []; _constructionPiece = null;
  }

  switch (state.phase) {
    case "lobby":        showScreen("screen-lobby");      renderLobby(state);         break;
    case "race_pick":    showScreen("screen-race-pick");  renderRacePick(state);      break;
    case "dice_roll":    showScreen("screen-dice-roll");  renderDiceRoll(state);      break;
    case "place_pieces": hideDraftOverlay(); showScreen("screen-board"); renderBoard(state, true);  break;
    case "draft":
      showScreen("screen-board"); renderBoard(state, false);
      if (myRole === "host") send({ type: "begin_action" });
      break;
    case "board":
      hideDraftOverlay(); showScreen("screen-board"); renderBoard(state, false);
      break;
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

// ── Dice Roll ──────────────────────────────────────────────────────────────

function renderDiceRoll(state) {
  const rows = $("dice-player-rows");
  rows.innerHTML = "";
  const inRound = new Set(state.dice_round ?? []);
  const turnOrder = state.turn_order ?? [];

  for (const p of (state.players ?? [])) {
    const placed = turnOrder.indexOf(p.name);
    const rolling = inRound.has(p.name);
    const rolled  = p.dice_roll > 0;
    const dot = p.color ? `<span class="player-badge" style="background:${p.color};width:10px;height:10px;display:inline-block;border-radius:50%;margin-right:.5rem"></span>` : "";
    let status = "";
    if (placed >= 0 && rolled) {
      // Show the actual roll value alongside the resolved position
      status = `<strong style="font-size:1.3rem">${p.dice_roll}</strong><span style="color:var(--gold);margin-left:.5rem">→ #${placed + 1}</span>`;
    } else if (placed >= 0) {
      status = `<span style="color:var(--gold)">→ Position ${placed + 1}</span>`;
    } else if (!rolling) {
      status = `<span class="hint">waiting…</span>`;
    } else if (rolled) {
      status = `<strong style="font-size:1.3rem">${p.dice_roll}</strong><span class="hint" style="margin-left:.4rem">(rolled)</span>`;
    } else {
      status = `<span class="hint">rolling…</span>`;
    }
    const row = document.createElement("div");
    row.className = "row mt1";
    row.innerHTML = `${dot}<span style="min-width:130px">${p.name}</span>${status}`;
    rows.appendChild(row);
  }

  const btn = $("btn-roll-dice");
  const me = (state.players ?? []).find(p => p.name === myName);
  const canRoll = me && inRound.has(myName) && me.dice_roll === 0 && myRole !== "watcher";
  if (canRoll) btn.classList.remove("hidden");
  else btn.classList.add("hidden");
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
  const r = 7.35;
  // Index 1 (BL) is the farmer triangle — red or green based on upgrade status
  const fills = ["#f0d060", h.tri_farmer_green ? "#6abf69" : "#e07878", "#6fa8dc"];
  for (let i = 0; i < TRI_CONFIGS.length; i++) {
    const { dx, dy } = TRI_CONFIGS[i];
    const tx = h.x + dx * r, ty = h.y + dy * r;
    const top = `${tx.toFixed(2)},${(ty - r).toFixed(2)}`;
    const bl  = `${(tx - r * 0.866).toFixed(2)},${(ty + r * 0.5).toFixed(2)}`;
    const br  = `${(tx + r * 0.866).toFixed(2)},${(ty + r * 0.5).toFixed(2)}`;
    const tri = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    tri.setAttribute("points", `${top} ${bl} ${br}`);
    tri.setAttribute("fill", fills[i]);
    tri.setAttribute("stroke", "rgba(0,0,0,0.3)");
    tri.setAttribute("stroke-width", "0.8");
    layer.appendChild(tri);
  }
}

function drawTriCounters(layer, h) {
  const svgNS = "http://www.w3.org/2000/svg";
  const r = 7;
  const counts = h.tri_counts?.length ? h.tri_counts : [1, 1, 1];
  for (let i = 0; i < TRI_CONFIGS.length; i++) {
    const { dx, dy } = TRI_CONFIGS[i];
    const tx = h.x + dx * r, ty = h.y + dy * r;
    const t = document.createElementNS(svgNS, "text");
    t.setAttribute("x", tx);
    t.setAttribute("y", ty + 1.8);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", "5");
    t.setAttribute("font-weight", "bold");
    t.setAttribute("fill", "rgba(0,0,0,0.85)");
    t.textContent = counts[i] ?? 1;
    layer.appendChild(t);
  }
}

// Friendly names for piece types displayed in the player card
const PIECE_NAMES = {
  death:          "Death Star",
  super_ship:     "Super Ship",
  cruise_ship:    "Cruise Ship",
  frigate:        "Frigate",
  outpost:        "Outpost",
  battle_station: "Battle Station",
  empire_flag:    "Empire Flag",
  unrest:         "Unrest",
};

function drawWormholeLines(wormholeLayer, hexes, hexById) {
  const svgNS = "http://www.w3.org/2000/svg";
  const inR = R * Math.sqrt(3) / 2;  // hex inradius, used as trim ceiling
  const drawn = new Set();
  for (const h of hexes) {
    if (!h.wormhole || h.wormhole_partner === null) continue;
    const key = Math.min(h.id, h.wormhole_partner) + "," + Math.max(h.id, h.wormhole_partner);
    if (drawn.has(key)) continue;
    drawn.add(key);
    const partner = hexById[h.wormhole_partner];
    if (!partner) continue;

    const dx = partner.x - h.x, dy = partner.y - h.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const ux = dx / len, uy = dy / len;

    // Trim a small fixed amount from each end so the line starts outside the hex label
    // but stays fully visible even for closely-spaced diagonal pairs
    const trim = Math.min(inR * 0.5, len * 0.12);
    const x1 = h.x + ux * trim,       y1 = h.y + uy * trim;
    const x2 = partner.x - ux * trim, y2 = partner.y - uy * trim;

    const glow = document.createElementNS(svgNS, "line");
    glow.setAttribute("x1", x1); glow.setAttribute("y1", y1);
    glow.setAttribute("x2", x2); glow.setAttribute("y2", y2);
    glow.setAttribute("stroke", "#2563eb");
    glow.setAttribute("stroke-width", "5");
    glow.setAttribute("stroke-dasharray", "5 4");
    glow.setAttribute("opacity", "0.35");
    wormholeLayer.appendChild(glow);

    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", x1); line.setAttribute("y1", y1);
    line.setAttribute("x2", x2); line.setAttribute("y2", y2);
    line.setAttribute("stroke", "#93c5fd");
    line.setAttribute("stroke-width", "1.5");
    line.setAttribute("stroke-dasharray", "5 4");
    line.setAttribute("opacity", "0.9");
    wormholeLayer.appendChild(line);
  }
}

function drawBoardPieces(pieceLayer, hexes, players) {
  const svgNS = "http://www.w3.org/2000/svg";
  const colorByOwner = {};
  for (const p of (players ?? [])) {
    if (p.name && p.color) colorByOwner[p.name] = p.color;
  }
  colorByOwner["neutral"] = "#64748b";

  const mk = (tag, attrs) => {
    const el = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };

  for (const h of hexes) {
    if (!h.pieces || h.pieces.length === 0) continue;
    const flags    = h.pieces.filter(p => p.type === "empire_flag");
    const frigates = h.pieces.filter(p => p.type === "frigate");
    const others   = h.pieces.filter(p => p.type !== "empire_flag" && p.type !== "frigate");

    // Empire flag: small square pinned to top-left area of hex
    flags.forEach((fp, fi) => {
      const c = colorByOwner[fp.owner] ?? "#888";
      pieceLayer.appendChild(mk("rect", {
        x: h.x - 12 + fi * 10, y: h.y - 18,
        width: "8", height: "8", fill: c,
        opacity: "0.9", rx: "1",
      }));
    });

    const frigateSlotW = 16;  // 3 columns × ~5px spacing fits in 1/3 of hex
    const otherSlotW   = 11;
    const totalW = frigates.length * frigateSlotW + others.length * otherSlotW;
    if (frigates.length + others.length === 0) continue;
    const baseY  = h.y + 3;
    let xCursor  = h.x - totalW / 2;

    // Frigates: 2-row × 3-column grid of circles per piece
    frigates.forEach((piece) => {
      const c  = colorByOwner[piece.owner] ?? "#888";
      const cx = xCursor + frigateSlotW / 2;
      xCursor += frigateSlotW;
      for (const yOff of [-2.5, 2.5]) {
        for (const xOff of [-5, 0, 5]) {
          pieceLayer.appendChild(mk("circle", {
            cx: cx + xOff, cy: baseY + yOff, r: "2",
            fill: c, opacity: "0.85",
            stroke: "rgba(255,255,255,0.4)", "stroke-width": "0.6",
          }));
        }
      }
    });

    // Other pieces: circle or square, one per slot
    others.forEach((piece) => {
      const c  = colorByOwner[piece.owner] ?? "#888";
      const cx = xCursor + otherSlotW / 2;
      const cy = baseY;
      xCursor += otherSlotW;

      if (piece.type === "influence_token") {
        const r = 4.5;
        pieceLayer.appendChild(mk("rect", {
          x: cx - r, y: cy - r, width: r * 2, height: r * 2,
          fill: c, opacity: "0.85", rx: "1.5",
          stroke: "rgba(255,255,255,0.4)", "stroke-width": "0.8",
        }));
      } else if (piece.type === "battle_station") {
        pieceLayer.appendChild(mk("circle", { cx, cy, r: "7", fill: c, opacity: "0.85", stroke: "rgba(255,255,255,0.4)", "stroke-width": "0.8" }));
        pieceLayer.appendChild(mk("line", { x1: cx - 3.5, y1: cy, x2: cx + 3.5, y2: cy, stroke: "rgba(0,0,0,0.5)", "stroke-width": "1.5" }));
        pieceLayer.appendChild(mk("line", { x1: cx, y1: cy - 3.5, x2: cx, y2: cy + 3.5, stroke: "rgba(0,0,0,0.5)", "stroke-width": "1.5" }));
      } else if (piece.type === "death_star") {
        // Diamond + inner circle
        pieceLayer.appendChild(mk("polygon", { points: `${cx},${cy-8} ${cx+8},${cy} ${cx},${cy+8} ${cx-8},${cy}`, fill: c, opacity: "0.9", stroke: "#fff", "stroke-width": "0.8" }));
        pieceLayer.appendChild(mk("circle", { cx, cy, r: "3", fill: "rgba(0,0,0,0.5)" }));
      } else if (piece.type === "super_ship") {
        pieceLayer.appendChild(mk("circle", { cx, cy, r: "6.5", fill: c, opacity: "0.9", stroke: "#fff", "stroke-width": "1" }));
        const sLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
        sLabel.setAttribute("x", cx); sLabel.setAttribute("y", cy + 2.5);
        sLabel.setAttribute("text-anchor", "middle"); sLabel.setAttribute("font-size", "6");
        sLabel.setAttribute("fill", "#000"); sLabel.setAttribute("pointer-events", "none");
        sLabel.textContent = "S";
        pieceLayer.appendChild(sLabel);
      } else if (piece.type === "cruise_ship") {
        pieceLayer.appendChild(mk("rect", { x: cx - 5, y: cy - 3.5, width: "10", height: "7", rx: "3", fill: c, opacity: "0.9", stroke: "rgba(255,255,255,0.4)", "stroke-width": "0.7" }));
      } else if (piece.type === "outpost") {
        // Triangle
        pieceLayer.appendChild(mk("polygon", { points: `${cx},${cy-6} ${cx+5.5},${cy+3.5} ${cx-5.5},${cy+3.5}`, fill: c, opacity: "0.9", stroke: "rgba(255,255,255,0.5)", "stroke-width": "0.8" }));
      } else {
        pieceLayer.appendChild(mk("circle", { cx, cy, r: "4.5", fill: c, opacity: "0.85", stroke: "rgba(255,255,255,0.4)", "stroke-width": "0.8" }));
      }
    });
  }
}

function renderBoard(state, placementMode) {
  const banner = $("watcher-banner");
  if (myRole === "watcher") {
    banner.classList.remove("hidden");
    const svg = $("board-svg");
    svg.setAttribute("width",  "960");
    svg.setAttribute("height", "880");
    svg.setAttribute("viewBox", "120 50 580 670");
  } else {
    banner.classList.add("hidden");
  }

  // Toggle view button — board phase only, players only
  const toggleBtn = $("btn-toggle-view");
  if (!placementMode && myRole !== "watcher") {
    toggleBtn.classList.remove("hidden");
    renderFullPlayerCard(state);
  } else {
    toggleBtn.classList.add("hidden");
    if (viewMode !== "map") setViewMode("map");
  }

  // Player info card
  const infoCard = $("board-player-info");
  if (placementMode) {
    renderPlacementInfo(state, infoCard);
  } else if (myRole !== "watcher") {
    const me = (state.players ?? []).find(p => p.name === myName);
    if (me && me.race) {
      const pieces = me.pieces ?? {};
      const pieceHtml = Object.entries(pieces)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `<span><span class="pc">${n}</span> ${PIECE_NAMES[k] ?? k}</span>`)
        .join("");
      infoCard.innerHTML = `
        <div class="player-race-card">
          <div class="race-card-header">
            <div class="race-card-badge" style="background:${me.color}"></div>
            <div>
              <div class="race-card-title" style="color:${me.color}">${me.race_name}</div>
              <div class="race-card-player">${me.name}</div>
            </div>
          </div>
          ${pieceHtml ? `<div class="piece-grid">${pieceHtml}</div>` : ""}
        </div>`;
      // Turn action UI
      const currentTurn = state.current_turn ?? null;
      const raceCard = infoCard.querySelector(".player-race-card");
      if (raceCard) {
        if (_constructionPiece) {
          const d = document.createElement("div");
          d.className = "flight-hint";
          d.innerHTML = `<div class="hint">Click an orbital hex in your system to place a <strong>${_constructionPiece.label}</strong>.</div>
            <button class="btn btn-ghost btn-sm mt1" id="btn-cancel-construct">Cancel</button>`;
          raceCard.appendChild(d);
          document.getElementById("btn-cancel-construct").addEventListener("click", () => {
            _constructionPiece = null; _actionMode = null;
            if (_lastState) renderBoard(_lastState, false);
          });
        } else if (_actionMode) {
          const hint = _selectedCluster !== null
            ? (_actionMode.type === "attack"
                ? "Click the enemy system to engage combat."
                : "Click a highlighted system to move your frigates.")
            : _actionMode.type === "invasion"
              ? "Click one of your frigate systems, then click a planet system to invade."
              : _actionMode.type === "attack"
                ? "Click one of your frigate systems, then click an enemy system to attack."
                : "Click one of your frigate systems, then click a connected system.";
          const d = document.createElement("div");
          d.className = "flight-hint";
          d.innerHTML = `<div class="hint">${hint}</div>
            <button class="btn btn-ghost btn-sm mt1" id="btn-cancel-action">Cancel</button>`;
          raceCard.appendChild(d);
          document.getElementById("btn-cancel-action").addEventListener("click", () => {
            _actionMode = null; _selectedCluster = null; _selectedRoutes = [];
            if (_lastState) renderBoard(_lastState, false);
          });
        } else if (currentTurn === myName) {
          const d = document.createElement("div");
          d.className = "turn-actions";
          d.innerHTML = `<button class="btn btn-ghost btn-sm" id="btn-skip-turn">Skip Turn</button>
            <button class="btn btn-primary btn-sm" id="btn-play-card">Play a Card</button>`;
          raceCard.appendChild(d);
          document.getElementById("btn-skip-turn").addEventListener("click", () => send({ type: "skip_turn" }));
          document.getElementById("btn-play-card").addEventListener("click", () => showActionPicker());
        } else if (currentTurn) {
          const d = document.createElement("div");
          d.innerHTML = `<div class="hint" style="font-size:.8rem;margin-top:.5rem">${currentTurn}'s turn</div>`;
          raceCard.appendChild(d);
        }
      }
    } else {
      infoCard.innerHTML = `<strong>${myName}</strong>`;
    }
  } else {
    infoCard.innerHTML = `<span class="hint">Spectating</span>`;
  }

  const hexLayer      = $("hex-layer");
  const wormholeLayer = $("wormhole-layer");
  const pieceLayer    = $("piece-layer");
  const labelLayer    = $("label-layer");
  const dragLayer     = $("drag-layer");
  hexLayer.innerHTML      = "";
  wormholeLayer.innerHTML = "";
  pieceLayer.innerHTML    = "";
  labelLayer.innerHTML    = "";
  if (dragLayer) dragLayer.innerHTML = "";

  // When an action is in progress, make upper SVG layers transparent to pointer events
  // so clicks always land on the hex polygon in hex-layer beneath them.
  const inActionMode = !placementMode && myRole !== "watcher"
    && ((_actionMode && state.current_turn === myName) || _constructionPiece);
  pieceLayer.setAttribute("pointer-events", inActionMode ? "none" : "all");
  labelLayer.setAttribute("pointer-events", inActionMode ? "none" : "all");

  const hexes = (state.board ?? boardCache ?? []);
  const hexById = {};
  for (const h of hexes) hexById[h.id] = h;

  // Placement validity helpers
  const mySystem    = (state.player_system ?? {})[myName] ?? null;
  const myRemaining = (state.player_placement ?? {})[myName] ?? [];
  const isMyTurn    = placementMode && state.current_placer === myName && myRole !== "watcher";
  const nextPiece   = myRemaining[0];
  const claimedByOthers = new Set(
    Object.entries(state.player_system ?? {})
      .filter(([n]) => n !== myName)
      .map(([, c]) => c)
  );
  const coreType = {};
  for (const h of hexes) { if (h.local === 0) coreType[h.cluster] = h.type; }
  const triClusters = new Set();
  for (const h of hexes) { if (h.tri) triClusters.add(h.cluster); }
  const claimedClusters = new Set(Object.values(state.player_system ?? {}));
  const playerColorMap = {};
  for (const p of (state.players ?? [])) { if (p.name && p.color) playerColorMap[p.name] = p.color; }
  const claimedColor = {};
  for (const [pname, cluster] of Object.entries(state.player_system ?? {})) {
    if (playerColorMap[pname]) claimedColor[cluster] = playerColorMap[pname];
  }

  // Action-mode: pre-compute selectable sources and reachable targets
  const actionSourceClusters = new Set();
  const actionTargetClusters = new Set();
  const actionRoutesMap = {};  // cluster → routes[]
  const invasionSourceClusters = new Set(); // clusters where invasion can be launched

  const isActionTurn = !placementMode && _actionMode
    && state.current_turn === myName && myRole !== "watcher";

  if (isActionTurn && _actionMode.type === "invasion") {
    // Invasion sources: clusters where player has frigates in a non-owned planet system
    const myOwnedClusters = new Set();
    const homeCluster = (state.player_system ?? {})[myName];
    if (homeCluster != null) myOwnedClusters.add(homeCluster);
    for (const h of hexes) {
      if ((h.pieces ?? []).some(p => p.type === "empire_flag" && p.owner === myName))
        myOwnedClusters.add(h.cluster);
    }
    for (const h of hexes) {
      if (!(h.pieces ?? []).some(p => p.type === "frigate" && p.owner === myName)) continue;
      if (myOwnedClusters.has(h.cluster)) continue;
      const core = hexes.find(c => c.cluster === h.cluster && c.local === 0);
      if (core && core.planet) invasionSourceClusters.add(h.cluster);
    }
  } else if (isActionTurn) {
    if (_selectedCluster === null) {
      for (const h of hexes) {
        if ((h.pieces ?? []).some(p => p.type === "frigate" && p.owner === myName)) {
          if (actionSourceClusters.has(h.cluster)) continue;
          const routes = _actionMode.type === "attack"
            ? computeAttackRoutes(hexes, h.cluster)
            : computeFlightOnlyRoutes(hexes, h.cluster);
          if (routes.length > 0) {
            actionSourceClusters.add(h.cluster);
            actionRoutesMap[h.cluster] = routes;
          }
        }
      }
    } else {
      actionSourceClusters.add(_selectedCluster);
      for (const r of _selectedRoutes) actionTargetClusters.add(r.dest_cluster);
    }
  }

  const svgNS = "http://www.w3.org/2000/svg";
  const mkEl = (tag, attrs) => {
    const el = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };

  for (const h of hexes) {
    const poly = document.createElementNS(svgNS, "polygon");
    poly.setAttribute("points", hexPoints(h.x, h.y));

    let validTarget = false;
    if (isMyTurn) {
      if (nextPiece === "battle_station") {
        validTarget = h.type === "bs_slot"
                      && triClusters.has(h.cluster)
                      && !claimedByOthers.has(h.cluster)
                      && coreType[h.cluster] !== "black_hole";
      } else if (nextPiece === "frigate") {
        validTarget = h.cluster === mySystem && h.local > 0;
      } else if (nextPiece === "influence_token") {
        validTarget = h.cluster === mySystem
                      && !h.pieces.some(p => p.type === "influence_token");
      }
    }

    // Construction placement: highlight valid hexes for the piece being built
    const isConstructionTurn = !placementMode && _constructionPiece
      && state.current_turn === myName && myRole !== "watcher";
    let validConstructTarget = false;
    if (isConstructionTurn && h.cluster === mySystem && h.local > 0) {
      if (_constructionPiece.type === "battle_station") {
        validConstructTarget = h.type === "bs_slot";
      } else {
        validConstructTarget = h.type === "orbital";
      }
    }

    let cls = `hex-poly hex-${h.type}`;
    if (h.tri) cls += " hex-tri";
    if (validTarget) cls += " hex-placeable";

    const isSource  = isActionTurn && actionSourceClusters.has(h.cluster);
    const isTarget  = isActionTurn && actionTargetClusters.has(h.cluster);
    const isSelected = isActionTurn && _selectedCluster !== null && h.cluster === _selectedCluster;
    const isInvasionSource = isActionTurn && _actionMode?.type === "invasion"
      && invasionSourceClusters.has(h.cluster);
    if (isSelected) cls += " hex-selected";
    else if (isSource) cls += " hex-selectable";
    else if (isInvasionSource) cls += " hex-selectable";
    if (isTarget) cls += " hex-flight-target";
    if (validConstructTarget) cls += " hex-construct-target";

    poly.setAttribute("class", cls);
    poly.setAttribute("data-id", h.id);

    // Transparent hit-polygon in drag-layer (top layer) so clicks land even when
    // piece/label SVG elements visually cover the hex polygon below.
    const addHit = (handler) => {
      if (!dragLayer) return;
      const hit = document.createElementNS(svgNS, "polygon");
      hit.setAttribute("points", hexPoints(h.x, h.y));
      hit.setAttribute("fill", "rgba(0,0,0,0)");
      hit.setAttribute("stroke", "none");
      hit.setAttribute("pointer-events", "all");
      hit.style.cursor = "pointer";
      hit.addEventListener("click", handler);
      dragLayer.appendChild(hit);
    };

    if (validConstructTarget) {
      poly.style.cursor = "pointer";
      const handler = () => {
        const piece = _constructionPiece;
        _constructionPiece = null; _actionMode = null;
        send({ type: "build_piece", piece_type: piece.type, hex_id: h.id });
      };
      poly.addEventListener("click", handler);
      addHit(handler);
    } else if (validTarget) {
      poly.style.cursor = "pointer";
      const handler = () => send({ type: "place_piece", hex_id: h.id });
      poly.addEventListener("click", handler);
      addHit(handler);
    } else if (isTarget) {
      poly.style.cursor = "pointer";
      const handler = () => {
        const route = _selectedRoutes.find(r => r.dest_cluster === h.cluster);
        if (!route) return;
        const type = _actionMode.type;
        _actionMode = null; _selectedCluster = null; _selectedRoutes = [];
        const msg = {
          type: type === "invasion" ? "invasion_move" : "flight_move",
          from_wormhole: route.from_wormhole,
          to_wormhole:   route.to_wormhole,
        };
        console.log("[SSS] sending", msg);
        send(msg);
      };
      poly.addEventListener("click", handler);
      addHit(handler);
    } else if (isInvasionSource) {
      poly.style.cursor = "pointer";
      const handler = () => {
        const cluster = h.cluster;
        _actionMode = null;
        send({ type: "invasion_attack", cluster });
      };
      poly.addEventListener("click", handler);
      addHit(handler);
    } else if (isSource && _selectedCluster === null) {
      poly.style.cursor = "pointer";
      const handler = () => {
        _selectedCluster = h.cluster;
        _selectedRoutes  = actionRoutesMap[h.cluster] ?? [];
        if (_lastState) renderBoard(_lastState, false);
      };
      poly.addEventListener("click", handler);
      addHit(handler);
    } else if (isSelected) {
      poly.style.cursor = "pointer";
      const handler = () => {
        _selectedCluster = null; _selectedRoutes = [];
        if (_lastState) renderBoard(_lastState, false);
      };
      poly.addEventListener("click", handler);
      addHit(handler);
    }

    hexLayer.appendChild(poly);

    // Core hex: planet if claimed, otherwise cluster label
    if (h.local === 0) {
      const pColor = claimedColor[h.cluster];
      if (h.planet && pColor) {
        // Layered aura — outer → inner, increasing vibrance; pointer-events:none so
        // clicks pass through to the hex tiles in the layer beneath
        const a3 = mkEl("circle", { cx: h.x, cy: h.y, r: "42", fill: pColor, opacity: "0.08",
          "pointer-events": "none" });
        const a2 = mkEl("circle", { cx: h.x, cy: h.y, r: "34", fill: pColor, opacity: "0.20",
          class: "planet-aura-pulse", "pointer-events": "none" });
        const a1 = mkEl("circle", { cx: h.x, cy: h.y, r: "26", fill: pColor, opacity: "0.40",
          "pointer-events": "none" });
        [a3, a2, a1].forEach(a => pieceLayer.appendChild(a));
        // Planet body — clickable to open detail modal
        const pg = mkEl("circle", {
          cx: h.x, cy: h.y, r: "16",
          fill: pColor, opacity: "0.92",
          stroke: "rgba(255,255,255,0.7)", "stroke-width": "1.5",
          class: "planet-clickable",
        });
        const _pd = h.planet, _pl = h.label;
        pg.addEventListener("click", (e) => {
          e.stopPropagation();
          openPlanetModal(_pd, pColor, _pl);
        });
        pieceLayer.appendChild(pg);
      } else if (h.label) {
        const lbl = mkEl("text", {
          x: h.x, y: h.y + 4,
          "text-anchor": "middle", "font-size": "7", "font-weight": "bold",
          fill: h.type === "black_hole" ? "#b39ddb" : "rgba(0,0,0,0.6)",
        });
        lbl.textContent = `CORE ${h.label}`;
        labelLayer.appendChild(lbl);
      }
    }

    if (h.tri) {
      drawTriangles(pieceLayer, h);
      if (claimedClusters.has(h.cluster)) drawTriCounters(labelLayer, h);
    }
  }

  drawWormholeLines(wormholeLayer, hexes, hexById);
  drawBoardPieces(pieceLayer, hexes, state.players);

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
    { color: "#3e8fba", label: "Orbital" },
    { color: "#b8dcb8", label: "Battle station slot" },
    { color: "#baaad8", label: "Science hex" },
    { color: "#a78bfa", label: "Wormhole link", border: "#7c3aed" },
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

function renderPlacementInfo(state, infoCard) {
  const currentPlacer = state.current_placer;
  const isMyTurn = currentPlacer === myName && myRole !== "watcher";
  const remaining = (state.player_placement ?? {})[myName] ?? [];
  const nextPiece = remaining[0];

  const PIECE_DISPLAY = {
    battle_station: "Battle Station",
    frigate:        "Frigate",
    influence_token:"Influence Token",
  };

  if (myRole === "watcher") {
    const placer = (state.players ?? []).find(p => p.name === currentPlacer);
    const color = placer?.color ?? "var(--muted)";
    infoCard.innerHTML = `<span class="hint">Placing: <strong style="color:${color}">${currentPlacer ?? "…"}</strong></span>`;
    return;
  }

  const me = (state.players ?? []).find(p => p.name === myName);
  const color = me?.color ?? "var(--accent)";

  if (isMyTurn) {
    const instructions = nextPiece === "battle_station"
      ? "Click any hex to place your <strong>Battle Station</strong>. Your Empire Flag will be placed on the system core automatically."
      : `Click a hex in your system to place: <strong>${PIECE_DISPLAY[nextPiece] ?? nextPiece}</strong>`;

    infoCard.innerHTML = `
      <div class="player-race-card">
        <div class="race-card-header">
          <div class="race-card-badge" style="background:${color}"></div>
          <div>
            <div class="race-card-title" style="color:${color}">${me?.race_name ?? ""}</div>
            <div class="race-card-player">Your turn to place</div>
          </div>
        </div>
        <div class="piece-grid mt1">${instructions}</div>
      </div>`;
  } else {
    const placer = (state.players ?? []).find(p => p.name === currentPlacer);
    const placerColor = placer?.color ?? "var(--muted)";
    infoCard.innerHTML = `
      <div class="player-race-card">
        <div class="race-card-header">
          <div class="race-card-badge" style="background:${color}"></div>
          <div>
            <div class="race-card-title" style="color:${color}">${me?.race_name ?? ""}</div>
            <div class="race-card-player">${me?.name ?? myName}</div>
          </div>
        </div>
        <div class="piece-grid mt1 hint">Waiting for <strong style="color:${placerColor}">${currentPlacer}</strong> to place their pieces…</div>
      </div>`;
  }
}

// ── Toggle / pan helpers ───────────────────────────────────────────────────

function setViewMode(mode) {
  viewMode = mode;
  const mapEl  = $("board-wrap");
  const cardEl = $("board-card-view");
  const legend = $("board-legend");
  const btn    = $("btn-toggle-view");
  if (mode === "map") {
    mapEl.classList.remove("hidden");
    legend.classList.remove("hidden");
    cardEl.classList.add("hidden");
    if (btn) btn.textContent = "☰ Player Card";
  } else {
    mapEl.classList.add("hidden");
    legend.classList.add("hidden");
    cardEl.classList.remove("hidden");
    if (btn) btn.textContent = "☰ Map";
  }
}

const TECH_COLS = [
  { key: "biology",     label: "Biology &<br>Chemistry" },
  { key: "physics",     label: "Physics" },
  { key: "engineering", label: "Engineering" },
  { key: "government",  label: "Government" },
];

const TECH_NAMES = {
  biology:     ["Hydroponic Farm HTTP", "Terraforming", "Soil Enrichment Facility TCP", "Advanced Terraforming", "UDP"],
  physics:     ["Research Laboratory HTTP", "Shared Memories +1 Unrest", "Astro University TCP", "Advanced Database", "UDP"],
  engineering: ["Automated Factory HTTP", "Jump Drive", "Organic Reprocessing TCP +1 Unrest", "Advanced Jump Drive", "UDP"],
  government:  ["Mental Overseers HTTP +1 Unrest", "Better Diplomats", "Chosen Birthers TCP +1 Unrest", "Superior Diplomats", "UDP"],
};

const TECH_COSTS = [
  { res: 2, vp: 0 },
  { res: 3, vp: 0 },
  { res: 4, vp: 1 },
  { res: 5, vp: 0 },
  { res: 6, vp: 2 },
];

const _ICON_RES = `<img src="icons/research.svg" class="icon-res" alt="research">`;
const _ICON_VP  = `<img src="icons/vp.svg" class="icon-vp" alt="VP">`;

const ACTION_CARDS = [
  {
    id: "base1", name: "Base Actions I", rate: "33%", rateClass: "act-tier1",
    actions: [
      { name: "Growth",       icon: "icons/act_growth.svg",       desc: "Grow your population in a system you control." },
      { name: "Research",     icon: "icons/act_research.svg",     desc: "Draw 1 tech card immediately." },
      { name: "Construction", icon: "icons/act_construction.svg", desc: "Place 1 piece in a system you control." },
      { name: "Diplomacy",    icon: "icons/act_diplomacy.svg",    desc: "Broker a trade or alliance with another player." },
    ],
  },
  {
    id: "base2", name: "Base Actions II", rate: "66%", rateClass: "act-tier2",
    actions: [
      { name: "Flight",      icon: "icons/act_flight.svg",      desc: "Move any of your ships to an adjacent system." },
      { name: "Attack",      icon: "icons/act_attack.svg",      desc: "Initiate combat with enemy pieces in a system." },
      { name: "Invasion",    icon: "icons/act_invasion.svg",    desc: "Launch an assault to capture an enemy system." },
      { name: "Exploration", icon: "icons/act_exploration.svg", desc: "Scout an unoccupied system and reveal its contents." },
    ],
  },
];

// ── Empire card data ────────────────────────────────────────────────────────
const EMPIRE_CARD_DATA = {
  empire_vorrkai:       { name: "War Directive",       effect: "In combat, add +1 to all your attack rolls this round." },
  empire_nexari:        { name: "Data Network",         effect: "Draw 1 additional tech card when performing Research." },
  empire_luminae:       { name: "Radiant Presence",     effect: "Spend 1 science to prevent 1 combat hit against your ships." },
  empire_thornveld:     { name: "Overgrowth Protocol",  effect: "Gain +2 food when performing the Growth action." },
  empire_obsidian_pact: { name: "Pact of Dominion",     effect: "Once per round, force one opponent to discard 1 card of your choice." },
  empire_dust_runners:  { name: "Salvage Rights",       effect: "After Exploration, gain 1 money for each unowned system scouted." },
};

// ── Draft overlay ───────────────────────────────────────────────────────────
function initDraftOverlay() {
  const el = document.createElement("div");
  el.id = "draft-overlay";
  el.className = "draft-overlay hidden";
  el.innerHTML = `
    <div class="draft-modal">
      <div class="draft-header">
        <div class="draft-phase-label">Draft Phase</div>
        <div class="draft-subtitle">Your starting hand</div>
      </div>
      <div class="draft-sections" id="draft-sections"></div>
      <div class="draft-footer" id="draft-footer"></div>
    </div>`;
  document.body.appendChild(el);
}

function showDraftOverlay(state) {
  const overlay = document.getElementById("draft-overlay");
  if (!overlay) return;
  overlay.classList.remove("hidden");

  const me = (state.players ?? []).find(p => p.name === myName);
  const actionCards = me?.action_cards ?? [];
  const techCards   = me?.tech_cards   ?? [];

  const base1 = actionCards.filter(id => id === "base1").length;
  const base2 = actionCards.filter(id => id === "base2").length;
  const empId = actionCards.find(id => id.startsWith("empire_"));
  const empData = empId ? EMPIRE_CARD_DATA[empId] : null;

  const rows = [];
  if (base1 > 0) rows.push(`<div class="draft-row"><span class="draft-qty">${base1}×</span><span class="draft-name act-tier1">Base Actions I</span></div>`);
  if (base2 > 0) rows.push(`<div class="draft-row"><span class="draft-qty">${base2}×</span><span class="draft-name act-tier2">Base Actions II</span></div>`);
  if (empData)   rows.push(`<div class="draft-row"><span class="draft-qty">1×</span><span class="draft-name draft-empire">${empData.name}</span><span class="draft-tag">Empire</span></div>`);
  for (const id of techCards) {
    const c = TECH_CARD_DATA[id];
    rows.push(`<div class="draft-row"><span class="draft-qty">1×</span><span class="draft-name">${c?.name ?? id}</span><span class="draft-tag">Tech</span></div>`);
  }

  document.getElementById("draft-sections").innerHTML =
    rows.join("") || `<div class="hint">No cards dealt.</div>`;

  const footer = document.getElementById("draft-footer");
  if (myRole === "host") {
    footer.innerHTML = `<button class="btn btn-primary" id="btn-begin-action" style="width:100%">Begin Action Phase →</button>`;
    document.getElementById("btn-begin-action").addEventListener("click", () => send({ type: "begin_action" }));
  } else {
    footer.innerHTML = `<div class="hint" style="text-align:center;padding:.5rem 0">Waiting for host to begin the Action Phase…</div>`;
  }
}

function hideDraftOverlay() {
  const overlay = document.getElementById("draft-overlay");
  if (overlay) overlay.classList.add("hidden");
}

// ── Card Viewer ─────────────────────────────────────────────────────────────
let _cvIdx   = 0;
let _cvCards = [];   // unified hand built in renderPlayerCard

function initCardViewer() {
  const el = document.createElement("div");
  el.id = "card-viewer";
  el.className = "card-viewer hidden";
  el.innerHTML = `
    <button class="card-viewer-close" id="btn-cv-close">✕</button>
    <div class="card-viewer-card" id="cv-card"></div>
    <div class="card-viewer-nav">
      <button class="card-nav-btn" id="btn-cv-prev">‹</button>
      <div class="card-nav-dots" id="cv-dots"></div>
      <button class="card-nav-btn" id="btn-cv-next">›</button>
    </div>
    `;
  document.body.appendChild(el);

  document.getElementById("btn-cv-close").addEventListener("click", closeCardViewer);
  document.getElementById("btn-cv-prev").addEventListener("click",  () => cvShow(_cvIdx - 1));
  document.getElementById("btn-cv-next").addEventListener("click",  () => cvShow(_cvIdx + 1));
  el.addEventListener("click", e => { if (e.target === el) closeCardViewer(); });

  // Swipe support
  const cardEl = document.getElementById("cv-card");
  let startX = 0;
  cardEl.addEventListener("pointerdown", e => { startX = e.clientX; });
  cardEl.addEventListener("pointerup",   e => {
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 40) cvShow(_cvIdx + (dx < 0 ? 1 : -1));
  });
}

function openCardViewer() {
  _cvIdx = 0;
  document.getElementById("card-viewer").classList.remove("hidden");
  cvRender();
}

function closeCardViewer() {
  document.getElementById("card-viewer").classList.add("hidden");
}

function cvShow(idx) {
  _cvIdx = Math.max(0, Math.min(idx, _cvCards.length - 1));
  cvRender();
}

function cvMoveCard(dir) {
  const target = _cvIdx + dir;
  if (target < 0 || target >= _cvCards.length) return;
  [_cvCards[_cvIdx], _cvCards[target]] = [_cvCards[target], _cvCards[_cvIdx]];
  _cvIdx = target;
  cvRender();
}

function cvRender() {
  const c = _cvCards[_cvIdx];
  if (!c) return;

  let inner = "";
  if (c.type === "action") {
    inner = `
      <div class="cv-card-header">
        <span class="cv-card-title">${c.name}</span>
      </div>
      <div class="cv-action-list">
        ${c.actions.map(a => `
          <div class="cv-action-row">
            <img class="cv-action-icon-sm" src="${a.icon}" alt="${a.name}">
            <span class="cv-action-label">${a.name.toUpperCase()}</span>
          </div>`).join("")}
      </div>`;
  } else if (c.type === "empire") {
    inner = `
      <div class="cv-card-header">
        <span class="cv-card-title">${c.name}</span>
        <span class="cv-card-empire-badge">Empire</span>
      </div>
      <div class="cv-card-effect">${c.effect}</div>`;
  } else {
    inner = `
      <div class="cv-card-header">
        <span class="cv-card-title">${c.name}</span>
        <span class="cv-card-timing">${c.timing}</span>
      </div>
      <div class="cv-card-effect">${c.effect}</div>`;
  }

  document.getElementById("cv-card").innerHTML = inner;
  document.getElementById("cv-dots").innerHTML = _cvCards.map((_, i) =>
    `<span class="cv-dot${i === _cvIdx ? " active" : ""}"></span>`
  ).join("");
}

const TECH_CARD_DATA = {
  fungal_farms:           { name: "Fungal Farms",           timing: "Your Turn",          effect: "Spend 1 money to perform a +1 person. This increases resource production by 1." },
  titanium_armor:         { name: "Titanium Armor",         timing: "After Combat Roll",   effect: "Re-roll up to 1 enemy die. You can only have one developed armor tech." },
  nuclear_missile:        { name: "Nuclear Missile",        timing: "Combat",              effect: "+1 additional dice roll for combat." },
  biotechnology:          { name: "Biotechnology",          timing: "Before +1 Person",    effect: "Spend 1 money to gain 2 food." },
  death_spores:           { name: "Death Spores",           timing: "Invasion — Start",    effect: "Gain 1 die in the invasion roll and remove 1 person from the defending system." },
  molecular_manipulation: { name: "Molecular Manipulation", timing: "During +Person",      effect: "Create a new person in a system you own with a battle station. Costs 1 food less (minimum 1)." },
};

const RESOURCE_ICONS = {
  food:    `<img src="icons/food.svg"     class="icon-food"  alt="food">`,
  science: `<img src="icons/research.svg" class="icon-res"   alt="science">`,
  tool:    `<img src="icons/tool.svg"     class="icon-tool"  alt="tool">`,
  money:   `<img src="icons/money.svg"    class="icon-money" alt="money">`,
};

function renderFullPlayerCard(state) {
  const cardEl = $("board-card-view");
  const me = (state.players ?? []).find(p => p.name === myName);
  if (!me || !me.race) { cardEl.innerHTML = `<strong>${myName}</strong>`; return; }

  const resources = me.resources ?? {};
  const income    = me.income    ?? {};
  const tech      = me.tech      ?? {};
  const pieces    = me.pieces    ?? {};
  const sys = (state.player_system ?? {})[myName];
  const sysLabel = sys !== null && sys !== undefined ? `System ${sys}` : "No system";

  const RES_KEYS = ["food", "science", "tool", "money"];

  // Resources row
  const resHtml = RES_KEYS.map(r => `
    <div class="resource-item">
      ${RESOURCE_ICONS[r] ?? ""}
      <span class="resource-label">${r}</span>
      <span class="resource-count">${resources[r] ?? 0}</span>
    </div>`).join("");

  // Compute upkeep from tri hexes in systems where player has empire_flag
  const board = state.board ?? boardCache ?? [];
  const flagClusters = new Set();
  for (const h of board) {
    if ((h.pieces ?? []).some(p => p.type === "empire_flag" && p.owner === myName))
      flagClusters.add(h.cluster);
  }
  const upkeep = { food: 0, science: 0, tool: 0 };
  for (const h of board) {
    if (!h.tri || !flagClusters.has(h.cluster)) continue;
    const c = h.tri_counts ?? [];
    if (c.length >= 3) { upkeep.tool += c[0]; upkeep.food += c[1]; upkeep.science += c[2]; }
  }

  // Income row (shows per-turn income + upkeep cost)
  const incomeHtml = RES_KEYS.map(r => {
    const inc = income[r] ?? 0;
    const cost = upkeep[r] ?? 0;
    const net = inc - cost;
    const sign = net >= 0 ? "+" : "";
    const netClass = net < 0 ? "income-negative" : net > 0 ? "income-count" : "income-zero";
    const upkeepBit = cost > 0 ? ` <span class="upkeep-cost">-${cost}</span>` : "";
    return `<div class="resource-item income-item">
      ${RESOURCE_ICONS[r] ?? ""}
      <span class="resource-label">${r}</span>
      <span class="resource-count ${netClass}">${sign}${net}</span>${upkeepBit}
    </div>`;
  }).join("");

  // Costs column (left of tech tree)
  const costsColHtml = `
    <div class="tech-costs-col">
      <div class="tech-costs-header"></div>
      ${TECH_COSTS.map(c => `
        <div class="tech-cost">
          <span>-${c.res}</span>${_ICON_RES}
          ${c.vp ? `<span style="margin-left:.1rem">+${c.vp}</span>${_ICON_VP}` : ""}
        </div>`).join("")}
    </div>`;

  // Tech columns
  const techColsHtml = TECH_COLS.map(col => {
    const levels = tech[col.key] ?? [false,false,false,false,false];
    const names  = TECH_NAMES[col.key] ?? [];
    const lvls = levels.map((on, i) => `
      <div class="tech-level${on ? " unlocked" : ""}" data-tkey="${col.key}" data-tlvl="${i}">
        <span class="tech-lvl-label">Lv ${i + 1}</span>
        <span class="tech-name">${names[i] ?? ""}</span>
      </div>`).join("");
    return `<div class="tech-col">
      <div class="tech-col-header">${col.label}</div>
      ${lvls}
    </div>`;
  }).join("");


  // Build unified card viewer hand (action + empire + tech)
  {
    const actionIds = me.action_cards ?? [];
    const techIds   = me.tech_cards   ?? [];
    _cvCards = [];
    const seenAction = new Set();
    for (const id of actionIds) {
      if (id.startsWith("empire_") || seenAction.has(id)) continue;
      const def = ACTION_CARDS.find(c => c.id === id);
      if (def) { _cvCards.push({ type: "action", ...def }); seenAction.add(id); }
    }
    const empId = actionIds.find(id => id.startsWith("empire_"));
    if (empId) {
      const emp = EMPIRE_CARD_DATA[empId];
      if (emp) _cvCards.push({ type: "empire", id: empId, name: emp.name, effect: emp.effect });
    }
    for (const id of techIds) {
      const t = TECH_CARD_DATA[id];
      if (t) _cvCards.push({ type: "tech", id, name: t.name, timing: t.timing, effect: t.effect });
    }
  }

  // Piece inventory
  const pieceRows = Object.entries(pieces)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `<span><span class="pc">${n}</span> ${PIECE_NAMES[k] ?? k}</span>`)
    .join("");

  cardEl.innerHTML = `
    <div class="player-race-card">
      <div class="race-card-header">
        <div class="race-card-badge" style="background:${me.color};width:48px;height:48px"></div>
        <div>
          <div class="race-card-title" style="color:${me.color};font-size:1.3rem">${me.race_name}</div>
          <div class="race-card-player" style="font-size:.9rem">${me.name} — ${sysLabel}</div>
        </div>
      </div>
      <div class="resource-row mt2">${resHtml}</div>
      <div class="income-section mt2">
        <div class="income-heading">Income / Turn</div>
        <div class="resource-row">${incomeHtml}</div>
      </div>
      <div class="tech-tree mt2">${costsColHtml}${techColsHtml}</div>
      ${pieceRows ? `<div class="piece-grid mt2" style="gap:.4rem 1rem;font-size:.9rem">${pieceRows}</div>` : ""}
      <button class="btn btn-primary mt2" id="btn-view-actions" style="width:100%">View Cards</button>
    </div>`;

  // Tap to reveal tech name (one open at a time)
  cardEl.querySelectorAll(".tech-level").forEach(el => {
    el.addEventListener("click", () => {
      const open = el.classList.contains("revealed");
      cardEl.querySelectorAll(".tech-level.revealed").forEach(r => r.classList.remove("revealed"));
      if (!open) el.classList.add("revealed");
    });
  });

  const viewActionsBtn = cardEl.querySelector("#btn-view-actions");
  if (viewActionsBtn) viewActionsBtn.addEventListener("click", openCardViewer);

}

// ── Flight/Invasion route helpers ──────────────────────────────────────────

function computeFlightRoutes(hexes, fromCluster) {
  const routes = [], seen = new Set();
  for (const h of hexes) {
    if (h.cluster !== fromCluster || !h.wormhole) continue;
    const partnerId = h.wormhole_partner;
    if (partnerId == null) continue;
    const partner = hexes[partnerId];
    if (!partner) continue;
    const dest = partner.cluster;
    if (dest === fromCluster || seen.has(dest)) continue;
    seen.add(dest);
    routes.push({ from_wormhole: h.id, to_wormhole: partnerId, dest_cluster: dest });
  }
  return routes;
}

// Flight without combat: exclude clusters that have enemy frigates (use Attack for those)
function computeFlightOnlyRoutes(hexes, fromCluster) {
  return computeFlightRoutes(hexes, fromCluster).filter(r =>
    !hexes.some(h => h.cluster === r.dest_cluster
      && (h.pieces ?? []).some(p => p.type === "frigate" && p.owner !== myName))
  );
}

function computeInvasionRoutes(hexes, fromCluster) {
  return computeFlightRoutes(hexes, fromCluster).filter(r => {
    const core = hexes.find(h => h.cluster === r.dest_cluster && h.local === 0);
    return core && core.planet;
  });
}

function computeAttackRoutes(hexes, fromCluster) {
  return computeFlightRoutes(hexes, fromCluster).filter(r =>
    hexes.some(h => h.cluster === r.dest_cluster
      && (h.pieces ?? []).some(p => p.type === "frigate" && p.owner !== myName))
  );
}

// ── Invasion modal ─────────────────────────────────────────────────────────

function showInvasionPrompt(msg) {
  const overlay = document.getElementById("combat-modal");
  const board = msg.board ?? boardCache ?? [];
  const clusterLabel = board.find(h => h.cluster === msg.dest_cluster && h.local === 0)?.label ?? msg.dest_cluster;
  const planet = msg.planet ?? {};
  const techCards = (msg.tech_cards ?? []).filter(id => ["nuclear_missile", "titanium_armor"].includes(id));
  let selectedTech = null;

  const techHtml = techCards.length > 0 ? `
    <div class="combat-tech-label">Play a tech card (optional — 1 max):</div>
    <div class="combat-tech-list" id="combat-tech-list">
      ${techCards.map(id => {
        const t = TECH_CARD_DATA[id];
        return `<div class="combat-tech-item" data-id="${id}">
          <span class="combat-tech-name">${t?.name ?? id}</span>
          <span class="combat-tech-effect">${t?.effect ?? ""}</span>
        </div>`;
      }).join("")}
    </div>` : `<div class="hint" style="margin-bottom:.5rem">No combat tech cards in hand.</div>`;

  document.getElementById("combat-title").textContent = `Invade System ${clusterLabel}!`;
  document.getElementById("combat-body").innerHTML = `
    <div class="hint" style="margin-bottom:.75rem">The planet defends with <strong>3 dice</strong>. You attack with <strong>2 dice</strong>${techCards.length ? " (tech adds more)" : ""}.</div>
    <div class="combat-planet-stats">
      <span>Food +${planet.food ?? 0}</span>
      <span>Science +${planet.science ?? 0}</span>
      <span>Tool +${planet.tool ?? 0}</span>
      <span>VP +${planet.vp ?? 1}</span>
    </div>
    ${techHtml}`;
  document.getElementById("combat-footer").innerHTML =
    `<button class="btn btn-danger" id="btn-invasion-confirm" style="width:100%">Launch Invasion!</button>`;

  overlay.classList.remove("hidden");

  document.querySelectorAll(".combat-tech-item").forEach(item => {
    item.addEventListener("click", () => {
      if (selectedTech === item.dataset.id) {
        selectedTech = null; item.classList.remove("selected");
      } else {
        document.querySelectorAll(".combat-tech-item").forEach(i => i.classList.remove("selected"));
        selectedTech = item.dataset.id; item.classList.add("selected");
      }
    });
  });

  document.getElementById("btn-invasion-confirm").addEventListener("click", () => {
    overlay.classList.add("hidden");
    send({ type: "start_invasion", tech_card: selectedTech });
  });
}

function showInvasionResult(msg) {
  const overlay = document.getElementById("combat-modal");
  const won = !!msg.won;

  document.getElementById("combat-title").textContent = won ? "Invasion Successful!" : "Invasion Failed!";
  document.getElementById("combat-body").innerHTML = `
    <div class="combat-result-outcome ${won ? "win" : "lose"}">${won ? "You conquered the planet!" : "The planet repelled your attack."}</div>
    <div class="combat-dice-row">
      <div class="combat-dice-block">
        <div class="combat-dice-label">Your Attack</div>
        <div class="combat-dice-vals">${msg.atk_dice.map(d => `<span class="die">${d}</span>`).join("")} <span style="margin-left:.3rem">= <strong>${msg.atk_total}</strong></span></div>
      </div>
      <div class="combat-dice-block">
        <div class="combat-dice-label">Planet Defense (3 dice)</div>
        <div class="combat-dice-vals">${msg.planet_dice.map(d => `<span class="die">${d}</span>`).join("")} <span style="margin-left:.3rem">= <strong>${msg.planet_total}</strong></span></div>
      </div>
    </div>`;
  document.getElementById("combat-footer").innerHTML =
    `<button class="btn btn-primary" id="btn-combat-close" style="width:100%">Continue</button>`;

  overlay.classList.remove("hidden");
  document.getElementById("btn-combat-close").addEventListener("click", () => {
    overlay.classList.add("hidden");
  });
}

// ── Action picker overlay ──────────────────────────────────────────────────

function initActionPicker() {
  const el = document.createElement("div");
  el.id = "action-picker";
  el.className = "action-picker-overlay hidden";
  el.innerHTML = `
    <div class="action-picker-modal">
      <button class="action-picker-close" id="btn-ap-close">✕</button>
      <div class="action-picker-title">Choose an Action</div>
      <div class="action-pick-list" id="action-pick-list"></div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener("click", e => { if (e.target === el) el.classList.add("hidden"); });
  document.getElementById("btn-ap-close").addEventListener("click", () => el.classList.add("hidden"));
}

function showActionPicker() {
  const allActions = ACTION_CARDS.flatMap(card => card.actions);

  const list = document.getElementById("action-pick-list");
  list.innerHTML = allActions.map(a => `
    <div class="action-pick-row" data-action="${a.name.toLowerCase()}">
      <img class="cv-action-icon-sm" src="${a.icon}" alt="${a.name}">
      <span class="cv-action-label">${a.name.toUpperCase()}</span>
    </div>`).join("");

  document.getElementById("action-picker").classList.remove("hidden");

  list.querySelectorAll(".action-pick-row").forEach(row => {
    row.addEventListener("click", () => {
      const action = row.dataset.action;
      document.getElementById("action-picker").classList.add("hidden");
      if (action === "flight" || action === "invasion" || action === "attack") {
        _actionMode = { type: action };
        if (_lastState) renderBoard(_lastState, false);
      } else if (action === "construction") {
        showConstructionPicker();
      }
    });
  });
}

// ── Construction picker ────────────────────────────────────────────────────

const CONSTRUCTION_ITEMS = [
  { type: "death_star",  label: "Death Star",   cost: 100 },
  { type: "super_ship",  label: "Super Ship",   cost: 50  },
  { type: "cruise_ship", label: "Cruise Ship",  cost: 20  },
  { type: "frigate",     label: "Frigate",      cost: 20  },
  { type: "outpost",     label: "Outpost",      cost: 50  },
  { type: "battle_station", label: "Battle Station", cost: 100 },
];

function initConstructionPicker() {
  const el = document.createElement("div");
  el.id = "construction-picker";
  el.className = "action-picker-overlay hidden";
  el.innerHTML = `
    <div class="action-picker-modal">
      <button class="action-picker-close" id="btn-cp-close">✕</button>
      <div class="action-picker-title">Construction — Choose What to Build</div>
      <div class="action-pick-list" id="construction-pick-list"></div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener("click", e => { if (e.target === el) el.classList.add("hidden"); });
  document.getElementById("btn-cp-close").addEventListener("click", () => el.classList.add("hidden"));
}

function showConstructionPicker() {
  const me = (_lastState?.players ?? []).find(p => p.name === myName);
  const money = me?.resources?.money ?? 0;

  const list = document.getElementById("construction-pick-list");
  list.innerHTML = CONSTRUCTION_ITEMS.map(item => `
    <div class="action-pick-row construct-row ${money < item.cost ? "disabled" : ""}"
         data-type="${item.type}" data-cost="${item.cost}">
      <span class="cv-action-label">${item.label}</span>
      <span class="construct-cost ${money < item.cost ? "cant-afford" : ""}">${item.cost} ¤</span>
    </div>`).join("");

  document.getElementById("construction-picker").classList.remove("hidden");

  list.querySelectorAll(".construct-row:not(.disabled)").forEach(row => {
    row.addEventListener("click", () => {
      const type = row.dataset.type;
      const cost = parseInt(row.dataset.cost, 10);
      const item = CONSTRUCTION_ITEMS.find(i => i.type === type);
      document.getElementById("construction-picker").classList.add("hidden");
      _actionMode = { type: "construction" };
      _constructionPiece = { ...item };
      if (_lastState) renderBoard(_lastState, false);
    });
  });
}

// ── Combat modal ───────────────────────────────────────────────────────────

function initCombatModal() {
  const el = document.createElement("div");
  el.id = "combat-modal";
  el.className = "combat-overlay hidden";
  el.innerHTML = `
    <div class="combat-modal">
      <div class="combat-modal-title" id="combat-title"></div>
      <div class="combat-modal-body" id="combat-body"></div>
      <div class="combat-modal-footer" id="combat-footer"></div>
    </div>`;
  document.body.appendChild(el);
}

function showCombatPrompt(msg) {
  const overlay = document.getElementById("combat-modal");
  const board = msg.board ?? boardCache ?? [];
  const clusterLabel = board.find(h => h.cluster === msg.dest_cluster && h.local === 0)?.label ?? msg.dest_cluster;
  const techCards = (msg.tech_cards ?? []).filter(id => ["nuclear_missile", "titanium_armor"].includes(id));
  let selectedTech = null;

  const techHtml = techCards.length > 0 ? `
    <div class="combat-tech-label">Play a tech card (optional — 1 max):</div>
    <div class="combat-tech-list" id="combat-tech-list">
      ${techCards.map(id => {
        const t = TECH_CARD_DATA[id];
        return `<div class="combat-tech-item" data-id="${id}">
          <span class="combat-tech-name">${t?.name ?? id}</span>
          <span class="combat-tech-effect">${t?.effect ?? ""}</span>
        </div>`;
      }).join("")}
    </div>` : `<div class="hint" style="margin-bottom:.5rem">No combat tech cards in hand.</div>`;

  document.getElementById("combat-title").textContent = `Enemy frigates in System ${clusterLabel}!`;
  document.getElementById("combat-body").innerHTML = `
    <div class="hint" style="margin-bottom:.75rem">Combat is mandatory. Use a tech card to gain an advantage.</div>
    ${techHtml}`;
  document.getElementById("combat-footer").innerHTML =
    `<button class="btn btn-danger" id="btn-attack-confirm" style="width:100%">Roll Dice &amp; Attack</button>`;

  overlay.classList.remove("hidden");

  document.querySelectorAll(".combat-tech-item").forEach(item => {
    item.addEventListener("click", () => {
      if (selectedTech === item.dataset.id) {
        selectedTech = null;
        item.classList.remove("selected");
      } else {
        document.querySelectorAll(".combat-tech-item").forEach(i => i.classList.remove("selected"));
        selectedTech = item.dataset.id;
        item.classList.add("selected");
      }
    });
  });

  document.getElementById("btn-attack-confirm").addEventListener("click", () => {
    overlay.classList.add("hidden");
    send({ type: "start_combat", tech_card: selectedTech });
  });
}

function showCombatResult(msg) {
  const overlay = document.getElementById("combat-modal");
  const isWinner  = msg.winner === myName;
  const isAttacker = msg.attacker === myName;

  let outcomeText;
  if (isWinner) {
    outcomeText = isAttacker ? "Your frigates won! Enemy frigates destroyed." : "You repelled the attack! Enemy frigates destroyed.";
  } else {
    outcomeText = isAttacker ? "Defeated! All your frigates were destroyed." : "Your frigates were wiped out.";
  }

  document.getElementById("combat-title").textContent = isWinner ? "Victory!" : "Defeated!";
  document.getElementById("combat-body").innerHTML = `
    <div class="combat-result-outcome ${isWinner ? "win" : "lose"}">${outcomeText}</div>
    <div class="combat-dice-row">
      <div class="combat-dice-block">
        <div class="combat-dice-label">Attacker — ${msg.attacker}</div>
        <div class="combat-dice-vals">${msg.atk_dice.map(d => `<span class="die">${d}</span>`).join("")} <span style="margin-left:.3rem">= <strong>${msg.atk_total}</strong></span></div>
      </div>
      <div class="combat-dice-block">
        <div class="combat-dice-label">Defender — ${msg.defender}</div>
        <div class="combat-dice-vals">${msg.def_dice.map(d => `<span class="die">${d}</span>`).join("")} <span style="margin-left:.3rem">= <strong>${msg.def_total}</strong></span></div>
      </div>
    </div>`;
  document.getElementById("combat-footer").innerHTML =
    `<button class="btn btn-primary" id="btn-combat-close" style="width:100%">Continue</button>`;

  overlay.classList.remove("hidden");
  document.getElementById("btn-combat-close").addEventListener("click", () => {
    overlay.classList.add("hidden");
  });
}

// ── Planet detail modal ────────────────────────────────────────────────────

function initPlanetModal() {
  const el = document.createElement("div");
  el.id = "planet-modal";
  el.className = "planet-modal-overlay hidden";
  el.innerHTML = `
    <div class="planet-modal">
      <button id="planet-modal-close" class="planet-modal-close">✕</button>
      <h3 class="planet-modal-title" id="planet-modal-title"></h3>
      <div class="planet-display" id="planet-display">
        <div class="planet-flame-outer"></div>
        <div class="planet-flame-mid"></div>
        <div class="planet-body" id="planet-body"></div>
      </div>
      <div class="planet-stat-list" id="planet-stat-list"></div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener("click", (e) => { if (e.target === el) closePlanetModal(); });
  $("planet-modal-close").addEventListener("click", closePlanetModal);
}

function closePlanetModal() {
  $("planet-modal").classList.add("hidden");
}

// Blend a hex color toward a target rgb by factor t (0=original, 1=target)
function _blendColor(hex, tr, tg, tb, t) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgb(${Math.round(r+(tr-r)*t)},${Math.round(g+(tg-g)*t)},${Math.round(b+(tb-b)*t)})`;
}

function _planetSvg(color) {
  const ocean = _blendColor(color, 12, 36, 90, 0.55);  // blend toward deep blue
  const land  = _blendColor(color, 78, 105, 28, 0.42); // blend toward olive-green
  const land2 = _blendColor(color, 95, 120, 35, 0.35);
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" width="88" height="88" style="display:block">
    <defs>
      <clipPath id="pm-clip"><circle cx="50" cy="50" r="49"/></clipPath>
      <radialGradient id="pm-shine" cx="36%" cy="30%" r="60%">
        <stop offset="0%" stop-color="rgba(255,255,255,0.38)"/>
        <stop offset="70%" stop-color="rgba(255,255,255,0)"/>
      </radialGradient>
      <radialGradient id="pm-edge" cx="50%" cy="50%" r="50%">
        <stop offset="78%" stop-color="rgba(0,0,0,0)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,0.45)"/>
      </radialGradient>
    </defs>
    <!-- ocean -->
    <circle cx="50" cy="50" r="49" fill="${ocean}"/>
    <!-- land masses -->
    <g clip-path="url(#pm-clip)">
      <ellipse cx="34" cy="44" rx="19" ry="13" transform="rotate(-22 34 44)" fill="${land}"/>
      <ellipse cx="63" cy="55" rx="15" ry="10" transform="rotate(18 63 55)"  fill="${land}"/>
      <ellipse cx="52" cy="27" rx="11" ry="7"  transform="rotate(-8 52 27)"  fill="${land2}"/>
      <ellipse cx="22" cy="62" rx="8"  ry="6"  transform="rotate(30 22 62)"  fill="${land2}"/>
      <ellipse cx="70" cy="32" rx="7"  ry="5"  transform="rotate(-15 70 32)" fill="${land}"/>
    </g>
    <!-- polar ice caps -->
    <g clip-path="url(#pm-clip)">
      <ellipse cx="50" cy="6"  rx="16" ry="10" fill="rgba(255,255,255,0.60)"/>
      <ellipse cx="50" cy="94" rx="11" ry="7"  fill="rgba(255,255,255,0.45)"/>
    </g>
    <!-- atmosphere shine -->
    <circle cx="50" cy="50" r="49" fill="url(#pm-shine)"/>
    <!-- limb darkening -->
    <circle cx="50" cy="50" r="49" fill="url(#pm-edge)"/>
  </svg>`;
}

function openPlanetModal(planet, color, label) {
  $("planet-modal-title").textContent = `System ${label}`;

  const display = $("planet-display");
  display.style.setProperty("--pc", color);

  // Replace planet-body content with rich SVG
  const body = $("planet-body");
  body.innerHTML = _planetSvg(color);
  body.style.boxShadow = `0 0 28px ${color}, 0 0 8px rgba(0,0,0,0.6)`;

  const STAT_ROWS = [
    { icon: "icons/vp.svg",       label: "Victory Point", value: "+1" },
    { icon: "icons/unrest.svg",   label: "Unrest",        value: planet.unrest },
    { icon: "icons/food.svg",     label: "Food",          value: `+${planet.food}` },
    { icon: "icons/research.svg", label: "Science",       value: `+${planet.science}` },
    { icon: "icons/tool.svg",     label: "Tool",          value: `+${planet.tool}` },
  ];
  $("planet-stat-list").innerHTML = STAT_ROWS.map(r => `
    <div class="planet-stat-row">
      <img class="planet-stat-icon" src="${r.icon}" alt="${r.label}">
      <span class="planet-stat-label">${r.label}</span>
      <span class="planet-stat-value">${r.value}</span>
    </div>`).join("");

  $("planet-modal").classList.remove("hidden");
}

// ── Board pan / pinch-zoom ──────────────────────────────────────────────────

function initBoardPan() {
  const wrap = $("board-wrap");
  const svg  = $("board-svg");

  // ── pan state ────────────────────────────────────────────────
  let panning = false, didDrag = false, capturedId = null;
  let startX = 0, startY = 0, scrollX = 0, scrollY = 0;

  // ── pinch-zoom state ─────────────────────────────────────────
  const activePointers = new Map(); // pointerId → {x,y}
  let pinching      = false;
  let pinchStartDist = 0;
  let baseScale     = 1;   // scale at pinch start
  let currentScale  = 1;   // accumulated scale

  const BASE_W = parseInt(svg.getAttribute("width"))  || 872;
  const BASE_H = parseInt(svg.getAttribute("height")) || 800;
  const MIN_SCALE = 0.4;
  const MAX_SCALE = 3.0;

  function getPinchDist() {
    const [a, b] = [...activePointers.values()];
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  }
  function getPinchCenter() {
    const [a, b] = [...activePointers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function applyZoom(newScale, pivotClient) {
    newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
    const oldW = parseInt(svg.getAttribute("width"));
    const newW = Math.round(BASE_W * newScale);
    const newH = Math.round(BASE_H * newScale);
    const rect  = wrap.getBoundingClientRect();
    // SVG-space position of the pinch center before zoom
    const pivotSvgX = wrap.scrollLeft + pivotClient.x - rect.left;
    const pivotSvgY = wrap.scrollTop  + pivotClient.y - rect.top;
    const ratio = newW / oldW;
    svg.setAttribute("width",  newW);
    svg.setAttribute("height", newH);
    // Keep pinch center fixed in the viewport
    wrap.scrollLeft = pivotSvgX * ratio - (pivotClient.x - rect.left);
    wrap.scrollTop  = pivotSvgY * ratio - (pivotClient.y - rect.top);
    currentScale = newScale;
  }

  // ── event handlers ───────────────────────────────────────────
  wrap.addEventListener("pointerdown", (e) => {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size === 2) {
      // Switch to pinch mode; abort any active pan
      pinching       = true;
      panning        = false;
      pinchStartDist = getPinchDist();
      baseScale      = currentScale;
      if (capturedId !== null) {
        try { wrap.releasePointerCapture(capturedId); } catch (_) {}
        capturedId = null;
      }
      return;
    }

    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (pinching) return;
    panning    = true;
    didDrag    = false;
    capturedId = e.pointerId;
    startX     = e.clientX;
    startY     = e.clientY;
    scrollX    = wrap.scrollLeft;
    scrollY    = wrap.scrollTop;
  });

  wrap.addEventListener("pointermove", (e) => {
    if (activePointers.has(e.pointerId)) {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pinching && activePointers.size === 2) {
      const d = getPinchDist();
      if (pinchStartDist > 0) applyZoom(baseScale * (d / pinchStartDist), getPinchCenter());
      return;
    }

    if (!panning) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!didDrag && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      didDrag = true;
      wrap.setPointerCapture(capturedId);
      wrap.classList.add("panning");
    }
    if (didDrag) {
      wrap.scrollLeft = scrollX - dx;
      wrap.scrollTop  = scrollY - dy;
    }
  });

  const stopPointer = (e) => {
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2 && pinching) pinching = false;
    if (activePointers.size === 0) { panning = false; wrap.classList.remove("panning"); }
  };
  wrap.addEventListener("pointerup",     stopPointer);
  wrap.addEventListener("pointercancel", stopPointer);

  // Block hex-click only if we actually dragged
  wrap.addEventListener("click", (e) => {
    if (didDrag) { e.stopPropagation(); didDrag = false; }
  }, true);
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
$("watch-code-input").addEventListener("input", () => {
  const btn = $("btn-watch-submit");
  btn.className = $("watch-code-input").value.trim().length > 0
    ? "btn btn-secondary"
    : "btn btn-ghost";
});

$("btn-start-game").addEventListener("click",   () => send({ type: "start_game" }));
$("btn-confirm-race").addEventListener("click", () => send({ type: "confirm_race" }));
$("btn-roll-dice").addEventListener("click",    () => send({ type: "roll_dice" }));
$("btn-toggle-view").addEventListener("click",  () => setViewMode(viewMode === "map" ? "card" : "map"));

setInterval(() => send({ type: "ping" }), 25_000);

initBoardPan();
initCardViewer();
initDraftOverlay();
initActionPicker();
initConstructionPicker();
initCombatModal();
initPlanetModal();
