const TEAM_COLORS = {
  blue: { team: '#4aa3d8', deep: '#16323f' },
  red:  { team: '#e0663f', deep: '#3f1f16' },
};

const STICK_HZ = 20;
const DEADZONE = 0.18;
const SEND_EPSILON = 0.04;

const el = (id) => document.getElementById(id);
const joinScreen = el('join');
const lobbyScreen = el('lobby');
const padScreen = el('pad');
const stick = el('stick');
const knob = el('knob');

let ws = null;
let stickX = 0, stickY = 0;
let lastSentX = 0, lastSentY = 0;
let stickPointer = null;
let myPid = null;
let myTeam = null;
let isHost = false;
let assigned = false;
let inGame = false;

function roleLabel(role) {
  return role === 'mother' ? '★ Mother Wyrm' : 'Whelp';
}

function teamLabel(team) {
  return team === 'blue' ? 'Blue team' : 'Red team';
}

function setIdentity(node, name, role, team) {
  const roleClass = role === 'mother' ? 'role-mother' : '';
  const teamClass = team === 'blue' ? 'team-blue' : 'team-red';
  node.innerHTML =
    `<span class="you">YOU · ${name}</span><br>` +
    `<span class="${roleClass} ${teamClass}">${roleLabel(role)} · ${teamLabel(team)}</span>`;
}

function applyTeamTheme(team) {
  const c = TEAM_COLORS[team];
  if (!c) return;
  document.documentElement.style.setProperty('--team', c.team);
  document.documentElement.style.setProperty('--team-deep', c.deep);
}

function showLobby() {
  joinScreen.classList.add('hidden');
  padScreen.classList.add('hidden');
  lobbyScreen.classList.remove('hidden');
  scheduleFitScreens();
}

function showPad() {
  joinScreen.classList.add('hidden');
  lobbyScreen.classList.add('hidden');
  padScreen.classList.remove('hidden');
  scheduleFitScreens();
}

function updateLobbyUi() {
  el('hostPanel').classList.toggle('hidden', !isHost || inGame || !assigned);
  if (isHost && !inGame && assigned) {
    el('lobbyCue').textContent = 'Add robots one at a time, or start — need 4 players (robots fill in).';
  }
  scheduleFitScreens();
}

function syncViewport() {
  const vv = window.visualViewport;
  const h = vv?.height ?? window.innerHeight;
  const top = vv?.offsetTop ?? 0;
  document.documentElement.style.setProperty('--vv-height', `${h}px`);
  document.documentElement.style.setProperty('--vv-top', `${top}px`);
}

function fitScreens() {
  syncViewport();
  for (const root of [document.querySelector('.join-card'), document.querySelector('.lobby-inner')]) {
    if (!root) continue;
    const screen = root.closest('.screen');
    if (!screen || screen.classList.contains('hidden')) {
      root.style.transform = '';
      continue;
    }
    root.style.transform = '';
    const available = screen.clientHeight;
    const h = root.offsetHeight;
    if (h <= 0 || available <= 0) continue;
    const scale = Math.min(1, available / h);
    root.style.transform = scale < 0.999 ? `scale(${scale})` : '';
  }
}

let fitQueued = false;
function scheduleFitScreens() {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(() => {
    fitQueued = false;
    fitScreens();
    requestAnimationFrame(fitScreens);
  });
}

let reconnectTimer = null;
let sessionCode = '';
let sessionName = '';

function saveSession(code, name) {
  sessionCode = code;
  sessionName = name;
  try {
    sessionStorage.setItem('mw_code', code);
    sessionStorage.setItem('mw_name', name);
  } catch { /* ignore */ }
}

function loadSession() {
  try {
    sessionCode = sessionStorage.getItem('mw_code') || sessionCode;
    sessionName = sessionStorage.getItem('mw_name') || sessionName;
  } catch { /* ignore */ }
}

function scheduleReconnect() {
  if (reconnectTimer || !sessionCode || !sessionName) return;
  if (joinScreen.classList.contains('hidden')) {
    el('lobbyCue').textContent = 'Reconnecting…';
    el('padCue').textContent = 'Reconnecting…';
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (sessionCode && sessionName) connect(sessionCode, sessionName);
  }, 1200);
}

// ---------------------------------------------------------------- connection

function connect(code, name) {
  saveSession(code, name);
  if (ws) {
    try { ws.close(); } catch { /* ignore */ }
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/api/mw/ws`);

  ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'join', code, name })));

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.t === 'error') {
      el('joinError').textContent = msg.reason;
      el('joinBtn').disabled = false;
      ws.close();
      return;
    }

    if (msg.t === 'rejoined') {
      myPid = msg.pid;
      el('joinBtn').disabled = false;
      if (inGame) {
        showPad();
        startStickLoop();
        el('padCue').textContent = 'Reconnected!';
      } else {
        showLobby();
        el('lobbyCue').textContent = 'Reconnected — waiting for the TV…';
      }
      requestWakeLock();
      return;
    }

    if (msg.t === 'joined') {
      myPid = msg.pid;
      saveSession(code, name);
      showLobby();
      el('lobbyStatus').textContent = `Connected as ${msg.name}`;
      el('lobbyCue').textContent = 'Waiting for the TV…';
      requestWakeLock();
      return;
    }

    if (msg.t === 'pick_team') {
      isHost = Boolean(msg.host);
      assigned = false;
      showLobby();
      el('teamPick').classList.remove('hidden');
      el('lobbyStatus').textContent = 'Pick your team';
      el('lobbyCue').textContent = 'Choose Blue or Red to join as a whelp.';
      updateLobbyUi();
      scheduleFitScreens();
      return;
    }

    if (msg.t === 'assigned') {
      assigned = true;
      isHost = Boolean(msg.host);
      myTeam = msg.team;
      applyTeamTheme(msg.team);
      setIdentity(el('lobbyStatus'), msg.name || 'You', msg.role, msg.team);
      setIdentity(el('padIdentity'), msg.name || 'You', msg.role, msg.team);
      el('teamPick').classList.add('hidden');

      if (!inGame) {
        showLobby();
        el('lobbyCue').textContent =
          msg.role === 'mother'
            ? 'You’re the dragon. Waiting for the host to start.'
            : 'Waiting for the host to start the match.';
        updateLobbyUi();
      } else {
        showPad();
        startStickLoop();
      }
      return;
    }

    if (msg.t === 'countdown') {
      showCountdown(msg.n);
      el('lobbyCue').textContent = 'Rotate to landscape…';
      return;
    }

    if (msg.t === 'game_start') {
      hideCountdown();
      inGame = true;
      showPad();
      startStickLoop();
      return;
    }

    if (msg.t === 'game_end') {
      hideCountdown();
      inGame = false;
      showLobby();
      const won = msg.winner === myTeam;
      const headline = won ? 'You won!' : `${String(msg.winner || '').toUpperCase()} wins`;
      el('lobbyCue').textContent = msg.reason || headline;
      el('padCue').textContent = `${headline} — back in lobby`;
      updateLobbyUi();
      return;
    }

    if (msg.t === 'cue') {
      if (inGame) el('padCue').textContent = msg.cue;
      else el('lobbyCue').textContent = msg.cue;
      return;
    }

    if (msg.t === 'ended') {
      el('lobbyCue').textContent = 'The game closed. Reload to join a new one.';
      el('padCue').textContent = 'The game closed. Reload to join a new one.';
      ws.close();
    }
  });

  ws.addEventListener('close', () => {
    if (!joinScreen.classList.contains('hidden')) {
      el('joinBtn').disabled = false;
      return;
    }
    scheduleReconnect();
  });
}

const send = (msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };

// ---------------------------------------------------------------- join screen

const pathCode = location.pathname.match(/\/c\/([A-Za-z]{4})/i);
if (pathCode) el('code').value = pathCode[1].toUpperCase();

el('joinBtn').addEventListener('click', () => {
  const code = el('code').value.trim().toUpperCase();
  const name = el('name').value.trim() || 'Whelp';
  if (code.length !== 4) { el('joinError').textContent = 'The code is four letters.'; return; }
  el('joinError').textContent = '';
  el('joinBtn').disabled = true;
  connect(code, name);
});

loadSession();
if (sessionCode) el('code').value = sessionCode;
if (sessionName) el('name').value = sessionName;

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && sessionCode && sessionName &&
      (!ws || ws.readyState !== WebSocket.OPEN)) {
    scheduleReconnect();
  }
});

// ---------------------------------------------------------------- team pick

el('pickBlue').addEventListener('click', () => {
  send({ t: 'pick', team: 'blue' });
  el('teamPick').classList.add('hidden');
  el('lobbyCue').textContent = 'Joining Blue…';
});

el('pickRed').addEventListener('click', () => {
  send({ t: 'pick', team: 'red' });
  el('teamPick').classList.add('hidden');
  el('lobbyCue').textContent = 'Joining Red…';
});

// ---------------------------------------------------------------- host controls

el('btnFillBots').addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  send({ t: 'host_fill_bots' });
  el('lobbyCue').textContent = 'Adding robot…';
});

el('btnStart').addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (countdownActive) return;
  send({ t: 'host_start' });
  el('lobbyCue').textContent = 'Get ready…';
});

// ---------------------------------------------------------------- stick

function updateStick(clientX, clientY) {
  const r = stick.getBoundingClientRect();
  const radius = r.width / 2;
  let dx = (clientX - (r.left + radius)) / radius;
  let dy = (clientY - (r.top + radius)) / radius;

  const mag = Math.hypot(dx, dy);
  if (mag > 1) { dx /= mag; dy /= mag; }

  stickX = Math.abs(dx) < DEADZONE ? 0 : dx;
  stickY = Math.abs(dy) < DEADZONE ? 0 : dy;

  knob.style.transform =
    `translate(calc(-50% + ${dx * radius * 0.55}px), calc(-50% + ${dy * radius * 0.55}px))`;
}

function releaseStick() {
  stickPointer = null;
  stickX = stickY = 0;
  knob.style.transform = 'translate(-50%, -50%)';
  send({ t: 'i', x: 0, y: 0 });
  lastSentX = lastSentY = 0;
}

stick.addEventListener('pointerdown', (e) => {
  stickPointer = e.pointerId;
  stick.setPointerCapture(e.pointerId);
  updateStick(e.clientX, e.clientY);
  e.preventDefault();
});

stick.addEventListener('pointermove', (e) => {
  if (e.pointerId !== stickPointer) return;
  updateStick(e.clientX, e.clientY);
  e.preventDefault();
});

for (const evt of ['pointerup', 'pointercancel']) {
  stick.addEventListener(evt, (e) => {
    if (e.pointerId === stickPointer) releaseStick();
  });
}

let stickLoopStarted = false;
let countdownActive = false;

function showCountdown(n) {
  countdownActive = true;
  el('countdown').classList.remove('hidden');
  el('countdownNum').textContent = String(n);
}

function hideCountdown() {
  countdownActive = false;
  el('countdown').classList.add('hidden');
}
function startStickLoop() {
  if (stickLoopStarted) return;
  stickLoopStarted = true;
  setInterval(() => {
    if (!inGame) return;
    if (Math.abs(stickX - lastSentX) < SEND_EPSILON &&
        Math.abs(stickY - lastSentY) < SEND_EPSILON) return;
    lastSentX = stickX;
    lastSentY = stickY;
    send({ t: 'i', x: +stickX.toFixed(2), y: +stickY.toFixed(2) });
  }, 1000 / STICK_HZ);
}

// ---------------------------------------------------------------- buttons

function wireButton(node, key) {
  // Every finger that lands is its own press — thumbs alternating on one button
  // are normal play, so a second pointer must not be swallowed. Capturing keeps
  // the release on this node when a thumb rolls off the edge mid-tap.
  const activePointers = new Set();
  let seq = 0;

  const down = (e) => {
    activePointers.add(e.pointerId);
    try { node.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
    node.classList.add('pressed');
    seq++;
    send({ t: 'b', k: key, d: 1, n: seq });
    if (navigator.vibrate) navigator.vibrate(12);
    e.preventDefault();
  };

  const up = (e) => {
    if (!activePointers.delete(e.pointerId)) return;
    if (activePointers.size > 0) return;
    node.classList.remove('pressed');
    // The release carries the same count, so a dropped press is recovered.
    send({ t: 'b', k: key, d: 0, n: seq });
    if (e.preventDefault) e.preventDefault();
  };

  node.addEventListener('pointerdown', down);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
  node.addEventListener('lostpointercapture', up);
  node.addEventListener('contextmenu', (e) => e.preventDefault());

  // Backstop: if the page is hidden mid-press the release never arrives.
  const releaseAll = () => {
    if (activePointers.size === 0) return;
    activePointers.clear();
    node.classList.remove('pressed');
    send({ t: 'b', k: key, d: 0, n: seq });
  };
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAll();
  });
}

wireButton(el('btnJump'), 'jump');
wireButton(el('btnAction'), 'action');

// ---------------------------------------------------------------- housekeeping

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) await navigator.wakeLock.request('screen');
  } catch { /* not fatal */ }
}

document.addEventListener('gesturestart', (e) => e.preventDefault());

window.addEventListener('resize', scheduleFitScreens);
window.visualViewport?.addEventListener('resize', scheduleFitScreens);
window.visualViewport?.addEventListener('scroll', scheduleFitScreens);
window.addEventListener('orientationchange', () => setTimeout(scheduleFitScreens, 100));
window.addEventListener('pageshow', scheduleFitScreens);
scheduleFitScreens();
