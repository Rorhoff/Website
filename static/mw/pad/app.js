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
}

function showPad() {
  joinScreen.classList.add('hidden');
  lobbyScreen.classList.add('hidden');
  padScreen.classList.remove('hidden');
}

function updateLobbyUi() {
  el('hostPanel').classList.toggle('hidden', !isHost || inGame);
  if (isHost && !inGame) {
    el('lobbyCue').textContent = 'Fill empty slots with robots, then start when both teams are ready.';
  }
}

// ---------------------------------------------------------------- connection

function connect(code, name) {
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

    if (msg.t === 'joined') {
      myPid = msg.pid;
      showLobby();
      el('lobbyStatus').textContent = `Connected as ${msg.name}`;
      el('lobbyCue').textContent = 'Waiting for the TV…';
      requestWakeLock();
      return;
    }

    if (msg.t === 'pick_team') {
      isHost = Boolean(msg.host);
      showLobby();
      el('teamPick').classList.remove('hidden');
      el('lobbyStatus').textContent = 'Pick your team';
      el('lobbyCue').textContent = 'Choose Blue or Red to join as a whelp.';
      updateLobbyUi();
      return;
    }

    if (msg.t === 'assigned') {
      assigned = true;
      isHost = Boolean(msg.host);
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

    if (msg.t === 'game_start') {
      inGame = true;
      showPad();
      startStickLoop();
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
    if (!joinScreen.classList.contains('hidden')) return;
    el('lobbyCue').textContent = 'Disconnected. Reload to rejoin.';
    el('padCue').textContent = 'Disconnected. Reload to rejoin.';
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

el('btnFillBots').addEventListener('click', () => {
  send({ t: 'host_fill_bots' });
  el('lobbyCue').textContent = 'Adding robots…';
});

el('btnStart').addEventListener('click', () => {
  send({ t: 'host_start' });
  el('lobbyCue').textContent = 'Starting…';
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
  const down = (e) => {
    node.classList.add('pressed');
    send({ t: 'b', k: key, d: 1 });
    if (navigator.vibrate) navigator.vibrate(12);
    e.preventDefault();
  };
  const up = (e) => {
    node.classList.remove('pressed');
    send({ t: 'b', k: key, d: 0 });
    e.preventDefault();
  };
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
  node.addEventListener('pointerleave', up);
  node.addEventListener('contextmenu', (e) => e.preventDefault());
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
