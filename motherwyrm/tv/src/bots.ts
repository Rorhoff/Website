import {
  HOARD_SHELF_Y,
  HOARD_WIDTH,
  HOARD_X,
  TUNING,
  W,
} from "./arena-layout";
import type { InputState, Team as NetTeam } from "./net";

export type BotActorView = {
  pid: number;
  team: NetTeam;
  role: "mother" | "whelp";
  x: number;
  y: number;
  vy: number;
  onGround: boolean;
  carrying: number;
  riding: boolean;
  deadUntil: number;
  stunUntil: number;
  input: InputState;
  bot?: boolean;
  local?: boolean;
};

export type BotWorld = {
  time: number;
  actors: BotActorView[];
  wyrmX: number;
  /** Direction the cow's head points — its stomp only hits what is in front. */
  wyrmFace?: 1 | -1;
  slotsFilled: Record<NetTeam, number>;
  gems: Array<{ x: number; y: number }>;
};

const OTHER: Record<NetTeam, NetTeam> = { blue: "red", red: "blue" };
const GROUND_Y = TUNING.cowGroundY ?? 690;
/** Center platform stack — whelps under it must walk out the sides. */
const CENTER_LEDGE = { xMin: 500, xMax: 780, yTop: 570 };

/** Per-bot scratch state: throttles taps and detects when a bot is wedged. */
type BotMemory = {
  lastFlap: number;
  lastJump: number;
  lastAction: number;
  lastX: number;
  lastY: number;
  movedAt: number;
  breakoutUntil: number;
  breakoutDir: 1 | -1;
};

const memory = new Map<number, BotMemory>();

export function resetBotMemory() {
  memory.clear();
}

function memoryFor(a: BotActorView, time: number): BotMemory {
  let m = memory.get(a.pid);
  if (!m) {
    m = {
      lastFlap: 0,
      lastJump: 0,
      lastAction: 0,
      lastX: a.x,
      lastY: a.y,
      movedAt: time,
      breakoutUntil: 0,
      breakoutDir: 1,
    };
    memory.set(a.pid, m);
  }
  return m;
}

function trackMovement(a: BotActorView, m: BotMemory, time: number) {
  if (Math.abs(a.x - m.lastX) > 2.5 || Math.abs(a.y - m.lastY) > 2.5) {
    m.movedAt = time;
  }
  m.lastX = a.x;
  m.lastY = a.y;
}

function isStuck(m: BotMemory, time: number, ms: number): boolean {
  return time - m.movedAt > ms;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function setStick(input: InputState, x: number, y: number) {
  input.x = clamp(x, -1, 1);
  input.y = clamp(y, -1, 1);
}

function tapJump(input: InputState) {
  input.jumpEdge = true;
  input.jump = false;
}

function tapAction(input: InputState) {
  input.actionEdge = true;
  input.action = false;
}

function jumpThrottled(a: BotActorView, m: BotMemory, time: number, ms: number) {
  if (time - m.lastJump < ms) return;
  m.lastJump = time;
  tapJump(a.input);
}

function hoardCenterX(team: NetTeam): number {
  return HOARD_X[team] + HOARD_WIDTH / 2;
}

function loseLineX(team: NetTeam): number {
  return team === "blue" ? TUNING.wyrmWin.red : TUNING.wyrmWin.blue;
}

/** Full-strength horizontal drive. Returns false once inside the tolerance. */
function driveX(input: InputState, fromX: number, toX: number, tol = 12): boolean {
  const dx = toX - fromX;
  if (Math.abs(dx) <= tol) {
    input.x = 0;
    return false;
  }
  input.x = dx > 0 ? 1 : -1;
  return true;
}

/** Alternate escape directions with a hop when a bot has stopped moving. */
function breakout(a: BotActorView, m: BotMemory, time: number) {
  if (time > m.breakoutUntil) {
    m.breakoutDir = m.breakoutDir === 1 ? -1 : 1;
    m.breakoutUntil = time + 600;
  }
  a.input.x = m.breakoutDir;
  tapJump(a.input);
  m.lastJump = time;
  // Give the escape a fresh window before it counts as stuck again.
  m.movedAt = time - 200;
}

/**
 * Cheapest gem to actually reach: horizontal distance plus a heavy climb
 * penalty, so bots work the level they are on instead of hovering under ledges.
 */
export function pickBestGem(
  gems: Array<{ x: number; y: number }>,
  x: number,
  y: number
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;

  for (const g of gems) {
    const dx = Math.abs(g.x - x);
    const dy = g.y - y;
    const climb = dy < 0 ? -dy : 0;
    const drop = dy > 0 ? dy : 0;

    let score = dx + climb * 2.6 + drop * 0.5;
    // More than one hop up: only worth it when nothing else is close.
    if (climb > 170) score += 900;
    // Gems tucked under the center stack when we are already below it.
    if (
      y > CENTER_LEDGE.yTop &&
      g.y > CENTER_LEDGE.yTop + 40 &&
      g.x > CENTER_LEDGE.xMin &&
      g.x < CENTER_LEDGE.xMax
    ) {
      score += 500;
    }

    if (score < bestScore) {
      bestScore = score;
      best = g;
    }
  }

  return best;
}

function enemyMother(world: BotWorld, team: NetTeam) {
  return world.actors.find(
    (a) => a.role === "mother" && a.team === OTHER[team] && a.deadUntil <= world.time
  );
}

function livingEnemyWhelps(world: BotWorld, team: NetTeam): BotActorView[] {
  return world.actors.filter(
    (w) => w.team !== team && w.role === "whelp" && w.deadUntil <= world.time
  );
}

function nearestGemDistance(world: BotWorld, x: number, y: number): number {
  let best = Infinity;
  for (const g of world.gems) {
    const d = Math.hypot(g.x - x, g.y - y);
    if (d < best) best = d;
  }
  return best;
}

/** Walk out from under the center stack before crossing to the cow. */
function unstuckFromCenterLedge(a: BotActorView): boolean {
  if (!a.onGround || a.y < 610) return false;
  if (a.x <= CENTER_LEDGE.xMin || a.x >= CENTER_LEDGE.xMax) return false;
  const escapeX = a.x < W / 2 ? CENTER_LEDGE.xMin - 50 : CENTER_LEDGE.xMax + 50;
  driveX(a.input, a.x, escapeX, 10);
  return true;
}

export function updateBotBrains(world: BotWorld) {
  for (const a of world.actors) {
    if (!a.bot) continue;

    const m = memoryFor(a, world.time);
    trackMovement(a, m, world.time);

    if (a.deadUntil > world.time || a.stunUntil > world.time) {
      m.movedAt = world.time;
      continue;
    }

    a.input.x = 0;
    a.input.y = 0;
    a.input.jump = false;
    a.input.action = false;

    if (a.role === "mother") {
      updateMotherBot(a, world, m);
    } else {
      updateWhelpBot(a, world, m);
    }
  }
}

// ------------------------------------------------------------------- mother

type MotherTarget = { x: number; y: number; press: boolean };

/**
 * Defend first: a rider is one push from a loss, a carrier is one step from a
 * filled slot. Only pick a fight with the other mother when nothing is at risk.
 */
function pickMotherTarget(a: BotActorView, world: BotWorld): MotherTarget {
  const enemies = livingEnemyWhelps(world, a.team);

  const rider = enemies.find((w) => w.riding);
  if (rider) return { x: rider.x, y: rider.y, press: true };

  const cowY = GROUND_Y - 60;
  if (Math.abs(world.wyrmX - loseLineX(a.team)) < 300) {
    return { x: world.wyrmX, y: cowY, press: true };
  }

  let best: BotActorView | null = null;
  let bestScore = Infinity;
  for (const w of enemies) {
    let score = Math.hypot(w.x - a.x, w.y - a.y);
    if (w.carrying > 0) score *= 0.4;
    if (nearestGemDistance(world, w.x, w.y) < 130) score *= 0.65;
    if (score < bestScore) {
      bestScore = score;
      best = w;
    }
  }
  if (best) return { x: best.x, y: best.y, press: true };

  const rival = enemyMother(world, a.team);
  if (rival) return { x: rival.x, y: rival.y, press: true };

  // Nothing to hunt — sit over the cow so we can contest it instantly.
  return { x: world.wyrmX, y: cowY, press: false };
}

function updateMotherBot(a: BotActorView, world: BotWorld, m: BotMemory) {
  const target = pickMotherTarget(a, world);

  const dx = target.x - a.x;
  const dy = target.y - a.y;
  const dist = Math.hypot(dx, dy);

  driveX(a.input, a.x, target.x, 14);

  // Mothers cannot swing upward, so hold station above whatever we are hunting.
  const hoverY = clamp(target.y - 80, 130, 600);
  if (a.y > hoverY + 18 && world.time - m.lastFlap > 180) {
    m.lastFlap = world.time;
    tapJump(a.input);
  }

  // Wedged against geometry: flap free and try the other way.
  if (isStuck(m, world.time, 900)) {
    tapJump(a.input);
    m.lastFlap = world.time;
    a.input.x = dx >= 0 ? 1 : -1;
    m.movedAt = world.time - 400;
  }

  const inReach = dist < 150 && dy > -40;
  if (target.press && inReach && world.time - m.lastAction > 320) {
    m.lastAction = world.time;
    const len = dist || 1;
    setStick(a.input, dx / len, Math.max(0, dy / len));
    tapAction(a.input);
  }
}

// -------------------------------------------------------------------- whelp

/** Exactly one whelp per team babysits the cow once the hoard is underway. */
function isPrimaryEscort(a: BotActorView, world: BotWorld): boolean {
  const mates = world.actors.filter(
    (w) => w.team === a.team && w.role === "whelp" && w.deadUntil <= world.time
  );
  if (mates.length <= 1) return false;
  let lowest = mates[0];
  for (const w of mates) if (w.pid < lowest.pid) lowest = w;
  return lowest.pid === a.pid;
}

function shouldEscortCow(a: BotActorView, world: BotWorld): boolean {
  const our = world.slotsFilled[a.team];
  const their = world.slotsFilled[OTHER[a.team]];

  if (Math.abs(world.wyrmX - loseLineX(a.team)) < 300) return true;
  if (their > our + 3) return true;
  if (world.gems.length === 0) return true;
  if (world.gems.length <= 4 && our >= 4) return true;
  if (our >= 5 && isPrimaryEscort(a, world)) return true;
  return false;
}

function goToWyrm(a: BotActorView, world: BotWorld, m: BotMemory) {
  if (unstuckFromCenterLedge(a)) return;

  // Mounting only needs contact, so close on the cow — but tuck in behind the
  // head, which is the side that stomps.
  const face = world.wyrmFace ?? 1;
  driveX(a.input, a.x, world.wyrmX - face * 26, 8);

  if (isStuck(m, world.time, 800)) breakout(a, m, world.time);
}

function goDeposit(a: BotActorView, world: BotWorld, m: BotMemory) {
  const hoardX = hoardCenterX(a.team);
  const moving = driveX(a.input, a.x, hoardX, 10);

  // Standing on the ground below the shelf — hop up onto it.
  if (a.onGround && a.y > HOARD_SHELF_Y + 20) {
    jumpThrottled(a, m, world.time, 420);
  }

  // Parked on the hoard without a slot contact: shuffle along the shelf.
  if (!moving && a.onGround) {
    a.input.x = Math.floor(world.time / 400) % 2 === 0 ? 1 : -1;
  }

  if (isStuck(m, world.time, 700)) breakout(a, m, world.time);
}

function goGetGem(
  a: BotActorView,
  world: BotWorld,
  m: BotMemory,
  gem: { x: number; y: number }
) {
  driveX(a.input, a.x, gem.x, 10);

  const dy = gem.y - a.y;
  const aligned = Math.abs(gem.x - a.x) < 60;

  // Ledges are one-way from below, so a hop while aligned pops us through.
  if (a.onGround && dy < -30 && aligned) {
    jumpThrottled(a, m, world.time, 380);
  }

  if (isStuck(m, world.time, 700)) breakout(a, m, world.time);
}

function updateWhelpBot(a: BotActorView, world: BotWorld, m: BotMemory) {
  if (a.riding) {
    setStick(a.input, a.team === "blue" ? -1 : 1, 0);
    return;
  }

  if (a.carrying > 0) {
    goDeposit(a, world, m);
    return;
  }

  if (shouldEscortCow(a, world)) {
    goToWyrm(a, world, m);
    return;
  }

  const gem = pickBestGem(world.gems, a.x, a.y);
  if (gem) {
    goGetGem(a, world, m, gem);
    return;
  }

  goToWyrm(a, world, m);
}
