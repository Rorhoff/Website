const TEAM_COLORS = {
  blue: { team: '#4aa3d8', deep: '#16323f' },
  red:  { team: '#e0663f', deep: '#3f1f16' },
};

const STICK_HZ = 20;        // analog updates per second
const DEADZONE = 0.18;      // ignore thumb drift
const SEND_EPSILON = 0.04;  // don't resend a stick position that barely moved

const el = (id) => document.getElementById(id);
const joinScreen = el('join');
const padScreen = el('pad');
const stick = el('stick');
const knob = el('knob');

let ws = null;
let stickX = 0, stickY = 0;
let lastSentX = 0, lastSentY = 0;
let stickPointer = null;

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
      el('padName').textContent = msg.name;
      el('padRole').textContent = 'Waiting for the TV';
      joinScreen.classList.add('hidden');
      padScreen.classList.remove('hidden');
      requestWakeLock();
      startStickLoop();
      return;
    }

    if (msg.t === 'assigned') {
      const c = TEAM_COLORS[msg.team];
      if (c) {
        document.documentElement.style.setProperty('--team', c.team);
        document.documentElement.style.setProperty('--team-deep', c.deep);
      }
      el('padRole').textContent = msg.role === 'mother' ? 'Mother Wyrm' : 'Whelp';
      el('btnAction').textContent = msg.role === 'mother' ? 'Claw' : 'Action';
      el('btnJump').textContent = msg.role === 'mother' ? 'Wings' : 'Jump';
      return;
    }

    if (msg.t === 'cue') { el('padCue').textContent = msg.cue; return; }

    if (msg.t === 'ended') {
      el('padCue').textContent = 'The game closed. Reload to join a new one.';
      ws.close();
    }
  });

  ws.addEventListener('close', () => {
    if (!padScreen.classList.contains('hidden')) {
      el('padCue').textContent = 'Disconnected. Reload to rejoin.';
    }
  });
}

const send = (msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };

// ---------------------------------------------------------------- join screen

// A QR code on the TV can point at /c/ABCD, so prefill from the path.
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

// Analog values go out on a fixed tick, and only when they actually changed.
function startStickLoop() {
  setInterval(() => {
    if (Math.abs(stickX - lastSentX) < SEND_EPSILON &&
        Math.abs(stickY - lastSentY) < SEND_EPSILON) return;
    lastSentX = stickX;
    lastSentY = stickY;
    send({ t: 'i', x: +stickX.toFixed(2), y: +stickY.toFixed(2) });
  }, 1000 / STICK_HZ);
}

// ---------------------------------------------------------------- buttons

// Buttons are edge events, never polled. A tap shorter than one stick tick
// still has to land, because the jetpack and the gem punt are timing moves.
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
  } catch { /* not fatal, the screen just dims */ }
}

document.addEventListener('gesturestart', (e) => e.preventDefault());
