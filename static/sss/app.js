/* Secret Space Society — game client */
"use strict";

// ── Constants ──────────────────────────────────────────────────────────────

// All ships that can fly (cruise_ship included — 2-jump repositioning)
const MOBILE_SHIPS = new Set(["scout", "cruise_ship", "super_ship", "death_star"]);
// Ships that can initiate attacks and invasions (cruise_ship is defense-only)
const ATTACK_SHIPS = new Set(["scout", "super_ship", "death_star"]);

const RACES = {
  vorrkai:       { name: "Vorrkai",       color: "#e74c3c" },
  nexari:        { name: "Nexari",        color: "#1a5fa8" },
  luminae:       { name: "Luminae",       color: "#ff69b4" },
  thornveld:     { name: "Thornveld",     color: "#27ae60" },
  obsidian_pact: { name: "Obsidian Pact", color: "#e8ff00" },
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
let _prevBoardState  = null;  // last board snapshot for opponent move detection
let _animRunning      = false;  // true while any ship animation batch is in progress
let _animQueue        = [];     // {moves, oldBoard, state}[] — pending animation batches
let _animLatestState  = null;   // most recent state received while animation was running
let _activeAnimCount  = 0;      // how many animation batches are currently running in parallel
let _actionMode      = null;  // { type: "flight"|"invasion"|"attack"|"construction" }
let _selectedCluster = null;  // cluster index of selected source, or null
let _selectedRoutes  = [];    // routes from _selectedCluster
let _constructionPiece = null; // { type, cost } when in construction placement mode
let _pendingScienceHex = null; // hex_id of science tile clicked directly (skips general re-render)
let _lastState       = null;  // most recent full state for re-renders
let _revealedTech    = null;  // { tkey, tlvl } — expanded tech row; kept across state updates
let _hexHandlers     = new Map();  // hex_id → click handler; populated each renderBoard
let _hexPositions    = [];         // [{id,x,y}] for SVG-coordinate hit dispatch
let _myOwnedClusters = new Set();  // clusters owned by myName; updated each renderBoard

// ── Helpers ────────────────────────────────────────────────────────────────

function resetToLanding() {
  if (ws) { try { ws.close(); } catch (_) {} ws = null; }
  myName = ""; myRole = ""; gameCode = "";
  boardCache = null; _lastState = null;
  _actionMode = null; _selectedCluster = null; _selectedRoutes = [];
  _constructionPiece = null; _boardPhaseOpened = false; _lastStateSeq = -1;
  _animRunning = false; _animQueue = []; _animLatestState = null; _activeAnimCount = 0;
  showScreen("screen-landing");
  setWsStatus(false);
}

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

  ws.onclose = (_ev) => {
    setWsStatus(false);
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
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
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
      if (msg.board) { detectOpponentMoves(msg.board, msg); boardCache = msg.board; }
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
      if (msg.board) { detectOpponentMoves(msg.board, msg); boardCache = msg.board; }
      _lastState = msg;
      applyState(msg);
      showInvasionResult(msg);
      if (msg.attacker !== myName) {
        const clbl = (boardCache ?? []).find(h => h.cluster === msg.cluster && h.local === 0)?.label ?? msg.cluster;
        const col  = (msg.players ?? _lastState?.players ?? []).find(p => p.name === msg.attacker)?.color;
        showToast(msg.won ? `${msg.attacker} captured <strong>${clbl}</strong>!` : `${msg.attacker} failed to take <strong>${clbl}</strong>`, col);
      }
      break;
    case "combat_prompt":
      if (msg.board) { detectOpponentMoves(msg.board, msg); boardCache = msg.board; }
      _lastState = msg;
      applyState(msg);
      showCombatPrompt(msg, true);
      break;
    case "combat_defender_prompt":
      if (msg.board) { detectOpponentMoves(msg.board, msg); boardCache = msg.board; }
      _lastState = msg;
      applyState(msg);
      showCombatPrompt(msg, false);
      break;
    case "combat_attacker_rolled":
      showCombatAttackerRolled(msg);
      break;
    case "combat_result":
      if (msg.seq !== undefined && msg.seq <= _lastStateSeq) break;
      if (msg.seq !== undefined) _lastStateSeq = msg.seq;
      if (msg.board) { detectOpponentMoves(msg.board, msg); boardCache = msg.board; }
      _lastState = msg;
      applyState(msg);
      showCombatResult(msg);
      break;
    case "bonus_tech_drawn":
      showBonusTechToast(msg.cards);
      break;
    case "eliminated":
      showEliminatedOverlay(msg.msg);
      break;
    case "race_taken":
      showError("race-error", "That race was just taken — pick another.");
      break;
    case "error":
      console.error("[SSS server error]", msg.msg);
      routeError(msg.msg);
      break;
  }
  if (msg.game_over) showGameOver(msg.game_over);
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
  if (errId) { showError(errId, msg); return; }
  if (active.id === "screen-board") showBoardToast(msg);
}

function showBonusTechToast(cards) {
  if (!cards || !cards.length) return;
  const n = cards.length;
  const names = cards.map(c => `<strong>${c.name}</strong>`).join(", ");
  let el = document.getElementById("bonus-tech-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "bonus-tech-toast";
    el.style.cssText = "position:fixed;top:80px;right:12px;background:#0f2a1a;border:1px solid #4ade80;color:#bbf7d0;padding:.65rem 1.25rem;border-radius:10px;font-size:.85rem;z-index:2001;max-width:340px;text-align:left;line-height:1.5";
    document.body.appendChild(el);
  }
  el.innerHTML = `<div style="font-weight:700;margin-bottom:.2rem;color:#4ade80">+${n} Tech Card${n > 1 ? "s" : ""} (unused actions)</div>${names}`;
  el.style.display = "block";
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = "none"; }, 7000);
}

function showBoardToast(msg) {
  let toast = document.getElementById("board-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "board-toast";
    toast.style.cssText = "position:fixed;top:60px;left:50%;transform:translateX(-50%);background:#7f1d1d;color:#fca5a5;padding:.5rem 1.25rem;border-radius:8px;font-size:.85rem;font-weight:600;z-index:2000;pointer-events:none";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.display = "none"; }, 4000);
}

function showEliminatedOverlay(message) {
  let el = document.getElementById("eliminated-overlay");
  if (!el) {
    el = document.createElement("div");
    el.id = "eliminated-overlay";
    el.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#00000099;z-index:3000";
    document.body.appendChild(el);
  }
  el.innerHTML = `<div style="background:#0f1623;border:2px solid #ef4444;border-radius:16px;padding:2rem 2.5rem;text-align:center;max-width:360px">
    <div style="font-size:2.5rem">💀</div>
    <div style="font-size:1.35rem;font-weight:800;color:#ef4444;margin:.5rem 0">Eliminated</div>
    <div style="color:#e2e8f0;margin-bottom:1rem">${message}</div>
    <button onclick="this.closest('#eliminated-overlay').remove()" style="background:#ef4444;color:#fff;border:none;border-radius:8px;padding:.5rem 1.5rem;font-weight:700;cursor:pointer;font-size:.9rem">Close</button>
  </div>`;
  el.style.display = "flex";
}

const _SHIP_LABELS = {
  frigate: "Scout", cruise_ship: "Cruise Ship", outpost: "Outpost",
  super_ship: "Super Ship", battle_station: "Battle Station", death_star: "Death Star",
};
const _BLDG_LABELS = {
  building_tool: "Tool Factory", building_science: "Lab", building_money: "Bank", farmer_upgrade: "Farmer Upgrade",
};
const _TECH_LABELS = {
  military: "Military", engineering: "Engineering", biology: "Biology",
  physics: "Physics", government: "Government",
};

function showGameOver(report) {
  // Support legacy string (plain winner name) or full stats object
  if (typeof report === "string") report = { winner: report, stats: {} };
  const { winner, stats } = report;

  let el = document.getElementById("game-over-overlay");
  if (!el) {
    el = document.createElement("div");
    el.id = "game-over-overlay";
    el.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#000000bb;z-index:3000;padding:1rem;overflow-y:auto";
    document.body.appendChild(el);
  }

  const playerNames = Object.keys(stats).sort((a, b) => {
    if (a === winner) return -1;
    if (b === winner) return 1;
    return (stats[b].vp || 0) - (stats[a].vp || 0);
  });

  const playerCards = playerNames.map(name => {
    const s = stats[name] || {};
    const isWinner = name === winner;
    const isMe = name === myName;
    const color = s.color || "#888";

    const planetsHtml = s.planets?.length
      ? s.planets.map(p => `<span class="go-tag">${p}</span>`).join("")
      : `<span style="color:var(--muted);font-size:.8rem">none</span>`;

    const shipsBuiltEntries = Object.entries(s.ships_built || {}).filter(([t, n]) => n > 0 && t in _SHIP_LABELS);
    const shipsBuiltHtml = shipsBuiltEntries.length
      ? shipsBuiltEntries.map(([t, n]) => `<span class="go-tag">${n}× ${_SHIP_LABELS[t] ?? t}</span>`).join("")
      : `<span style="color:var(--muted);font-size:.8rem">none</span>`;

    const shipsOnEntries = Object.entries(s.ships_on_board || {}).filter(([,n]) => n > 0);
    const shipsOnHtml = shipsOnEntries.length
      ? shipsOnEntries.map(([t, n]) => `<span class="go-tag">${n}× ${_SHIP_LABELS[t] ?? t}</span>`).join("")
      : `<span style="color:var(--muted);font-size:.8rem">none</span>`;

    const bldgEntries = Object.entries(s.buildings || {}).filter(([,n]) => n > 0);
    const bldgHtml = bldgEntries.length
      ? bldgEntries.map(([t, n]) => `<span class="go-tag">${n}× ${_BLDG_LABELS[t] ?? t}</span>`).join("")
      : `<span style="color:var(--muted);font-size:.8rem">none</span>`;

    const techColHtml = Object.entries(s.tech_by_col || {})
      .filter(([,n]) => n > 0)
      .map(([col, n]) => `<span class="go-tag">${_TECH_LABELS[col] ?? col} ${n}</span>`)
      .join("") || `<span style="color:var(--muted);font-size:.8rem">none</span>`;

    return `
      <div class="go-player-card${isWinner ? " go-winner" : ""}">
        <div class="go-player-header">
          <span class="go-color-dot" style="background:${color}"></span>
          <span class="go-player-name">${name}${isMe ? " (you)" : ""}${isWinner ? " 🏆" : ""}</span>
          <span class="go-vp">${s.vp ?? 0} VP</span>
        </div>
        <div class="go-stat-grid">
          <div class="go-stat-label">Planets held</div>
          <div class="go-stat-val">${planetsHtml}</div>
          <div class="go-stat-label">Ships built</div>
          <div class="go-stat-val">${shipsBuiltHtml}</div>
          <div class="go-stat-label">Fleet (alive)</div>
          <div class="go-stat-val">${shipsOnHtml}</div>
          <div class="go-stat-label">Buildings</div>
          <div class="go-stat-val">${bldgHtml}</div>
          <div class="go-stat-label">Tech upgrades</div>
          <div class="go-stat-val">${techColHtml}</div>
          <div class="go-stat-label">Invasions won</div>
          <div class="go-stat-val">${s.invasions_won ?? 0}</div>
        </div>
      </div>`;
  }).join("");

  el.innerHTML = `
    <div class="go-modal">
      <div class="go-title">${winner === myName ? "Victory!" : "Game Over"}</div>
      <div class="go-subtitle">${winner} conquered the galaxy.</div>
      ${playerCards}
      <button class="btn btn-primary" style="margin-top:1.25rem;width:100%"
        onclick="document.getElementById('game-over-overlay').remove()">Close</button>
    </div>`;
  el.style.display = "flex";
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
    case "place_pieces":
      hideDraftOverlay(); showScreen("screen-board");
      requestAnimationFrame(() => renderBoard(state, true));
      break;
    case "draft":
      showScreen("screen-board");
      requestAnimationFrame(() => { renderBoard(state, false); if (myRole === "host") send({ type: "begin_action" }); });
      break;
    case "board":
      hideDraftOverlay(); showScreen("screen-board");
      requestAnimationFrame(() => {
        if (!_boardPhaseOpened) {
          _boardPhaseOpened = true;
          initBoardPan.resetView?.();
        }
        // Fill state into any queued animation batch that just arrived
        for (const q of _animQueue) { if (q.state === null) q.state = state; }

        if (_animRunning) {
          _animLatestState = state;  // remember latest state for final render
          _startParallelBatches();   // start any newly queued moves alongside running ones
        } else if (_animQueue.length > 0) {
          _drainAnimQueue();
        } else {
          renderBoard(state, false);
        }
      });
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
    // Color dot
    const dot = document.createElement("span");
    dot.style.cssText = `display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:.45rem;border:1px solid rgba(255,255,255,.25);flex-shrink:0;background:${p.color || "#444"};vertical-align:middle;`;
    li.appendChild(dot);
    li.appendChild(document.createTextNode(p.name + (p.role === "host" ? " (Host)" : p.role === "ai" ? " 🤖" : "")));
    if (myRole === "host" && p.role === "ai") {
      const rm = document.createElement("button");
      rm.textContent = "✕";
      rm.className = "btn-remove-ai";
      rm.style.cssText = "margin-left:.5rem;background:none;border:none;cursor:pointer;color:#ef4444;font-size:.9rem;";
      rm.addEventListener("click", () => send({ type: "remove_ai", name: p.name }));
      li.appendChild(rm);
    }
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

  // Tiebreaker label — shown when some positions are already decided
  const nextPos = turnOrder.length + 1;
  const isTiebreaker = turnOrder.length > 0 && state.phase === "dice_roll";
  const hint = document.querySelector("#screen-dice-roll .hint");
  if (hint) {
    hint.textContent = isTiebreaker
      ? `Tiebreaker — rolling for position #${nextPos}`
      : "Highest 2d6 roll goes first. Ties re-roll.";
  }

  for (const p of (state.players ?? [])) {
    const placed = turnOrder.indexOf(p.name);
    const rolling = inRound.has(p.name);
    const rolled  = p.dice_roll > 0;
    const dot = p.color ? `<span class="player-badge" style="background:${p.color};width:10px;height:10px;display:inline-block;border-radius:50%;margin-right:.5rem"></span>` : "";
    let status = "";
    if (placed >= 0 && rolled) {
      status = `<strong style="font-size:1.3rem">${p.dice_roll}</strong><span style="color:var(--gold);margin-left:.5rem">→ #${placed + 1}</span>`;
    } else if (placed >= 0) {
      status = `<span style="color:var(--gold)">→ Position ${placed + 1}</span>`;
    } else if (!rolling) {
      // Deferred — show their original score so they know why they're waiting
      status = rolled
        ? `<strong style="font-size:1.3rem">${p.dice_roll}</strong><span class="hint" style="margin-left:.4rem">waiting…</span>`
        : `<span class="hint">waiting…</span>`;
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
    // Farmer upgrade star on the BL triangle
    if (i === 1 && h.tri_farmer_green) {
      const { dx, dy } = TRI_CONFIGS[i];
      const tx = h.x + dx * r, ty = h.y + dy * r;
      const star = document.createElementNS("http://www.w3.org/2000/svg", "text");
      star.setAttribute("x", tx);
      star.setAttribute("y", ty + 2.5);
      star.setAttribute("text-anchor", "middle");
      star.setAttribute("font-size", "6");
      star.setAttribute("fill", "rgba(255,255,255,0.9)");
      star.textContent = "★";
      layer.appendChild(star);
    }
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
  frigate:        "Scout",
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
    const trim = Math.min(inR, len * 0.35);
    if (len - 2 * trim < 8) continue; // endpoints too close — skip rather than draw a stub
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
    if (h.fog) continue;  // fogged hex — no pieces rendered
    if (!h.pieces || h.pieces.length === 0) continue;
    const frigates  = h.pieces.filter(p => p.type === "scout");
    const buildings = h.pieces.filter(p => BUILDING_TYPES.has(p.type));
    const others    = h.pieces.filter(p => p.type !== "empire_flag" && p.type !== "scout" && !BUILDING_TYPES.has(p.type));

    // Buildings: pyramid of squares + smoke, centered in the hex, up to 3
    if (buildings.length > 0) {
      const slotW = 13;
      const startX = h.x - (buildings.length - 1) * slotW / 2;
      buildings.forEach((b, bi) => {
        const bx = startX + bi * slotW;
        const by = h.y + 4;
        const bColor = b.type === "building_tool"    ? "#9e6b2a"
                     : b.type === "building_science"  ? "#6040a0"
                     : "#b8900a";
        // Base row: 3 squares
        for (let i = 0; i < 3; i++)
          pieceLayer.appendChild(mk("rect", { x: bx - 4 + i * 3, y: by, width: "2.5", height: "2", fill: bColor, opacity: "0.9" }));
        // Mid row: 2 squares
        for (let i = 0; i < 2; i++)
          pieceLayer.appendChild(mk("rect", { x: bx - 2.5 + i * 3, y: by - 2.5, width: "2.5", height: "2", fill: bColor, opacity: "0.9" }));
        // Top square
        pieceLayer.appendChild(mk("rect", { x: bx - 1.25, y: by - 5, width: "2.5", height: "2", fill: bColor, opacity: "0.9" }));
        // Smoke wisps
        pieceLayer.appendChild(mk("path", { d: `M${bx - 0.5},${by - 5} q-1,-2 0,-4`, stroke: "#9ab8b0", "stroke-width": "0.8", fill: "none", opacity: "0.75" }));
        pieceLayer.appendChild(mk("path", { d: `M${bx + 1.2},${by - 5} q1,-2 0,-4`, stroke: "#9ab8b0", "stroke-width": "0.8", fill: "none", opacity: "0.75" }));
      });
    }


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

      if (piece.type === "battle_station") {
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
  closeHexInfoPanel();
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

  // Player HUD overlay (inside board-wrap)
  const infoCard = $("board-player-info");
  if (placementMode) {
    infoCard.classList.remove("hidden");
    renderPlacementInfo(state, infoCard);
  } else if (myRole === "watcher") {
    infoCard.classList.add("hidden");
  } else {
    infoCard.classList.remove("hidden");
    const me = (state.players ?? []).find(p => p.name === myName);
    if (me) {
      const currentTurn = state.current_turn ?? null;
      const isMyTurnNow = currentTurn === myName;

      const actionsLeft = state.actions_remaining ?? 3;
      let actionHtml = "";
      if (_constructionPiece) {
        const _placeTarget = _constructionPiece.type === "farmer_upgrade" ? "a farm triangle hex"
                           : BUILDING_TYPES.has(_constructionPiece.type) ? "a science hex" : "an orbital hex";
        actionHtml = `<div class="hud-hint">Place <strong>${_constructionPiece.label}</strong> on ${_placeTarget}.</div>
          <div class="hud-actions"><button class="btn btn-ghost btn-sm" id="btn-cancel-construct">Cancel</button></div>`;
      } else if (_actionMode) {
        const hint = _actionMode?.phase === "pick_hex"
          ? "Click an enemy ship tile to target it."
          : _selectedCluster !== null && _actionMode?.type === "invasion"
            ? "Click the planet to invade."
            : _selectedCluster !== null
              ? (_actionMode.type === "attack" ? "Click enemy system to attack." : "Click highlighted system to move.")
              : _actionMode.type === "invasion" ? "Click your forces, then the planet."
              : _actionMode.type === "attack"   ? "Click your ships, then the enemy system."
              : "Click your ships, then a connected system.";
        actionHtml = `<div class="hud-hint">${hint}</div>
          <div class="hud-actions"><button class="btn btn-ghost btn-sm" id="btn-cancel-action">Cancel</button></div>`;
      } else if (isMyTurnNow) {
        actionHtml = `<div class="hud-hint" style="font-size:.78rem;color:var(--muted)">Actions: ${actionsLeft} / 3 remaining</div>
          <div class="hud-actions">
            <button class="btn btn-ghost btn-sm" id="btn-end-turn">End Turn</button>
            <button class="btn btn-primary btn-sm" id="btn-play-card">Action</button>
          </div>`;
      } else if (currentTurn) {
        actionHtml = `<div class="hud-hint">${currentTurn}'s turn</div>`;
      }

      infoCard.innerHTML = `
        <div class="hud-race-row">
          <span class="hud-race-name" style="color:${me.color}">${me.name ?? myName}</span>
          <button class="btn btn-ghost hud-toggle-btn" id="btn-toggle-view">Card ▶</button>
        </div>
        ${actionHtml}`;

      // Wire dynamic buttons
      infoCard.querySelector("#btn-toggle-view")
        ?.addEventListener("click", () => setViewMode(viewMode === "map" ? "card" : "map"));
      infoCard.querySelector("#btn-cancel-construct")
        ?.addEventListener("click", () => { cancelAnimations(); _constructionPiece = null; _actionMode = null; if (_lastState) renderBoard(_lastState, false); });
      infoCard.querySelector("#btn-cancel-action")
        ?.addEventListener("click", () => { cancelAnimations(); _actionMode = null; _selectedCluster = null; _selectedRoutes = []; if (_lastState) renderBoard(_lastState, false); });
      infoCard.querySelector("#btn-end-turn")
        ?.addEventListener("click", () => send({ type: "end_turn" }));
      infoCard.querySelector("#btn-play-card")
        ?.addEventListener("click", () => showActionPicker());

      if (viewMode === "card") renderFullPlayerCard(state);
    } else {
      infoCard.innerHTML = `<div class="hud-race-row"><span class="hud-race-name">${myName}</span></div>`;
    }
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
  if (dragLayer && !_animRunning) dragLayer.innerHTML = "";

  // When an action is in progress, make upper SVG layers transparent to pointer events
  // so clicks always land on the hex polygon in hex-layer beneath them.
  const inActionMode = !placementMode && myRole !== "watcher"
    && ((_actionMode && state.current_turn === myName) || _constructionPiece);
  pieceLayer.setAttribute("pointer-events", inActionMode ? "none" : "all");
  labelLayer.setAttribute("pointer-events", inActionMode ? "none" : "all");

  const hexes = (state.board ?? boardCache ?? []);
  const hexById = {};
  _hexHandlers = new Map();
  _hexPositions = hexes.map(h => ({ id: h.id, x: h.x, y: h.y }));
  for (const h of hexes) hexById[h.id] = h;

  // Placement validity helpers
  const mySystem    = (state.player_system ?? {})[myName] ?? null;
  // All clusters the player owns: home system + any empire_flag clusters
  const myOwnedClustersSet = new Set();
  if (mySystem !== null) myOwnedClustersSet.add(mySystem);
  for (const h of hexes) {
    if ((h.pieces ?? []).some(p => p.type === "empire_flag" && p.owner === myName))
      myOwnedClustersSet.add(h.cluster);
  }
  _myOwnedClusters = myOwnedClustersSet;
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
  for (const h of hexes) { if (h.pieces?.some(p => p.type === "empire_flag")) claimedClusters.add(h.cluster); }
  const playerColorMap = {};
  for (const p of (state.players ?? [])) { if (p.name && p.color) playerColorMap[p.name] = p.color; }
  const claimedColor = {};
  for (const [pname, cluster] of Object.entries(state.player_system ?? {})) {
    if (playerColorMap[pname]) claimedColor[cluster] = playerColorMap[pname];
  }
  for (const h of hexes) {
    if (h.local !== 0) continue;
    const flag = (h.pieces ?? []).find(p => p.type === "empire_flag");
    if (flag && playerColorMap[flag.owner]) claimedColor[h.cluster] = playerColorMap[flag.owner];
  }

  // Action-mode: pre-compute selectable sources and reachable targets
  const actionSourceClusters = new Set();
  const actionTargetClusters = new Set();
  const actionRoutesMap = {};  // cluster → routes[]
  const invasionSourceClusters = new Set(); // clusters where invasion can be launched
  const invasionPlanetClusters = new Set(); // enemy planet clusters (orange hint when no ships)

  const isActionTurn = !placementMode && _actionMode
    && state.current_turn === myName && myRole !== "watcher";

  if (isActionTurn && _actionMode.type === "invasion") {
    // Clusters this player already owns (home system + any empire_flag clusters)
    const myOwnedClusters = new Set();
    const homeCluster = (state.player_system ?? {})[myName];
    if (homeCluster != null) myOwnedClusters.add(homeCluster);
    for (const h of hexes) {
      if ((h.pieces ?? []).some(p => p.type === "empire_flag" && p.owner === myName))
        myOwnedClusters.add(h.cluster);
    }

    // Always compute invasionSourceClusters (needed in both selection phases)
    const seenInv = new Set();
    for (const h of hexes) {
      if (!(h.pieces ?? []).some(p => ATTACK_SHIPS.has(p.type) && p.owner === myName)) continue;
      if (seenInv.has(h.cluster)) continue;
      seenInv.add(h.cluster);
      const core = hexes.find(c => c.cluster === h.cluster && c.local === 0);
      // Show in-system invasion even if enemies are present — server rejects with a toast to attack first
      if (core?.planet && !myOwnedClusters.has(h.cluster)) {
        invasionSourceClusters.add(h.cluster);
      }
    }

    // Mark all enemy planet clusters for the orange hint overlay
    for (const h of hexes) {
      if (h.local !== 0 || !h.planet || myOwnedClusters.has(h.cluster)) continue;
      invasionPlanetClusters.add(h.cluster);
    }

    if (_selectedCluster === null) {
      // Phase 1: highlight all valid source clusters
      for (const cluster of invasionSourceClusters) {
        actionSourceClusters.add(cluster);
        actionRoutesMap[cluster] = [];  // in-system: clicking source fires invasion_attack immediately
      }
    }
  } else if (isActionTurn) {
    if (_selectedCluster === null) {
      for (const h of hexes) {
        const shipSet = _actionMode.type === "attack" ? ATTACK_SHIPS : MOBILE_SHIPS;
        if ((h.pieces ?? []).some(p => shipSet.has(p.type) && p.owner === myName)) {
          if (actionSourceClusters.has(h.cluster)) continue;
          const routes = _actionMode.type === "attack"
            ? computeAttackRoutes(hexes, h.cluster)
            : computeFlightOnlyRoutes(hexes, h.cluster);
          if (routes.length > 0) {
            actionSourceClusters.add(h.cluster);
            actionRoutesMap[h.cluster] = routes;
          } else if (_actionMode.type === "flight") {
            // No wormhole routes — allow intra-cluster repositioning if there's room
            const hasRoom = hexes.some(oh =>
              oh.cluster === h.cluster && orbitalOpenForOwner(oh, myName)
            );
            if (hasRoom) {
              actionSourceClusters.add(h.cluster);
              actionRoutesMap[h.cluster] = [];
            }
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
        const is56p = (state.players ?? []).length >= 5;
        validTarget = h.type === "orbital"
                      && triClusters.has(h.cluster)
                      && !claimedByOthers.has(h.cluster)
                      && coreType[h.cluster] !== "black_hole"
                      && (!is56p || (h.cluster >= 13 && h.cluster <= 18));
      } else if (nextPiece === "scout") {
        const shipsHere = (h.pieces ?? []).filter(p => MOBILE_SHIPS.has(p.type)).length;
        validTarget = h.cluster === mySystem && h.type === "orbital" && shipsHere < 3;
      }
    }

    // Construction placement: highlight valid hexes for the piece being built
    const isConstructionTurn = !placementMode && _constructionPiece
      && state.current_turn === myName && myRole !== "watcher";
    const SPACECRAFT_TYPES = new Set(["cruise_ship","scout","outpost","super_ship","battle_station","death_star"]);
    let validConstructTarget = false;
    if (isConstructionTurn && myOwnedClustersSet.has(h.cluster) && h.local > 0) {
      if (_constructionPiece.type === "farmer_upgrade") {
        validConstructTarget = h.tri === true && !h.tri_farmer_green;
      } else if (BUILDING_TYPES.has(_constructionPiece.type)) {
        const existingBuildings = (h.pieces ?? []).filter(p => BUILDING_TYPES.has(p.type));
        validConstructTarget = h.type === "bs_slot" && existingBuildings.length < 3;
      } else {
        const spacecraftCount = (h.pieces ?? []).filter(p => SPACECRAFT_TYPES.has(p.type)).length;
        validConstructTarget = h.type === "orbital" && spacecraftCount < 3;
      }
    }

    let cls = `hex-poly hex-${h.type}`;
    if (h.fog) {
      poly.setAttribute("class", cls + " hex-fog");
      hexLayer.appendChild(poly);
      continue;
    }
    if (h.tri) cls += " hex-tri";
    if (validTarget) cls += " hex-placeable";

    const isSource  = isActionTurn && actionSourceClusters.has(h.cluster);
    const isTarget  = isActionTurn && actionTargetClusters.has(h.cluster) && h.type === "orbital";
    const isSelected = isActionTurn && _selectedCluster !== null && h.cluster === _selectedCluster;
    // Intra-cluster reposition: orbital in the selected cluster with room for a ship
    const isIntraTarget = isActionTurn && _actionMode?.type === "flight"
      && _selectedCluster !== null && h.cluster === _selectedCluster
      && orbitalOpenForOwner(h, myName);
    const isAttackHexTarget = isActionTurn
      && _actionMode?.phase === "pick_hex"
      && h.cluster === _actionMode.dest_cluster
      && (h.pieces ?? []).some(p => MOBILE_SHIPS.has(p.type) && p.owner !== myName);
    if (isSelected) cls += " hex-selected";
    else if (isSource) cls += " hex-selectable";
    else if (isActionTurn && _actionMode?.type === "invasion" && h.local === 0 && invasionPlanetClusters.has(h.cluster) && !actionSourceClusters.has(h.cluster)) cls += " hex-planet-target";
    if (isTarget || isIntraTarget) cls += " hex-flight-target";
    if (isAttackHexTarget) cls += " hex-attack-target";
    if (validConstructTarget) cls += " hex-construct-target";

    poly.setAttribute("class", cls);
    poly.setAttribute("data-id", h.id);

    if (validConstructTarget) {
      poly.style.cursor = "pointer";
      _hexHandlers.set(h.id, () => {
        const piece = _constructionPiece;
        _constructionPiece = null; _actionMode = null;
        send({ type: "build_piece", piece_type: piece.type, hex_id: h.id });
      });
    } else if (validTarget) {
      poly.style.cursor = "pointer";
      _hexHandlers.set(h.id, () => send({ type: "place_piece", hex_id: h.id }));
    } else if (isAttackHexTarget) {
      poly.style.cursor = "pointer";
      _hexHandlers.set(h.id, () => {
        const mode = _actionMode;
        _actionMode = null; _selectedCluster = null; _selectedRoutes = [];
        send({ type: "attack_move", from_cluster: mode.from_cluster, target_hex_id: h.id });
      });
    } else if (isTarget) {
      poly.style.cursor = "pointer";
      _hexHandlers.set(h.id, () => {
        const route = _selectedRoutes.find(r => r.dest_cluster === h.cluster);
        if (!route || !_actionMode) return;
        const type = _actionMode.type;
        const fromCluster = _selectedCluster;
        let msgToSend;
        if (type === "attack") {
          _actionMode = { type: "attack", phase: "pick_hex", from_cluster: fromCluster, dest_cluster: h.cluster };
          _selectedCluster = null; _selectedRoutes = [];
          if (_lastState) renderBoard(_lastState, false);
          return;
        } else if (type === "invasion") {
          _actionMode = null; _selectedCluster = null; _selectedRoutes = [];
          msgToSend = { type: "invasion_move", from_wormhole: route.from_wormhole, to_wormhole: route.to_wormhole, target_hex_id: h.id };
        } else {
          // Stay in flight mode — player can chain moves (-1 action each)
          _selectedCluster = null; _selectedRoutes = [];
          if (_lastState) renderBoard(_lastState, false);
          msgToSend = { type: "flight_move", from_wormhole: route.from_wormhole, to_wormhole: route.to_wormhole, target_hex_id: h.id };
        }
        send(msgToSend);
      });
    } else if (isIntraTarget) {
      poly.style.cursor = "pointer";
      _hexHandlers.set(h.id, () => {
        const cluster = _selectedCluster;
        _selectedCluster = null; _selectedRoutes = [];
        send({ type: "intra_move", cluster, target_hex_id: h.id });
      });
    } else if (isSource && _selectedCluster === null) {
      poly.style.cursor = "pointer";
      _hexHandlers.set(h.id, () => {
        const routes = actionRoutesMap[h.cluster] ?? [];
        // In-system invasion: no wormhole routes → fire immediately
        if (_actionMode?.type === "invasion" && routes.length === 0) {
          send({ type: "invasion_attack", cluster: h.cluster });
          return;
        }
        _selectedCluster = h.cluster;
        _selectedRoutes  = routes;
        if (_lastState) renderBoard(_lastState, false);
      });
    } else if (isSelected) {
      poly.style.cursor = "pointer";
      _hexHandlers.set(h.id, () => {
        _selectedCluster = null; _selectedRoutes = [];
        if (_lastState) renderBoard(_lastState, false);
      });
    } else if (!placementMode && !h.fog) {
      // Idle tap — show hex info panel
      poly.style.cursor = "pointer";
      const _capturedH = h;
      _hexHandlers.set(h.id, () => showHexInfoPanel(_capturedH));
    }

    hexLayer.appendChild(poly);

    // Fog overlay — hide everything except the hex shape itself
    if (h.fog) continue;

    // Core hex: planet if claimed, otherwise cluster label
    if (h.local === 0) {
      const pColor = claimedColor[h.cluster];
      const dwarfUnrevealed = h.planet?.dwarf
        && !h.planet.food && !h.planet.science && !h.planet.tool && !h.planet.money;
      const renderColor = dwarfUnrevealed ? null
        : pColor
        ?? (h.planet?.ancient ? "#a855f7" : null)
        ?? (h.planet?.dwarf   ? "#6b7280" : null);
      if (h.planet && renderColor) {
        const _pd = h.planet, _pl = h.label;
        const _openPlanet = (e) => { e.stopPropagation(); openPlanetModal(_pd, renderColor, _pl); };
        // All planets render identically — layered aura + body
        const a3 = mkEl("circle", { cx: h.x, cy: h.y, r: "42", fill: renderColor, opacity: "0.08",
          "pointer-events": "none" });
        const a2 = mkEl("circle", { cx: h.x, cy: h.y, r: "34", fill: renderColor, opacity: "0.20",
          class: "planet-aura-pulse", "pointer-events": "none" });
        const a1 = mkEl("circle", { cx: h.x, cy: h.y, r: "26", fill: renderColor, opacity: "0.40",
          "pointer-events": "none" });
        [a3, a2, a1].forEach(a => pieceLayer.appendChild(a));
        const pg = mkEl("circle", { cx: h.x, cy: h.y, r: "16",
          fill: renderColor, opacity: "0.92",
          stroke: "rgba(255,255,255,0.7)", "stroke-width": "1.5",
          class: "planet-clickable" });
        pg.addEventListener("click", _openPlanet);
        pg.addEventListener("touchend", (e) => { e.preventDefault(); _openPlanet(e); });
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

}

function renderPlacementInfo(state, infoCard) {
  const currentPlacer = state.current_placer;
  const isMyTurn = currentPlacer === myName && myRole !== "watcher";
  const remaining = (state.player_placement ?? {})[myName] ?? [];
  const nextPiece = remaining[0];

  const PIECE_DISPLAY = {
    battle_station: "Battle Station",
    frigate:        "Scout",
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
      ? "Click any hex to place your <strong>Battle Station</strong><br>Your Empire Flag will be placed on the system core automatically."
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
  const cardEl = $("board-card-view");
  const svg    = $("board-svg");
  const btn    = document.getElementById("btn-toggle-view");
  if (mode === "map") {
    cardEl.classList.add("hidden");
    if (svg) svg.classList.remove("hidden");
    if (btn) btn.textContent = "Card ▶";
  } else {
    cardEl.classList.remove("hidden");
    if (svg) svg.classList.add("hidden");
    if (btn) btn.textContent = "◀ Map";
    if (_lastState) renderFullPlayerCard(_lastState);
  }
}

const TECH_COLS = [
  { key: "biology",     label: "Biology &<br>Chemistry" },
  { key: "physics",     label: "Physics" },
  { key: "engineering", label: "Engineering" },
  { key: "government",  label: "Government" },
];

const TECH_NAMES = {
  biology:     ["Hydroponics", "Chemical Synthesis", "Soil Enrichment", "Organic Chemistry", "Genetic Mastery"],
  physics:     ["Ballistics", "Deflector Fields", "Plasma Cannons", "Quantum Shields", "Antimatter Weapons"],
  engineering: ["Workshop Efficiency", "Shipyard Optimization", "Advanced Metallurgy", "Modular Construction", "Orbital Expansion"],
  government:  ["Civil Order", "Expanded Senate", "Martial Command", "Pacification Bureau", "Imperial Authority"],
};

const TECH_DESCS = {
  biology: [
    { cost: "2 Science",          effect: "+1 Food / turn" },
    { cost: "3 Science",          effect: "+1 Science / turn" },
    { cost: "4 Science  +1 VP",   effect: "+2 Food / turn" },
    { cost: "5 Science",          effect: "+1 Tool / turn" },
    { cost: "6 Science  +2 VP",   effect: "+2 Science / turn" },
  ],
  physics: [
    { cost: "2 Science",          effect: "+1 attack die in ship combat" },
    { cost: "3 Science",          effect: "+1 defense die in ship combat" },
    { cost: "4 Science  +1 VP",   effect: "+1 attack die when invading planets" },
    { cost: "5 Science",          effect: "+1 more defense die in ship combat" },
    { cost: "6 Science  +2 VP",   effect: "+1 more attack die when invading planets" },
  ],
  government: [
    { cost: "2 Science",          effect: "Gain 1 less Unrest per turn" },
    { cost: "3 Science",          effect: "+1 extra action per turn" },
    { cost: "4 Science  +1 VP",   effect: "Enemy planets roll 1 fewer die when you invade" },
    { cost: "5 Science",          effect: "Gain 1 less Unrest per turn (stacks)" },
    { cost: "6 Science  +2 VP",   effect: "+1 more extra action per turn (stacks)" },
  ],
  engineering: [
    { cost: "2 Science",          effect: "Buildings cost 1 less Money" },
    { cost: "3 Science",          effect: "Ships cost 2 less Money" },
    { cost: "4 Science  +1 VP",   effect: "Ships cost 1 less Tool" },
    { cost: "5 Science",          effect: "Building slots per hex: 3 → 4" },
    { cost: "6 Science  +2 VP",   effect: "Spacecraft per orbital: 3 → 4" },
  ],
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
      { name: "Biology and Chem", icon: "icons/act_growth.svg",       desc: "Advance growth and agriculture in your colonies." },
      { name: "Physics",          icon: "icons/act_research.svg",     desc: "Draw 1 tech card immediately." },
      { name: "Engineering",      icon: "icons/act_construction.svg", desc: "Level up your engineering skill tree." },
      { name: "Diplomacy",        icon: "icons/act_diplomacy.svg",    desc: "Broker a trade or alliance with another player." },
    ],
  },
  {
    id: "base2", name: "Base Actions II", rate: "66%", rateClass: "act-tier2",
    actions: [
      { name: "Travel",      icon: "icons/act_flight.svg",      desc: "Move any of your ships to an adjacent system." },
      { name: "Attack",      icon: "icons/act_attack.svg",      desc: "Initiate combat with enemy pieces in a system." },
      { name: "Invasion",    icon: "icons/act_invasion.svg",    desc: "Launch an assault to capture an enemy system." },
      { name: "Exploration", icon: "icons/act_exploration.svg", desc: "Scout an unoccupied system and reveal its contents." },
    ],
  },
];

// Ordered action list for the picker — independent of card hand composition.
// techKey links to TECH_COLS key so showActionPicker can read the player's current level.
const PICKER_ACTIONS = [
  { id: "flight",           label: "Travel",           icon: "icons/act_flight.svg"      },
  { id: "exploration",      label: "Exploration",      icon: "icons/act_exploration.svg" },
  { id: "build_ships",      label: "Build Ships",      icon: "icons/act_flight.svg",       sub: true },
  { id: "build_buildings",  label: "Build Buildings",  icon: "icons/act_construction.svg", sub: true },
  { id: "attack",           label: "Attack",           icon: "icons/act_attack.svg"      },
  { id: "invasion",         label: "Invasion",         icon: "icons/act_invasion.svg"    },
  { id: "draw_tech_card",   label: "Draw Tech Card",   icon: "icons/act_research.svg"    },
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
    const playableIds = ["command_surge", "fungal_farms", "the_hammer", "the_corn", "for_the_science", "biotechnology"];
    const canPlay = c.type === "tech" && playableIds.includes(c.id);
    inner = `
      <div class="cv-card-header">
        <span class="cv-card-title">${c.name}</span>
        <span class="cv-card-timing">${c.timing}</span>
      </div>
      <div class="cv-card-effect">${c.effect}</div>
      ${canPlay ? `<button class="btn btn-primary btn-sm mt2" id="btn-cv-play" style="width:100%;margin-top:.75rem">Play Card</button>` : ""}`;
  }

  document.getElementById("cv-card").innerHTML = inner;
  if (c.type === "tech" && ["command_surge", "fungal_farms", "the_hammer", "the_corn", "for_the_science", "biotechnology"].includes(c.id)) {
    document.getElementById("btn-cv-play")?.addEventListener("click", () => {
      send({ type: "play_tech_card", card_id: c.id });
      closeCardViewer();
    });
  }
  document.getElementById("cv-dots").innerHTML = _cvCards.map((_, i) =>
    `<span class="cv-dot${i === _cvIdx ? " active" : ""}"></span>`
  ).join("");
}

const TECH_CARD_DATA = {
  fungal_farms:    { name: "Fungal Farms",        timing: "Any Time (Your Turn)", effect: "Spend 2 money for 1 Science." },
  the_hammer:      { name: "The Hammer",          timing: "Any Time (Your Turn)", effect: "Spend 2 money for 1 tool." },
  the_corn:        { name: "The Corn",            timing: "Any Time (Your Turn)", effect: "Spend 1 money for 2 food." },
  for_the_science: { name: "For the Science",     timing: "Any Time (Your Turn)", effect: "Spend 1 Science and 1 tool for 3 money." },
  titanium_armor:  { name: "Titanium Armor",      timing: "After Combat Roll",    effect: "Re-roll up to 1 enemy die." },
  nuclear_missile: { name: "Nuclear Missile",     timing: "Combat",               effect: "+1 extra die in combat." },
  biotechnology:   { name: "Biotechnology",       timing: "Any Time (Your Turn)", effect: "Spend 1 money to gain 2 food." },
  death_spores:    { name: "Death Spores",        timing: "Invasion — Start",     effect: "+1 attack dice AND remove 5 food from the defending player." },
  invasion_dice:   { name: "Orbital Bombardment", timing: "Invasion — Start",     effect: "+1 attack dice when invading a planet." },
  command_surge:   { name: "Command Surge",       timing: "Any Time (Your Turn)", effect: "Discard to gain 1 extra action this turn." },
  plasma_forge:    { name: "Plasma Forge (rare)", timing: "Any Time (Your Turn)", effect: "All your d6 attack dice become d12." },
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
  if (!me) { cardEl.innerHTML = `<strong>${myName}</strong>`; return; }
  if (!me.race) { cardEl.innerHTML = `<strong>${me.name}</strong><p style="color:var(--muted);font-size:.8rem">No race assigned</p>`; return; }

  const resources = me.resources ?? {};
  const income    = me.income    ?? {};
  const tech      = me.tech      ?? {};

  const RES_KEYS = ["food", "science", "tool", "money"];

  // Resources row (icon + count only to keep the card narrow)
  const resHtml = RES_KEYS.map(r => `
    <div class="resource-item">
      ${RESOURCE_ICONS[r] ?? ""}
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
    if (c.length >= 3) {
      upkeep.tool    += c[0];
      upkeep.food    += h.tri_farmer_green ? Math.max(1, c[1] - 1) : c[1];
      upkeep.science += c[2];
    }
  }

  const incomeHtml = `
    <div class="income-grid-3">
      <div class="income-col-hdr"></div>
      <div class="income-col-hdr">Income</div>
      <div class="income-col-hdr cost-hdr">Upkeep</div>
      ${RES_KEYS.map(r => {
        const inc  = income[r]  ?? 0;
        const cost = upkeep[r]  ?? 0;
        const incStr  = inc  > 0 ? `<span class="income-count">+${inc}</span>`   : `<span class="income-zero">—</span>`;
        const costStr = cost > 0 ? `<span class="upkeep-cost">−${cost}</span>` : `<span class="income-zero">—</span>`;
        return `
        <div class="income-res-label">${RESOURCE_ICONS[r] ?? ""}</div>
        <div class="income-cell">${incStr}</div>
        <div class="income-cell">${costStr}</div>`;
      }).join("")}
    </div>`;

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
    const descs  = TECH_DESCS[col.key] ?? [];
    const nextUnlocked = levels.findIndex(on => !on); // first locked level index
    const lvls = levels.map((on, i) => {
      const d = descs[i];
      const isNext = i === nextUnlocked;
      const detailHtml = d
        ? `<span class="tech-name"><strong>${names[i]}</strong><br><span style="color:var(--muted);font-size:.55rem">${d.cost}</span><br>${d.effect}${isNext && !on ? `<br><button class="btn btn-primary btn-sm tech-unlock-btn" style="margin-top:.25rem;font-size:.6rem;padding:.1rem .4rem" data-tkey="${col.key}">Unlock</button>` : ""}</span>`
        : `<span class="tech-name">${names[i] ?? ""}</span>`;
      const revealed =
        _revealedTech && _revealedTech.tkey === col.key && _revealedTech.tlvl === i;
      return `
      <div class="tech-level${on ? " unlocked" : ""}${revealed ? " revealed" : ""}" data-tkey="${col.key}" data-tlvl="${i}">
        <span class="tech-lvl-label">Lv ${i + 1}</span>
        ${detailHtml}
      </div>`;
    }).join("");
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
      if (id.startsWith("empire_") || id === "base1" || id === "base2" || seenAction.has(id)) continue;
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

  const unrest = me.resources?.unrest ?? 0;
  cardEl.innerHTML = `
    <div class="player-race-card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem">
        <button class="btn btn-ghost btn-sm" id="btn-card-close">◀ Map</button>
        <div style="display:flex;gap:.6rem;align-items:center;font-size:.8rem;font-weight:700">
          <span style="color:#f59e0b">${me.vp ?? 0}/7 VP</span>
          <span style="color:#ef4444">${unrest}/20 Unrest</span>
        </div>
      </div>
      <div class="resource-row">${resHtml}</div>
      <div class="income-section mt2">
        <div class="income-heading">Income / Turn</div>
        ${incomeHtml}
      </div>
      <div class="tech-tree mt2">${costsColHtml}${techColsHtml}</div>
      <button class="btn btn-primary mt2" id="btn-view-actions" style="width:100%">View Cards</button>
    </div>`;

  cardEl.querySelector("#btn-card-close")?.addEventListener("click", () => setViewMode("map"));

  // Tap to reveal tech detail (one open at a time; selection survives AI turn updates)
  cardEl.querySelectorAll(".tech-level").forEach(el => {
    el.addEventListener("click", e => {
      if (e.target.classList.contains("tech-unlock-btn")) return; // handled separately
      const open = el.classList.contains("revealed");
      if (open) {
        _revealedTech = null;
      } else {
        _revealedTech = { tkey: el.dataset.tkey, tlvl: Number(el.dataset.tlvl) };
      }
      cardEl.querySelectorAll(".tech-level.revealed").forEach(r => r.classList.remove("revealed"));
      if (_revealedTech) {
        const sel = cardEl.querySelector(
          `.tech-level[data-tkey="${_revealedTech.tkey}"][data-tlvl="${_revealedTech.tlvl}"]`
        );
        if (sel) sel.classList.add("revealed");
      }
    });
  });

  // Unlock button inside revealed tech row
  cardEl.querySelectorAll(".tech-unlock-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const col = btn.dataset.tkey;
      const row = btn.closest(".tech-level");
      const tlvl = row ? Number(row.dataset.tlvl) : 0;
      send({ type: "research_skill", column: col });
      _revealedTech = { tkey: col, tlvl };
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

// True if dest cluster has an orbital hex with room for your ship (no enemy stack).
function hasFrigateSlot(hexes, cluster) {
  return hexes.some(h => h.cluster === cluster && h.type === "orbital"
    && (h.pieces ?? []).filter(p => MOBILE_SHIPS.has(p.type)).length < 3
    && !(h.pieces ?? []).some(p => MOBILE_SHIPS.has(p.type) && p.owner !== myName));
}

function orbitalOpenForOwner(h, owner) {
  return h.type === "orbital"
    && (h.pieces ?? []).filter(p => MOBILE_SHIPS.has(p.type)).length < 3
    && !(h.pieces ?? []).some(p => MOBILE_SHIPS.has(p.type) && p.owner !== owner);
}

// Flight: wormhole routes into a cluster with at least one open orbital (no enemy on that hex).
function computeFlightOnlyRoutes(hexes, fromCluster) {
  return computeFlightRoutes(hexes, fromCluster).filter(r =>
    hasFrigateSlot(hexes, r.dest_cluster)
  );
}

function computeInvasionRoutes(hexes, fromCluster) {
  return computeFlightRoutes(hexes, fromCluster).filter(r => {
    const core = hexes.find(h => h.cluster === r.dest_cluster && h.local === 0);
    const alreadyMine = (core?.pieces ?? []).some(p => p.type === "empire_flag" && p.owner === myName);
    // Invasion doesn't need an open orbital slot — the wormhole itself is the entry point.
    // Server rejects with a toast if enemies still block; hasFrigateSlot not required here.
    return core && core.planet && !alreadyMine;
  });
}

function computeAttackRoutes(hexes, fromCluster) {
  return computeFlightRoutes(hexes, fromCluster).filter(r =>
    hexes.some(h => h.cluster === r.dest_cluster
      && (h.pieces ?? []).some(p => MOBILE_SHIPS.has(p.type) && p.owner !== myName))
  );
}

// ── Invasion modal ─────────────────────────────────────────────────────────

function showInvasionPrompt(msg) {
  const overlay = document.getElementById("combat-modal");
  const board = msg.board ?? boardCache ?? [];
  const clusterLabel = board.find(h => h.cluster === msg.dest_cluster && h.local === 0)?.label ?? msg.dest_cluster;
  const planet = msg.planet ?? {};
  const techCards = (msg.tech_cards ?? []).filter(id => ["nuclear_missile", "death_spores", "invasion_dice"].includes(id));
  let selectedTech = null;

  const cardCounts = techCards.reduce((acc, id) => { acc[id] = (acc[id] ?? 0) + 1; return acc; }, {});
  const uniqueCards = [...new Set(techCards)];
  const techHtml = uniqueCards.length > 0 ? `
    <div class="combat-tech-label">Play a tech card (optional — 1 max):</div>
    <div class="combat-tech-list" id="combat-tech-list">
      ${uniqueCards.map(id => {
        const t = TECH_CARD_DATA[id];
        const cnt = cardCounts[id];
        return `<div class="combat-tech-item" data-id="${id}">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="combat-tech-name">${t?.name ?? id}</span>
            ${cnt > 1 ? `<span class="card-count-badge">×${cnt}</span>` : ""}
          </div>
          <span class="combat-tech-effect">${t?.effect ?? ""}</span>
        </div>`;
      }).join("")}
    </div>` : `<div class="hint" style="margin-bottom:.5rem">No combat tech cards in hand.</div>`;

  const atkCount = msg.atk_count ?? 1;
  const defCount = msg.def_dice_count ?? (msg.planet?.ancient ? 3 : 3);
  const defLabel = msg.planet?.ancient ? `${defCount}d50` : `${defCount}d6`;
  document.getElementById("combat-title").textContent = `Invade System ${clusterLabel}!`;
  document.getElementById("combat-body").innerHTML = `
    <div class="hint" style="margin-bottom:.75rem">Planet defends with <strong>${defLabel}</strong>. You attack with <strong>${atkCount} ${atkCount === 1 ? "die" : "dice"}</strong> (${atkCount} scout${atkCount !== 1 ? "s" : ""})${techCards.length ? " — tech adds more" : ""}.</div>
    <div class="combat-planet-stats">
      <span>Food +${planet.food ?? 0}</span>
      <span>Science +${planet.science ?? 0}</span>
      <span>Tool +${planet.tool ?? 0}</span>
      <span>VP +${planet.vp ?? 1}</span>
    </div>
    ${techHtml}`;
  document.getElementById("combat-footer").innerHTML =
    `<button class="btn btn-danger" id="btn-invasion-confirm" style="width:100%">Roll Dice</button>`;

  overlay.classList.remove("hidden");

  const closeBtn = document.getElementById("combat-close-btn");
  closeBtn.classList.remove("hidden");
  closeBtn.onclick = () => overlay.classList.add("hidden");

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
  document.getElementById("combat-close-btn")?.classList.add("hidden");
  const won = !!msg.won;
  const isMe = msg.attacker === myName;
  const planet = msg.planet ?? {};

  const resourceChips = [];
  if (won && isMe) {
    if (planet.food)    resourceChips.push(`<span class="res-chip food">+${planet.food} Food</span>`);
    if (planet.science) resourceChips.push(`<span class="res-chip science">+${planet.science} Science</span>`);
    if (planet.tool)    resourceChips.push(`<span class="res-chip tool">+${planet.tool} Tool</span>`);
  }
  const resourceHtml = resourceChips.length
    ? `<div class="combat-resource-gain">
        <div class="combat-dice-label" style="width:100%;margin-bottom:.2rem">Added to your income:</div>
        ${resourceChips.join("")}
       </div>`
    : "";

  const atkPlayer = (_lastState?.players ?? []).find(p => p.name === msg.attacker);
  const atkRace   = atkPlayer?.race_name ? ` — ${atkPlayer.race_name}` : "";
  document.getElementById("combat-title").textContent = won
    ? `${msg.attacker}${atkRace} — Invasion Successful!`
    : `${msg.attacker}${atkRace} — Invasion Failed`;

  const rerollAvailable = !!msg.reroll_available && isMe;
  const planetDiceHtml = (msg.planet_dice ?? []).map((d, i) =>
    rerollAvailable
      ? `<span class="die die-reroll" data-idx="${i}" title="Click to re-roll">${d}</span>`
      : `<span class="die">${d}</span>`
  ).join("");
  const rerollHint = rerollAvailable
    ? `<div class="hint" style="margin:.35rem 0 .5rem;color:var(--accent2)">Titanium Armor — click a planet die to re-roll it</div>`
    : "";

  document.getElementById("combat-body").innerHTML = `
    <div class="combat-result-outcome ${won ? "win" : "lose"}">${won ? "The planet is conquered!" : "The planet repelled the attack."}</div>
    ${rerollHint}
    <div class="combat-dice-row">
      <div class="combat-dice-block">
        <div class="combat-dice-label">Attacker</div>
        <div class="combat-dice-vals">${(msg.atk_dice ?? []).map(d => `<span class="die">${d}</span>`).join("")} <span style="margin-left:.3rem">= <strong>${msg.atk_total}</strong></span></div>
      </div>
      <div class="combat-dice-block">
        <div class="combat-dice-label">Planet Defense (${(msg.planet_dice ?? []).length} dice)</div>
        <div class="combat-dice-vals">${planetDiceHtml} <span style="margin-left:.3rem">= <strong>${msg.planet_total}</strong></span></div>
      </div>
    </div>
    ${resourceHtml}`;
  if (msg.reroll_available && isMe) {
    document.getElementById("combat-footer").innerHTML =
      `<button class="btn btn-ghost" id="btn-skip-reroll" style="width:100%">No Thanks — Keep Card</button>`;
    overlay.classList.remove("hidden");
    document.querySelectorAll(".die-reroll").forEach(el => {
      el.addEventListener("click", () => {
        send({ type: "reroll_planet_die", die_index: parseInt(el.dataset.idx) });
        overlay.classList.add("hidden");
      });
    });
    document.getElementById("btn-skip-reroll").addEventListener("click", () => {
      send({ type: "skip_reroll" });
      overlay.classList.add("hidden");
    });
  } else {
    document.getElementById("combat-footer").innerHTML =
      `<button class="btn btn-primary" id="btn-combat-close" style="width:100%">Continue</button>`;
    overlay.classList.remove("hidden");
    document.getElementById("btn-combat-close").addEventListener("click", () => {
      overlay.classList.add("hidden");
    });
  }
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
  const list = document.getElementById("action-pick-list");

  // Resolve player's current tech levels for dynamic skill costs.
  const me = _lastState ? (_lastState.players ?? []).find(p => p.name === myName) : null;
  const myTech = me?.tech ?? {};

  list.innerHTML = PICKER_ACTIONS.map(a => {
    const subCls = a.sub ? " sub-action" : "";
    let costHtml = "";
    if (a.techKey) {
      const levels   = myTech[a.techKey] ?? [false,false,false,false,false];
      const nextLvl  = levels.findIndex(on => !on);  // -1 if all unlocked
      if (nextLvl >= 0 && nextLvl < TECH_COSTS.length) {
        const c = TECH_COSTS[nextLvl];
        costHtml = `<span class="action-skill-cost">Lv${nextLvl + 1}: -${c.res} sci${c.vp ? ` +${c.vp}VP` : ""}</span>`;
      } else if (nextLvl === -1) {
        costHtml = `<span class="action-skill-cost" style="color:var(--gold)">Maxed</span>`;
      }
    }
    return `
      <div class="action-pick-row${subCls}" data-action="${a.id}">
        <img class="cv-action-icon-sm" src="${a.icon}" alt="${a.label}">
        <span class="cv-action-label">${a.label}</span>
        ${costHtml}
      </div>`;
  }).join("");

  document.getElementById("action-picker").classList.remove("hidden");

  list.querySelectorAll(".action-pick-row").forEach(row => {
    row.addEventListener("click", () => {
      const action = row.dataset.action;
      document.getElementById("action-picker").classList.add("hidden");
      if (action === "flight" || action === "invasion" || action === "attack") {
        _actionMode = { type: action };
        if (_lastState) {
          renderBoard(_lastState, false);
          if (action === "invasion") {
            const src = document.querySelectorAll(".hex-selectable").length;
            if (src === 0) {
              showToast("No ships at an enemy planet — orange systems show planets. Fly your ships there first.", "#fb923c");
            } else {
              showToast(`${src / 7 | 0} system(s) ready to invade — tap a highlighted cluster`, "#4ade80");
            }
          }
        }
      } else if (action === "build_ships") {
        showConstructionPicker("ships");
      } else if (action === "build_buildings") {
        showConstructionPicker("buildings");
      } else if (action === "draw_tech_card") {
        send({ type: "draw_tech_card" });
      } else if (action === "biology_and_chem") {
        send({ type: "research_skill", column: "biology" });
      } else if (action === "physics") {
        send({ type: "research_skill", column: "physics" });
      } else if (action === "government") {
        send({ type: "research_skill", column: "government" });
      } else if (action === "engineering") {
        send({ type: "research_skill", column: "engineering" });
      } else if (action === "construction") {
        showConstructionPicker();
      } else if (action === "exploration") {
        showExplorationPicker();
      }
    });
  });
}

// ── Construction picker ────────────────────────────────────────────────────

const CONSTRUCTION_ITEMS = [
  { type: "cruise_ship",      label: "Cruise Ship",    stats: "1d12 · 2 jumps · defense only", cost: 10,  toolCost: 0  },
  { type: "scout",          label: "Scout",        stats: "1d6 · 1 jump",           cost: 10,  toolCost: 2  },
  { type: "outpost",          label: "Outpost",        stats: "1d15 · stationary",      cost: 25,  toolCost: 4  },
  { type: "super_ship",       label: "Super Ship",     stats: "2d15 · 1 jump",          cost: 50,  toolCost: 8  },
  { type: "battle_station",   label: "Battle Station", stats: "2d15+1d6 · 1 jump",      cost: 60,  toolCost: 12 },
  { type: "death_star",       label: "Death Star",     stats: "3d15 · 2 jumps",         cost: 100, toolCost: 20 },
  { type: "building_tool",    label: "Workshop (+1 Tool)",              cost: 4,   toolCost: 0  },
  { type: "building_science", label: "Lab (+1 Science)",                cost: 4,   toolCost: 0  },
  { type: "building_money",   label: "Treasury (+3 ¤)",                 cost: 6,   toolCost: 0  },
  { type: "farmer_upgrade",   label: "Farmer Upgrade (−1 food upkeep)", cost: 0,   toolCost: 3, upgrade: true },
];
const BUILDING_TYPES = new Set(["building_tool", "building_science", "building_money"]);

function buildingScaledCost(baseType) {
  const base = baseType === "building_money" ? 6 : 4;
  const board = _lastState?.board ?? [];
  const planets = board.filter(h => h.local === 0 && h.planet &&
    (h.pieces ?? []).some(pc => pc.type === "empire_flag" && pc.owner === myName)).length;
  return base * Math.max(1, planets);
}

function initConstructionPicker() {
  const el = document.createElement("div");
  el.id = "construction-picker";
  el.className = "action-picker-overlay hidden";
  el.innerHTML = `
    <div class="action-picker-modal">
      <button class="action-picker-close" id="btn-cp-close">✕</button>
      <div class="action-picker-title" id="construction-picker-title">Build Ships</div>
      <div class="cp-purse" id="cp-purse"></div>
      <div class="action-pick-list" id="construction-pick-list"></div>
    </div>`;
  document.body.appendChild(el);
  const closeCP = () => { el.classList.add("hidden"); _pendingScienceHex = null; };
  el.addEventListener("click", e => { if (e.target === el) closeCP(); });
  document.getElementById("btn-cp-close").addEventListener("click", closeCP);
}

function showConstructionPicker(filter = "all") {
  const titles = { ships: "Build Ships", buildings: "Build / Upgrade", all: "Construction" };
  document.getElementById("construction-picker-title").textContent = titles[filter] ?? "Construction";

  const me = (_lastState?.players ?? []).find(p => p.name === myName);
  const money = me?.resources?.money ?? 0;
  const tools = me?.resources?.tool ?? 0;

  const purseEl = document.getElementById("cp-purse");
  if (purseEl) {
    purseEl.innerHTML = `
      <span class="cp-purse-item">${RESOURCE_ICONS.money}<strong>${money}</strong></span>
      <span class="cp-purse-item">${RESOURCE_ICONS.tool}<strong>${tools}</strong></span>`;
  }

  const items = filter === "ships"
    ? CONSTRUCTION_ITEMS.filter(i => !BUILDING_TYPES.has(i.type) && !i.upgrade)
    : filter === "buildings"
    ? CONSTRUCTION_ITEMS.filter(i => BUILDING_TYPES.has(i.type) || i.upgrade)
    : CONSTRUCTION_ITEMS;

  const list = document.getElementById("construction-pick-list");
  list.innerHTML = items.map(item => {
    const effectiveCost = BUILDING_TYPES.has(item.type) ? buildingScaledCost(item.type) : item.cost;
    const canAfford = money >= effectiveCost && (item.toolCost === 0 || tools >= item.toolCost);
    const parts = [];
    if (effectiveCost > 0) parts.push(`${effectiveCost} ${RESOURCE_ICONS.money}`);
    if (item.toolCost > 0) parts.push(`${item.toolCost} ${RESOURCE_ICONS.tool}`);
    const costStr = parts.join(" + ") || "Free";
    return `
    <div class="action-pick-row construct-row ${canAfford ? "" : "disabled"}"
         data-type="${item.type}">
      <div class="construct-label-wrap">
        <span class="cv-action-label">${item.label}</span>
        ${item.stats ? `<span class="construct-stats">${item.stats}</span>` : ""}
      </div>
      <span class="construct-cost ${canAfford ? "" : "cant-afford"}">${costStr}</span>
    </div>`;
  }).join("");

  document.getElementById("construction-picker").classList.remove("hidden");

  list.querySelectorAll(".construct-row:not(.disabled)").forEach(row => {
    row.addEventListener("click", () => {
      const type = row.dataset.type;
      const item = CONSTRUCTION_ITEMS.find(i => i.type === type);
      document.getElementById("construction-picker").classList.add("hidden");
      if (_pendingScienceHex !== null && type !== "farmer_upgrade") {
        const hexId = _pendingScienceHex;
        _pendingScienceHex = null;
        send({ type: "build_piece", piece_type: type, hex_id: hexId });
      } else {
        _actionMode = { type: "construction" };
        _constructionPiece = { ...item };
        if (_lastState) renderBoard(_lastState, false);
      }
    });
  });
}

// ── Exploration picker ─────────────────────────────────────────────────────

function showExplorationPicker() {
  const board  = boardCache ?? [];
  const hasFog = board.some(h => h.fog);
  if (!hasFog) {
    showBoardToast("Fog of war is disabled — exploration is not available.");
    return;
  }

  // Find fogged clusters reachable via wormhole from a visible hex
  const reachable = new Map(); // cluster → label
  for (const h of board) {
    if (h.fog || !h.wormhole) continue;
    const pid = h.wormhole_partner;
    if (pid == null) continue;
    const partner = board[pid];
    if (!partner || !partner.fog) continue;
    const label = board.find(x => x.cluster === partner.cluster && x.local === 0)?.label ?? partner.cluster;
    reachable.set(partner.cluster, `Core ${label}`);
  }

  if (reachable.size === 0) {
    showBoardToast("No unexplored systems reachable from your position.");
    return;
  }

  let el = document.getElementById("exploration-picker");
  if (!el) {
    el = document.createElement("div");
    el.id = "exploration-picker";
    el.className = "action-picker-overlay hidden";
    el.innerHTML = `
      <div class="action-picker-modal">
        <button class="action-picker-close" id="btn-ep-close">✕</button>
        <div class="action-picker-title">Explore a System</div>
        <p class="hint" style="margin:.25rem 0 .6rem;font-size:.8rem">Reveals the system until your turn ends.</p>
        <div class="action-pick-list" id="exploration-pick-list"></div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener("click", e => { if (e.target === el) el.classList.add("hidden"); });
    document.getElementById("btn-ep-close").addEventListener("click", () => el.classList.add("hidden"));
  }

  const list = document.getElementById("exploration-pick-list");
  list.innerHTML = [...reachable.entries()].map(([cluster, label]) =>
    `<div class="action-pick-row" data-cluster="${cluster}">${label}</div>`
  ).join("");

  list.querySelectorAll(".action-pick-row").forEach(row => {
    row.addEventListener("click", () => {
      el.classList.add("hidden");
      send({ type: "exploration", cluster: parseInt(row.dataset.cluster) });
    });
  });

  el.classList.remove("hidden");
}

// ── Hex info panel ─────────────────────────────────────────────────────────

function initHexInfoPanel() {
  const el = document.createElement("div");
  el.id = "hex-info-panel";
  el.className = "hex-info-panel hidden";
  el.innerHTML = `
    <div class="hex-info-header">
      <span class="hex-info-title" id="hex-info-title"></span>
      <button class="hex-info-close" id="hex-info-close" aria-label="Close">✕</button>
    </div>
    <div class="hex-info-body" id="hex-info-body"></div>
    <div class="hex-info-actions" id="hex-info-actions"></div>`;
  document.body.appendChild(el);
  document.getElementById("hex-info-close").addEventListener("click", closeHexInfoPanel);
}

function closeHexInfoPanel() {
  document.getElementById("hex-info-panel")?.classList.add("hidden");
}

const _PIECE_DISPLAY = {
  scout: "Scout", cruise_ship: "Cruise Ship", outpost: "Outpost",
  super_ship: "Super Ship", battle_station: "Battle Station", death_star: "Death Star",
  empire_flag: "Empire Flag", unrest: "Unrest",
  building_tool: "Workshop (+1 Tool)", building_science: "Lab (+1 Science)",
  building_money: "Treasury (+3 ¤)", farmer_upgrade: "Farmer Upgrade",
};

function showHexInfoPanel(h) {
  const state = _lastState;
  if (!state) return;

  closeHexInfoPanel();

  const isMyBoardTurn = state.phase === "board" && state.current_turn === myName && myRole !== "watcher";
  const owned = _myOwnedClusters.has(h.cluster);

  // ── Title ──
  let titleText;
  if (h.local === 0) {
    const label = h.label || `Cluster ${h.cluster}`;
    const owner = (state.players ?? []).find(p =>
      (state.board ?? []).some(bh => bh.cluster === h.cluster &&
        (bh.pieces ?? []).some(pc => pc.type === "empire_flag" && pc.owner === p.name)));
    titleText = label + (owner ? ` — ${owner.name}` : "");
  } else if (h.tri) {
    titleText = "Farm Triangle";
  } else {
    const labels = { orbital: "Orbital", bs_slot: "Building Slot", space: "Space Hex", science: "Science Hex" };
    titleText = labels[h.type] ?? h.type;
    if (h.wormhole) titleText += " ↔ Wormhole";
  }

  // ── Body rows ──
  const rows = [];

  // Pieces grouped by type+owner
  const pieces = (h.pieces ?? []).filter(pc => pc.type !== "empire_flag" || h.local !== 0);
  const grouped = {};
  for (const pc of pieces) {
    const key = `${pc.type}||${pc.owner ?? ""}`;
    grouped[key] = (grouped[key] ?? 0) + 1;
  }
  for (const [key, count] of Object.entries(grouped)) {
    const [type, owner] = key.split("||");
    const label = _PIECE_DISPLAY[type] ?? type;
    const ownerPart = owner && owner !== myName ? ` <span class="hip-owner">(${owner})</span>` : "";
    rows.push(`<div class="hip-row">${label} × ${count}${ownerPart}</div>`);
  }

  // Planet resources (center hex)
  if (h.local === 0 && h.planet) {
    const p = h.planet;
    const dwarfHidden = p.dwarf && !p.food && !p.science && !p.tool && !p.money;
    if (dwarfHidden) {
      rows.push(`<div class="hip-row hip-muted">Dwarf planet — unrevealed</div>`);
    } else {
      if (p.food)    rows.push(`<div class="hip-row">${RESOURCE_ICONS.food} +${p.food} Food</div>`);
      if (p.science) rows.push(`<div class="hip-row">${RESOURCE_ICONS.science} +${p.science} Science</div>`);
      if (p.tool)    rows.push(`<div class="hip-row">${RESOURCE_ICONS.tool} +${p.tool} Tool</div>`);
      if (p.money)   rows.push(`<div class="hip-row">${RESOURCE_ICONS.money} +${p.money} Money</div>`);
      if (p.vp)      rows.push(`<div class="hip-row">★ +${p.vp} VP</div>`);
      if (p.ancient) rows.push(`<div class="hip-row hip-muted">Ancient planet</div>`);
    }
  }

  // Tri hex upkeep
  if (h.tri && (h.tri_counts ?? []).length >= 3) {
    const c = h.tri_counts;
    const foodCost = h.tri_farmer_green ? Math.max(1, c[1] - 1) : c[1];
    rows.push(`<div class="hip-row">${RESOURCE_ICONS.tool} −${c[0]} Upkeep</div>`);
    rows.push(`<div class="hip-row">${RESOURCE_ICONS.food} −${foodCost} Upkeep${h.tri_farmer_green ? " ★" : ""}</div>`);
    rows.push(`<div class="hip-row">${RESOURCE_ICONS.science} −${c[2]} Upkeep</div>`);
  }

  if (rows.length === 0) rows.push(`<div class="hip-row hip-muted">Empty</div>`);

  // ── Actions ──
  const actions = [];
  if (isMyBoardTurn && owned && h.local > 0) {
    if (h.type === "orbital") {
      actions.push({ label: "Build Ship?", fn: () => showConstructionPicker("ships") });
    }
    if (h.type === "bs_slot") {
      const capturedId = h.id;
      actions.push({ label: "Build Building?", fn: () => { _pendingScienceHex = capturedId; showConstructionPicker("buildings"); } });
    }
    if (h.tri && !h.tri_farmer_green) {
      actions.push({ label: "Farmer Upgrade?", fn: () => { _constructionPiece = { type: "farmer_upgrade", label: "Farmer Upgrade" }; _actionMode = { type: "construction" }; if (_lastState) renderBoard(_lastState, false); } });
    }
  }

  // Render
  document.getElementById("hex-info-title").textContent = titleText;
  document.getElementById("hex-info-body").innerHTML = rows.join("");
  const actionsEl = document.getElementById("hex-info-actions");
  actionsEl.innerHTML = actions.map((a, i) =>
    `<button class="btn btn-ghost btn-sm hip-action-btn" data-idx="${i}">${a.label}</button>`
  ).join("");
  actionsEl.querySelectorAll(".hip-action-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      closeHexInfoPanel();
      actions[+btn.dataset.idx].fn();
    });
  });

  document.getElementById("hex-info-panel").classList.remove("hidden");
}

// ── Combat modal ───────────────────────────────────────────────────────────

function initCombatModal() {
  const el = document.createElement("div");
  el.id = "combat-modal";
  el.className = "combat-overlay hidden";
  el.innerHTML = `
    <div class="combat-modal">
      <div class="combat-modal-header">
        <div class="combat-modal-title" id="combat-title"></div>
        <button class="combat-close-btn hidden" id="combat-close-btn" aria-label="Cancel">✕</button>
      </div>
      <div class="combat-modal-body" id="combat-body"></div>
      <div class="combat-modal-footer" id="combat-footer"></div>
    </div>`;
  document.body.appendChild(el);
}

function throwDice(container, dice, fromRight = false) {
  container.innerHTML = "";
  dice.forEach((val, i) => {
    const die = document.createElement("span");
    die.className = "die die-throw" + (fromRight ? " from-right" : "");
    die.style.animationDelay = `${i * 90}ms`;
    die.textContent = val;
    container.appendChild(die);
  });
}

function showCombatPrompt(msg, isAttacker) {
  const overlay = document.getElementById("combat-modal");
  document.getElementById("combat-close-btn")?.classList.add("hidden");
  const board = msg.board ?? boardCache ?? [];
  const clusterLabel = board.find(h => h.cluster === msg.dest_cluster && h.local === 0)?.label ?? msg.dest_cluster;
  let selectedTech = null;

  if (isAttacker) {
    const techCards = (msg.tech_cards ?? []).filter(id => ["nuclear_missile", "death_spores", "invasion_dice"].includes(id));
    const techHtml = techCards.length > 0 ? `
      <div class="combat-tech-label">Play a tech card (optional):</div>
      <div class="combat-tech-list" id="combat-tech-list">
        ${techCards.map(id => {
          const t = TECH_CARD_DATA[id];
          return `<div class="combat-tech-item" data-id="${id}">
            <span class="combat-tech-name">${t?.name ?? id}</span>
            <span class="combat-tech-effect">${t?.effect ?? ""}</span>
          </div>`;
        }).join("")}
      </div>` : "";

    const atkCount = msg.atk_frigate_count ?? 1;
    const defCount = msg.def_frigate_count ?? 1;
    document.getElementById("combat-title").textContent = `Attack — System ${clusterLabel}`;
    document.getElementById("combat-body").innerHTML =
      `<div class="hint" style="margin-bottom:.6rem">You attack with <strong>${atkCount} dice</strong> (${atkCount} scout${atkCount !== 1 ? "s" : ""}). Defender rolls <strong>${defCount} dice</strong>.</div>${techHtml}`;
    document.getElementById("combat-footer").innerHTML =
      `<button class="btn btn-danger" id="btn-roll-my-dice" style="width:100%">🎲 Roll My Dice</button>`;

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

    document.getElementById("btn-roll-my-dice").addEventListener("click", () => {
      document.getElementById("btn-roll-my-dice").disabled = true;
      document.getElementById("btn-roll-my-dice").textContent = "Rolled — waiting for defender…";
      send({ type: "roll_combat_dice", tech_card: selectedTech });
    });
  } else {
    const atkCount = msg.atk_frigate_count ?? 1;
    const defCount = msg.def_frigate_count ?? 1;
    document.getElementById("combat-title").textContent = `Incoming Attack — System ${clusterLabel}`;
    document.getElementById("combat-body").innerHTML =
      `<div class="hint" style="margin-bottom:.6rem">${msg.attacker} attacks with <strong>${atkCount} dice</strong>. You defend with <strong>${defCount} dice</strong> (${defCount} scout${defCount !== 1 ? "s" : ""} on that tile).</div>`;
    document.getElementById("combat-footer").innerHTML =
      `<button class="btn btn-primary" id="btn-roll-my-dice" style="width:100%">🎲 Roll My Dice</button>`;

    overlay.classList.remove("hidden");

    document.getElementById("btn-roll-my-dice").addEventListener("click", () => {
      document.getElementById("btn-roll-my-dice").disabled = true;
      document.getElementById("btn-roll-my-dice").textContent = "Rolled — waiting for attacker…";
      send({ type: "roll_combat_dice" });
    });
  }
}

function showCombatAttackerRolled(msg) {
  const overlay = document.getElementById("combat-modal");
  const isAttacker = msg.attacker === myName;
  const board = boardCache ?? [];
  const clusterLabel = board.find(h => h.cluster === msg.dest_cluster && h.local === 0)?.label ?? msg.dest_cluster;

  const isDefender = msg.defender === myName;

  if (isAttacker) {
    document.getElementById("combat-title").textContent = `Attack — System ${clusterLabel}`;
    document.getElementById("combat-body").innerHTML =
      `<div class="hint" style="margin-bottom:.5rem">You rolled:</div>
       <div class="combat-rolled-preview" id="atk-dice-preview"></div>
       <div class="hint" style="margin-top:.5rem">Total: <strong>${msg.atk_total}</strong> — waiting for defender…</div>`;
    overlay.classList.remove("hidden");
    throwDice(document.getElementById("atk-dice-preview"), msg.atk_dice, false);
    document.getElementById("combat-footer").innerHTML = "";
  } else if (isDefender) {
    document.getElementById("combat-title").textContent = `Incoming Attack — System ${clusterLabel}`;
    document.getElementById("combat-body").innerHTML =
      `<div class="hint" style="margin-bottom:.5rem">${msg.attacker} rolled:</div>
       <div class="combat-rolled-preview" id="atk-dice-preview"></div>
       <div class="hint" style="margin-top:.5rem">Total: <strong>${msg.atk_total}</strong> — now roll your dice!</div>`;
    overlay.classList.remove("hidden");
    throwDice(document.getElementById("atk-dice-preview"), msg.atk_dice, false);

    const footer = document.getElementById("combat-footer");
    footer.innerHTML = `<button class="btn btn-primary" id="btn-roll-my-dice" style="width:100%">🎲 Roll My Dice</button>`;
    footer.querySelector("#btn-roll-my-dice").addEventListener("click", () => {
      footer.querySelector("#btn-roll-my-dice").disabled = true;
      footer.querySelector("#btn-roll-my-dice").textContent = "Rolled!";
      send({ type: "roll_combat_dice" });
    });
  }
  // Non-combatant players receive combat_attacker_rolled too but should not see the roll UI
}

function showCombatResult(msg) {
  const overlay = document.getElementById("combat-modal");
  document.getElementById("combat-close-btn")?.classList.add("hidden");
  const isAttacker = msg.attacker === myName;
  const attackerWon = !!msg.attacker_won;

  let outcomeText;
  if (attackerWon) {
    outcomeText = isAttacker
      ? "Victory! One enemy scout destroyed."
      : `One of your scouts was destroyed.`;
  } else {
    outcomeText = isAttacker
      ? "Attack failed — one of your scouts was destroyed."
      : "You repelled the attack! One attacker frigate destroyed.";
  }

  const iWon = (isAttacker && attackerWon) || (!isAttacker && !attackerWon);
  document.getElementById("combat-title").textContent = iWon ? "Victory!" : (isAttacker ? "Attack Failed" : "Held Position!");
  document.getElementById("combat-body").innerHTML = `
    <div class="combat-result-outcome ${iWon ? "win" : "lose"}">${outcomeText}</div>
    <div class="combat-dice-row">
      <div class="combat-dice-block">
        <div class="combat-dice-label">Attacker — ${msg.attacker}</div>
        <div class="combat-dice-vals" id="result-atk-dice">
          <span style="margin-left:.3rem">= <strong>${msg.atk_total}</strong></span>
        </div>
      </div>
      <div class="combat-dice-block">
        <div class="combat-dice-label">Defender — ${msg.defender}</div>
        <div class="combat-dice-vals" id="result-def-dice">
          <span style="margin-left:.3rem">= <strong>${msg.def_total}</strong></span>
        </div>
      </div>
    </div>`;
  document.getElementById("combat-footer").innerHTML =
    `<button class="btn btn-primary" id="btn-combat-close" style="width:100%">Continue</button>`;

  overlay.classList.remove("hidden");

  const atkContainer = document.getElementById("result-atk-dice");
  const defContainer = document.getElementById("result-def-dice");
  const atkTotal = atkContainer.querySelector("span");
  const defTotal = defContainer.querySelector("span");

  msg.atk_dice.forEach((val, i) => {
    const die = document.createElement("span");
    die.className = "die die-throw";
    die.style.animationDelay = `${i * 90}ms`;
    die.textContent = val;
    atkContainer.insertBefore(die, atkTotal);
  });
  msg.def_dice.forEach((val, i) => {
    const die = document.createElement("span");
    die.className = "die die-throw from-right";
    die.style.animationDelay = `${i * 90}ms`;
    die.textContent = val;
    defContainer.insertBefore(die, defTotal);
  });

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
  const title = planet.ancient ? `Ancient Core — ${label}`
              : planet.dwarf   ? `Dwarf Planet — ${label}`
              : `System ${label}`;
  $("planet-modal-title").textContent = title;

  const display = $("planet-display");
  display.style.setProperty("--pc", color);

  const body = $("planet-body");
  body.innerHTML = _planetSvg(color);
  body.style.boxShadow = `0 0 28px ${color}, 0 0 8px rgba(0,0,0,0.6)`;

  const STAT_ROWS = [
    planet.ancient  && { icon: "icons/vp.svg",       label: "Capture = Instant Win", value: "⚠" },
    planet.ancient  && { icon: "icons/vp.svg",       label: "Defense Dice",          value: "10" },
    !planet.dwarf && !planet.ancient && { icon: "icons/vp.svg", label: "Victory Point", value: "+1" },
    planet.unrest   && { icon: "icons/unrest.svg",   label: "Unrest",   value: planet.unrest },
    planet.food     && { icon: "icons/food.svg",     label: "Food",     value: `+${planet.food}` },
    planet.science  && { icon: "icons/research.svg", label: "Science",  value: `+${planet.science}` },
    planet.tool     && { icon: "icons/tool.svg",     label: "Tool",     value: `+${planet.tool}` },
    planet.money    && { icon: "icons/money.svg",    label: "Money",    value: `+${planet.money}` },
  ].filter(Boolean);
  $("planet-stat-list").innerHTML = STAT_ROWS.map(r => `
    <div class="planet-stat-row">
      <img class="planet-stat-icon" src="${r.icon}" alt="${r.label}">
      <span class="planet-stat-label">${r.label}</span>
      <span class="planet-stat-value">${r.value}</span>
    </div>`).join("");

  $("planet-modal").classList.remove("hidden");
}

// ── Breadcrumb toasts ──────────────────────────────────────────────────────

function showToast(msg, color) {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }
  const t = document.createElement("div");
  t.className = "toast-msg";
  t.innerHTML = `<span class="toast-dot" style="background:${color ?? "var(--accent)"}"></span>${msg}`;
  container.appendChild(t);
  requestAnimationFrame(() => t.classList.add("toast-visible"));
  setTimeout(() => { t.classList.remove("toast-visible"); setTimeout(() => t.remove(), 300); }, 3500);
}

function detectOpponentMoves(newBoard, state) {
  if (!_prevBoardState) { _prevBoardState = newBoard; return; }
  if (state.phase !== "board") { _prevBoardState = newBoard; return; }

  const playerColor = {};
  for (const p of (state.players ?? [])) if (p.color) playerColor[p.name] = p.color;

  // ── Ship move animation detection (all players) ──────────────────────────
  const prevById = Object.fromEntries(_prevBoardState.map(h => [h.id, h]));
  const moves = [];
  // hexes that gained ships
  for (const h of newBoard) {
    const prev = prevById[h.id];
    for (const p of (h.pieces ?? [])) {
      if (!MOBILE_SHIPS.has(p.type)) continue;
      const prevCount = (prev?.pieces ?? []).filter(q => q.type === p.type && q.owner === p.owner).length;
      const newCount  = (h.pieces ?? []).filter(q => q.type === p.type && q.owner === p.owner).length;
      if (newCount > prevCount) {
        // This hex gained a ship — find where it came from (hex in prevBoard that lost same type/owner)
        const src = _prevBoardState.find(ph =>
          ph.id !== h.id &&
          (ph.pieces ?? []).filter(q => q.type === p.type && q.owner === p.owner).length >
          ((newBoard.find(nh => nh.id === ph.id)?.pieces ?? []).filter(q => q.type === p.type && q.owner === p.owner).length)
        );
        if (src) {
          moves.push({ fromX: src.x, fromY: src.y, toX: h.x, toY: h.y, color: playerColor[p.owner] ?? "#ffffff" });
        }
      }
    }
  }
  if (moves.length > 0) {
    _animQueue.push({ moves, oldBoard: _prevBoardState, state });
  }

  const clusterLabel = {};
  for (const h of newBoard) if (h.local === 0) clusterLabel[h.cluster] = h.label ?? h.cluster;

  // Track empire_flag captures by opponents
  const prevFlags = {};
  for (const h of _prevBoardState) {
    for (const p of (h.pieces ?? [])) {
      if (p.type === "empire_flag") (prevFlags[p.owner] ??= new Set()).add(h.cluster);
    }
  }
  for (const h of newBoard) {
    for (const p of (h.pieces ?? [])) {
      if (p.type === "empire_flag" && p.owner !== myName) {
        if (!(prevFlags[p.owner] ?? new Set()).has(h.cluster)) {
          showToast(`${p.owner} captured <strong>${clusterLabel[h.cluster]}</strong>!`, playerColor[p.owner]);
        }
      }
    }
  }

  _prevBoardState = newBoard;
}

function cancelAnimations() {
  _animRunning = false;
  _activeAnimCount = 0;
  _animQueue = [];
  _animLatestState = null;
  const layer = document.getElementById("drag-layer");
  if (layer) layer.innerHTML = "";
}

// Called when a batch completes; renders final state once all parallel batches are done.
function _makeAnimOnComplete(savedState) {
  return () => {
    if (!_animRunning) return; // already cancelled — don't touch state
    _activeAnimCount--;
    if (_activeAnimCount === 0 && _animQueue.length === 0) {
      _animRunning = false;
      const final = _animLatestState ?? savedState;
      _animLatestState = null;
      const layer = document.getElementById("drag-layer");
      if (layer) layer.innerHTML = "";
      renderBoard(final, false);
    } else if (_animQueue.length > 0) {
      _startParallelBatches();
    }
  };
}

// Start all currently queued batches immediately, running in parallel with any active animations.
// Does NOT call renderBoard first — preserves running trails in drag-layer.
function _startParallelBatches() {
  while (_animQueue.length > 0) {
    const item = _animQueue.shift();
    if (!item.state) continue;
    _activeAnimCount++;
    runShipAnimations(item.moves, _makeAnimOnComplete(item.state));
  }
}

function _drainAnimQueue() {
  if (_animQueue.length === 0) {
    if (_activeAnimCount === 0) _animRunning = false;
    return;
  }
  const item = _animQueue.shift();
  if (!item.state) { _drainAnimQueue(); return; }
  _animRunning = true;
  _activeAnimCount++;
  // Pre-render at old positions so the animated ship starts at the right spot.
  // drag-layer is preserved because _animRunning is already true.
  renderBoard({ ...item.state, board: item.oldBoard }, false);
  runShipAnimations(item.moves, _makeAnimOnComplete(item.state));
  // Start any additional batches that arrived at the same time, in parallel.
  _startParallelBatches();
}

function runShipAnimations(moves, onComplete) {
  const ns = "http://www.w3.org/2000/svg";
  const layer = document.getElementById("drag-layer");
  if (!layer || moves.length === 0) { onComplete?.(); return; }
  const DURATION = 950;
  let done = 0;
  function ease(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }
  for (const mv of moves) {
    const ship = document.createElementNS(ns, "circle");
    ship.setAttribute("r", "5");
    ship.setAttribute("fill", mv.color);
    ship.setAttribute("cx", mv.fromX);
    ship.setAttribute("cy", mv.fromY);
    ship.style.filter = `drop-shadow(0 0 9px ${mv.color})`;
    layer.appendChild(ship);
    const trail = [];
    const start = performance.now();
    let lastTrail = -1;
    (function frame(now) {
      // If drag-layer was cleared by a mid-animation renderBoard call, bail out cleanly
      // so onComplete fires and the animation queue can continue draining.
      if (!ship.isConnected) {
        for (const d of trail) d.el.remove();
        if (++done === moves.length) onComplete?.();
        return;
      }
      const t = Math.min((now - start) / DURATION, 1);
      const x = mv.fromX + (mv.toX - mv.fromX) * ease(t);
      const y = mv.fromY + (mv.toY - mv.fromY) * ease(t);
      ship.setAttribute("cx", x);
      ship.setAttribute("cy", y);
      // Drop a trail dot every ~30ms
      if (now - lastTrail > 30) {
        lastTrail = now;
        const dot = document.createElementNS(ns, "circle");
        dot.setAttribute("r", "3");
        dot.setAttribute("fill", mv.color);
        dot.setAttribute("cx", x);
        dot.setAttribute("cy", y);
        dot.setAttribute("opacity", "0.7");
        layer.insertBefore(dot, ship);
        trail.push({ el: dot, born: now });
      }
      // Fade trail
      for (const d of trail) {
        const age = (now - d.born) / 420;
        d.el.setAttribute("opacity", Math.max(0, 0.7 - age).toFixed(2));
      }
      // Remove fully faded
      for (let i = trail.length - 1; i >= 0; i--) {
        if (now - trail[i].born > 600) { trail[i].el.remove(); trail.splice(i, 1); }
      }
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        ship.remove();
        for (const d of trail) d.el.remove();
        if (++done === moves.length) onComplete?.();
      }
    })(performance.now());
  }
}

// ── Board pan / pinch-zoom ──────────────────────────────────────────────────

function initBoardPan() {
  const wrap = $("board-wrap");
  const svg  = $("board-svg");

  const BASE_W = 872, BASE_H = 800;
  const MIN_SCALE = 0.35, MAX_SCALE = 3.5;

  // Transform state: SVG positioned by translate(tx,ty) scale(s) from wrap origin
  let tx = 0, ty = 0, scale = 1;
  svg.style.transformOrigin = "0 0";

  function commit() {
    svg.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }

  function clampPan() {
    const ww = wrap.clientWidth  || 430;
    const wh = wrap.clientHeight || 700;
    const m  = 80; // min px of board that must remain visible
    tx = Math.min(ww - m, Math.max(-(BASE_W * scale - m), tx));
    ty = Math.min(wh - m, Math.max(-(BASE_H * scale - m), ty));
  }

  function applyZoom(newScale, clientX, clientY) {
    newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
    const rect  = wrap.getBoundingClientRect();
    const px    = clientX - rect.left;  // pivot in wrap-space
    const py    = clientY - rect.top;
    // SVG point under the pivot stays pinned
    const svgPx = (px - tx) / scale;
    const svgPy = (py - ty) / scale;
    scale = newScale;
    tx = px - svgPx * scale;
    ty = py - svgPy * scale;
    clampPan();
    commit();
  }

  // Fit and center the whole board on first show
  function resetView() {
    const ww = wrap.clientWidth;
    const wh = wrap.clientHeight;
    if (!ww || !wh) return;
    scale = Math.min(ww / BASE_W, wh / BASE_H, 1.0);
    tx = (ww - BASE_W * scale) / 2;
    ty = (wh - BASE_H * scale) / 2;
    commit();
  }
  initBoardPan.resetView = resetView;

  // When the wrap resizes (window/orientation/mobile address bar/fitBoardWrapHeight), re-clamp
  // the pan in place so the board content can't slip behind the new bottom edge — but keep
  // the user's current zoom and roughly their current focus point.
  if (typeof ResizeObserver !== "undefined") {
    let _firstResize = true;
    const ro = new ResizeObserver(() => {
      if (_firstResize) { _firstResize = false; return; }
      clampPan();
      commit();
    });
    ro.observe(wrap);
  }

  // ── pan state ────────────────────────────────────────────────
  let panning = false, didDrag = false, capturedId = null;
  let startX = 0, startY = 0, startTx = 0, startTy = 0;

  // ── pinch-zoom state ─────────────────────────────────────────
  // We track active pointers in a Map keyed by pointerId. Browsers sometimes drop pointerup /
  // pointercancel events (finger lifts outside the element, tab loses focus, OS gesture
  // preempts), which used to leave stale entries here — once 2 stale entries accumulated
  // every subsequent touch was misread as a pinch with a corrupt baseline. The handlers below
  // are self-healing: we listen for pointerup/pointercancel on window, dedupe duplicate
  // pointerIds on pointerdown, cap the map at 2, time-out stale entries, and reset on
  // visibility/blur.
  const activePointers = new Map();
  let pinching = false, pinchStartDist = 0, pinchPivot = null, baseScale = 1;
  const POINTER_STALE_MS = 2500;

  function getPinchDist() {
    const [a, b] = [...activePointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function pruneStalePointers() {
    const now = performance.now();
    for (const [id, info] of activePointers) {
      if (now - info.t > POINTER_STALE_MS) activePointers.delete(id);
    }
  }

  function resetGestureState() {
    activePointers.clear();
    if (pinching) { pinching = false; pinchPivot = null; }
    if (panning)  { panning  = false; wrap.classList.remove("panning"); }
    if (capturedId !== null) {
      try { wrap.releasePointerCapture(capturedId); } catch (_) {}
      capturedId = null;
    }
  }

  function startPinch() {
    pinching = true; panning = false;
    pinchStartDist = getPinchDist();
    const [a, b] = [...activePointers.values()];
    pinchPivot = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    baseScale = scale;
    if (capturedId !== null) {
      try { wrap.releasePointerCapture(capturedId); } catch (_) {}
      capturedId = null;
    }
  }

  wrap.addEventListener("pointerdown", (e) => {
    pruneStalePointers();
    // Dedupe: if we somehow already have this pointerId, drop the stale entry first so we
    // don't double-count it (browsers occasionally re-fire pointerdown without an up).
    if (activePointers.has(e.pointerId)) activePointers.delete(e.pointerId);
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
    // Hard cap at 2 — drop the oldest if a 3rd finger arrives so we don't corrupt pinch math.
    while (activePointers.size > 2) {
      const oldest = activePointers.keys().next().value;
      activePointers.delete(oldest);
    }

    if (activePointers.size === 2) {
      startPinch();
      return;
    }

    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (pinching) return;
    panning = true; didDrag = false;
    capturedId = e.pointerId;
    startX = e.clientX; startY = e.clientY;
    startTx = tx; startTy = ty;
  });

  wrap.addEventListener("pointermove", (e) => {
    if (activePointers.has(e.pointerId)) {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
    }

    if (pinching && activePointers.size === 2) {
      const d = getPinchDist();
      if (pinchStartDist > 0 && pinchPivot) {
        applyZoom(baseScale * (d / pinchStartDist), pinchPivot.x, pinchPivot.y);
      }
      return;
    }

    if (!panning) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!didDrag && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
      didDrag = true;
      try { wrap.setPointerCapture(capturedId); } catch (_) {}
      wrap.classList.add("panning");
    }
    if (didDrag) {
      tx = startTx + dx;
      ty = startTy + dy;
      clampPan();
      commit();
    }
  });

  const stopPointer = (e) => {
    activePointers.delete(e.pointerId);
    // If pinching is ending but one finger is still down, hand off to panning so the user
    // doesn't have to lift and re-tap to continue.
    if (pinching && activePointers.size < 2) {
      pinching = false;
      pinchPivot = null;
      if (activePointers.size === 1) {
        const [pid, pos] = activePointers.entries().next().value;
        panning = true;
        didDrag = false;
        capturedId = pid;
        startX = pos.x; startY = pos.y;
        startTx = tx; startTy = ty;
      }
    }
    if (activePointers.size === 0) {
      panning = false;
      wrap.classList.remove("panning");
      if (capturedId !== null) {
        try { wrap.releasePointerCapture(capturedId); } catch (_) {}
        capturedId = null;
      }
    }
  };
  // Listen on window as a safety net: when a finger lifts outside #board-wrap, or a
  // pointercancel fires at the document level, we still get notified and clean up.
  wrap.addEventListener("pointerup",     stopPointer);
  wrap.addEventListener("pointercancel", stopPointer);
  window.addEventListener("pointerup",     stopPointer);
  window.addEventListener("pointercancel", stopPointer);

  // Full reset whenever the page is hidden, the window loses focus, or pointer leaves the
  // browser entirely — covers iOS/Safari quirks and OS-level gesture interrupts.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) resetGestureState();
  });
  window.addEventListener("blur",       resetGestureState);
  window.addEventListener("pagehide",   resetGestureState);
  document.addEventListener("pointerleave", (e) => {
    // Some browsers fire this on the document when the pointer leaves the viewport.
    if (e.target === document.documentElement) resetGestureState();
  });

  wrap.addEventListener("click", (e) => {
    if (didDrag) { e.stopPropagation(); didDrag = false; }
  }, true);

  // Desktop scroll-wheel zoom
  wrap.addEventListener("wheel", (e) => {
    e.preventDefault();
    applyZoom(scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX, e.clientY);
  }, { passive: false });

  commit();

  // SVG click dispatcher — converts clientX/Y to SVG coords via getBoundingClientRect,
  // which accounts for any CSS transform, then finds the nearest hex center.
  svg.addEventListener("click", (e) => {
    if (!_hexHandlers.size || !_hexPositions.length) return;
    const rect = svg.getBoundingClientRect();
    const vb   = (svg.getAttribute("viewBox") || "0 0 872 800").split(/\s+/).map(Number);
    const svgX = vb[0] + (e.clientX - rect.left) * (vb[2] / rect.width);
    const svgY = vb[1] + (e.clientY - rect.top)  * (vb[3] / rect.height);
    let nearestId = -1, minDist = Infinity;
    for (const { id, x, y } of _hexPositions) {
      const d = Math.hypot(x - svgX, y - svgY);
      if (d < minDist) { minDist = d; nearestId = id; }
    }
    if (nearestId >= 0 && minDist < R * 1.15 && _hexHandlers.has(nearestId)) {
      e.stopPropagation();
      _hexHandlers.get(nearestId)();
    }
  });
}

// ── Screens / helpers ──────────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
  const onLanding = id === "screen-landing";
  const title   = document.getElementById("app-title");
  const tagline = document.getElementById("app-tagline");
  if (title)   title.style.display   = onLanding ? "" : "none";
  if (tagline) tagline.style.display = onLanding ? "" : "none";
  if (id === "screen-board") {
    // Recompute the board container height once the screen is visible so its bottom edge
    // never extends behind the fixed #status-bar (the "Connected · Board code: …" footer).
    requestAnimationFrame(fitBoardWrapHeight);
  }
}

function fitBoardWrapHeight() {
  const wrap = document.getElementById("board-wrap");
  const sb   = document.getElementById("status-bar");
  if (!wrap || !sb) return;
  // Skip while the board screen is hidden — getBoundingClientRect returns 0s and would
  // collapse the wrap. We re-run from showScreen() and from resize listeners.
  if (wrap.offsetParent === null) return;
  const wrapRect = wrap.getBoundingClientRect();
  const sbRect   = sb.getBoundingClientRect();
  // Status bar is `position: fixed; bottom: 0`, so sbRect.top = viewport bottom - sb height.
  // Leave an 8px gap so the bottom border of the board doesn't visually touch the bar.
  const available = sbRect.top - wrapRect.top - 8;
    if (available > 100) {
      wrap.style.height = Math.floor(available) + "px";
      // The pan controller's ResizeObserver will re-clamp the pan on its own, so we don't
      // forcibly recentre / lose the user's current zoom level mid-game.
    }
}
window.addEventListener("resize", fitBoardWrapHeight);
window.addEventListener("orientationchange", fitBoardWrapHeight);

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
$("btn-add-ai").addEventListener("click",       () => send({ type: "add_ai" }));
$("btn-confirm-race").addEventListener("click", () => send({ type: "confirm_race" }));
$("btn-roll-dice").addEventListener("click",    () => send({ type: "roll_dice" }));

setInterval(() => send({ type: "ping" }), 25_000);

// If the WS drops while a game is active (tab backgrounded, network blip),
// go back to the landing screen so the player can manually rejoin.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  if (!myName) return; // no active session
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  setTimeout(() => {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    resetToLanding();
  }, 1500);
});
// iOS BFCache restore: same rule
window.addEventListener("pageshow", (e) => {
  if (!e.persisted) return;
  if (!myName) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  resetToLanding();
});

initBoardPan();
initCardViewer();
initDraftOverlay();
initActionPicker();
initConstructionPicker();
initCombatModal();
initHexInfoPanel();
initPlanetModal();
