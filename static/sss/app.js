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
let boardCache = null;   // last received board data
let viewMode = "map";    // "map" | "card"
let _connectingBtn = null;
let _connectingErrId = null;

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
      if (_connectingBtn) { _connectingBtn.disabled = false; _connectingBtn.textContent = _connectingBtn.dataset.label; }
      _connectingBtn = null; _connectingErrId = null;
      break;
    case "place_pieces_start":
    case "game_state":
    case "board_ready":
    case "player_disconnected":
      if (msg.board) boardCache = msg.board;
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
    case "lobby":        showScreen("screen-lobby");      renderLobby(state);         break;
    case "race_pick":    showScreen("screen-race-pick");  renderRacePick(state);      break;
    case "dice_roll":    showScreen("screen-dice-roll");  renderDiceRoll(state);      break;
    case "place_pieces": showScreen("screen-board");      renderBoard(state, true);   break;
    case "board":        showScreen("screen-board");      renderBoard(state, false);  break;
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
    if (placed >= 0) {
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

function drawTriCounters(layer, h) {
  const svgNS = "http://www.w3.org/2000/svg";
  const r = 7;
  for (const { dx, dy } of TRI_CONFIGS) {
    const tx = h.x + dx * r;
    const ty = h.y + dy * r;
    const t = document.createElementNS(svgNS, "text");
    t.setAttribute("x", tx);
    t.setAttribute("y", ty + 1.8);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", "5");
    t.setAttribute("font-weight", "bold");
    t.setAttribute("fill", "rgba(0,0,0,0.8)");
    t.textContent = "1";
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
  const inR = R * Math.sqrt(3) / 2;  // inradius: center → edge midpoint ≈ 20.78
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

    // Line endpoints at hex boundaries (not centers)
    const x1 = h.x + ux * inR,       y1 = h.y + uy * inR;
    const x2 = partner.x - ux * inR, y2 = partner.y - uy * inR;

    const glow = document.createElementNS(svgNS, "line");
    glow.setAttribute("x1", x1); glow.setAttribute("y1", y1);
    glow.setAttribute("x2", x2); glow.setAttribute("y2", y2);
    glow.setAttribute("stroke", "#7c3aed");
    glow.setAttribute("stroke-width", "5");
    glow.setAttribute("stroke-dasharray", "5 4");
    glow.setAttribute("opacity", "0.3");
    wormholeLayer.appendChild(glow);

    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", x1); line.setAttribute("y1", y1);
    line.setAttribute("x2", x2); line.setAttribute("y2", y2);
    line.setAttribute("stroke", "#a78bfa");
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
      } else {
        const r = piece.type === "battle_station" ? 7 : 4.5;
        pieceLayer.appendChild(mk("circle", {
          cx, cy, r,
          fill: c, opacity: "0.85",
          stroke: "rgba(255,255,255,0.4)", "stroke-width": "0.8",
        }));
        if (piece.type === "battle_station") {
          pieceLayer.appendChild(mk("line", {
            x1: cx - 3.5, y1: cy, x2: cx + 3.5, y2: cy,
            stroke: "rgba(0,0,0,0.5)", "stroke-width": "1.5",
          }));
          pieceLayer.appendChild(mk("line", {
            x1: cx, y1: cy - 3.5, x2: cx, y2: cy + 3.5,
            stroke: "rgba(0,0,0,0.5)", "stroke-width": "1.5",
          }));
        }
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
    svg.setAttribute("viewBox", "140 80 550 610");
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
  hexLayer.innerHTML      = "";
  wormholeLayer.innerHTML = "";
  pieceLayer.innerHTML    = "";
  labelLayer.innerHTML    = "";

  const hexes = (state.board ?? boardCache ?? []);
  const hexById = {};
  for (const h of hexes) hexById[h.id] = h;

  // Placement validity helpers
  const mySystem    = (state.player_system ?? {})[myName] ?? null;
  const myRemaining = (state.player_placement ?? {})[myName] ?? [];
  const isMyTurn    = placementMode && state.current_placer === myName && myRole !== "watcher";
  const nextPiece   = myRemaining[0];
  // Clusters already claimed by other players (can't place battle station there)
  const claimedByOthers = new Set(
    Object.entries(state.player_system ?? {})
      .filter(([n]) => n !== myName)
      .map(([, c]) => c)
  );
  // Core hex type per cluster (used to exclude black hole from battle station targets)
  const coreType = {};
  for (const h of hexes) { if (h.local === 0) coreType[h.cluster] = h.type; }
  // Clusters that contain a tri hex (only these allow battle station placement)
  const triClusters = new Set();
  for (const h of hexes) { if (h.tri) triClusters.add(h.cluster); }
  // Clusters already claimed by any player (for tri counter display)
  const claimedClusters = new Set(Object.values(state.player_system ?? {}));
  // Orbital locals blocked because they're ring-adjacent to an existing frigate
  const blockedOrbitalLocals = new Set();
  if (isMyTurn && nextPiece === "frigate" && mySystem !== null) {
    for (const bh of hexes) {
      if (bh.cluster !== mySystem) continue;
      if (bh.pieces.some(p => p.type === "frigate")) {
        const i = bh.local;
        blockedOrbitalLocals.add((i - 2) % 6 + 1);
        blockedOrbitalLocals.add(i % 6 + 1);
      }
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
        validTarget = h.type === "orbital" && h.cluster === mySystem
                      && !blockedOrbitalLocals.has(h.local);
      } else if (nextPiece === "influence_token") {
        validTarget = h.cluster === mySystem
                      && !h.pieces.some(p => p.type === "influence_token");
      }
    }

    let cls = `hex-poly hex-${h.type}`;
    if (validTarget) cls += " hex-placeable";
    poly.setAttribute("class", cls);
    poly.setAttribute("data-id", h.id);
    if (validTarget) {
      poly.style.cursor = "pointer";
      poly.addEventListener("click", () => send({ type: "place_piece", hex_id: h.id }));
    }
    hexLayer.appendChild(poly);

    // Cluster label on core hex
    if (h.local === 0 && h.label) {
      const lbl = mkEl("text", {
        x: h.x, y: h.y + 4,
        "text-anchor": "middle", "font-size": "7", "font-weight": "bold",
        fill: h.type === "black_hole" ? "#b39ddb" : "rgba(0,0,0,0.6)",
      });
      lbl.textContent = `CORE ${h.label}`;
      labelLayer.appendChild(lbl);
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
    { color: "#3e8fba", label: "Orbital — frigates only" },
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
        <div class="mt2">
          <button class="btn btn-ghost" id="btn-done-placing-inline" style="font-size:.85rem">Skip remaining</button>
        </div>
      </div>`;
    $("btn-done-placing-inline")?.addEventListener("click", () => send({ type: "done_placing" }));
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

  // Income row
  const incomeHtml = RES_KEYS.map(r => `
    <div class="resource-item income-item">
      ${RESOURCE_ICONS[r] ?? ""}
      <span class="resource-label">${r}</span>
      <span class="resource-count income-count">+${income[r] ?? 0}</span>
    </div>`).join("");

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

  // Tech card hand
  const myTechCards = me.tech_cards ?? [];
  const techCardListHtml = myTechCards.length === 0
    ? `<div class="hint">No tech cards yet.</div>`
    : myTechCards.map(id => {
        const c = TECH_CARD_DATA[id];
        if (!c) return "";
        return `<div class="tech-card">
          <div class="tech-card-header">
            <span class="tech-card-name">${c.name}</span>
            <span class="tech-card-timing">${c.timing}</span>
          </div>
          <div class="tech-card-effect">${c.effect}</div>
        </div>`;
      }).join("");

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
      <div class="tech-cards-section mt2">
        <div class="tech-cards-heading">Tech Cards</div>
        <div class="tech-card-list">${techCardListHtml}</div>
        <button class="btn btn-secondary mt1" id="btn-draw-tech" style="width:100%">Draw Tech Card</button>
      </div>
    </div>`;

  // Tap to reveal tech name (one open at a time)
  cardEl.querySelectorAll(".tech-level").forEach(el => {
    el.addEventListener("click", () => {
      const open = el.classList.contains("revealed");
      cardEl.querySelectorAll(".tech-level.revealed").forEach(r => r.classList.remove("revealed"));
      if (!open) el.classList.add("revealed");
    });
  });

  const drawBtn = cardEl.querySelector("#btn-draw-tech");
  if (drawBtn) {
    drawBtn.addEventListener("click", () => {
      ws.send(JSON.stringify({ type: "draw_tech_card" }));
    });
  }
}

function initBoardPan() {
  const wrap = $("board-wrap");
  let panning = false, didDrag = false, capturedId = null;
  let startX = 0, startY = 0, scrollX = 0, scrollY = 0;

  wrap.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    panning    = true;
    didDrag    = false;
    capturedId = e.pointerId;
    startX     = e.clientX;
    startY     = e.clientY;
    scrollX    = wrap.scrollLeft;
    scrollY    = wrap.scrollTop;
    // Do NOT call setPointerCapture here — that would reroute the click
    // event away from child hex polygons for simple taps/clicks.
  });

  wrap.addEventListener("pointermove", (e) => {
    if (!panning) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!didDrag && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      didDrag = true;
      wrap.setPointerCapture(capturedId);  // capture only once confirmed drag
      wrap.classList.add("panning");
    }
    if (didDrag) {
      wrap.scrollLeft = scrollX - dx;
      wrap.scrollTop  = scrollY - dy;
    }
  });

  const stopPan = () => { panning = false; wrap.classList.remove("panning"); };
  wrap.addEventListener("pointerup",     stopPan);
  wrap.addEventListener("pointercancel", stopPan);

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
