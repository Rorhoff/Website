import {
  HOARD_SHELF_Y,
  HOARD_WIDTH,
  HOARD_X,
  PLATFORMS,
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
  /** Centre x of each still-empty hoard slot, so a carrier aims at a real gap. */
  openSlots?: Record<NetTeam, number[]>;
  gems: Array<{ x: number; y: number }>;
};

const OTHER: Record<NetTeam, NetTeam> = { blue: "red", red: "blue" };
const GROUND_Y = TUNING.cowGroundY ?? 690;
/** Center platform stack — gems tucked under it are awkward to reach. */
const CENTER_LEDGE = { xMin: 500, xMax: 780, yTop: 570 };
/** Half a whelp body: 24px art at 2x, matching the sprites Game.ts builds. */
const WHELP_HALF = 24;
/** How far below the shelf lip a whelp's centre sits when stood on it. */
const SHELF_STAND_Y = HOARD_SHELF_Y - WHELP_HALF;
/** Time chasing one gem before we accept it needs a route we cannot find. */
const GEM_GIVEUP_MS = 2200;
const GEM_AVOID_MS = 6000;
/** Distance that counts as having got somewhere, for the wedged check. */
const PROGRESS_PX = 45;

/** Per-bot scratch state: throttles taps and detects when a bot is wedged. */
type BotMemory = {
  lastFlap: number;
  lastJump: number;
  lastAction: number;
  /** Where we were when we last made real headway, not where we were last frame. */
  anchorX: number;
  anchorY: number;
  movedAt: number;
  breakoutUntil: number;
  breakoutDir: 1 | -1;
  /** The gem we committed to, so we can notice we are getting nowhere with it. */
  gemKey: string;
  gemSince: number;
  /** Gems that beat us recently, keyed as above, mapped to when to retry. */
  avoid: Map<string, number>;
  /** Committed to stepping off a ledge, so the fall is not steered back onto it. */
  dropping: boolean;
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
      anchorX: a.x,
      anchorY: a.y,
      movedAt: time,
      breakoutUntil: 0,
      breakoutDir: 1,
      gemKey: "",
      gemSince: time,
      avoid: new Map(),
      dropping: false,
    };
    memory.set(a.pid, m);
  }
  return m;
}

/**
 * Progress means leaving where we were, not merely moving. Comparing against
 * the previous frame let a bot jitter on the spot or hop in place forever and
 * still read as busy, so the wedged check never fired.
 */
function trackMovement(a: BotActorView, m: BotMemory, time: number) {
  const travelled = Math.abs(a.x - m.anchorX) > PROGRESS_PX;
  // Height only counts with the feet down: a hop peaks 137px up and comes
  // straight back, so mid-air y would always look like progress.
  const newFooting = a.onGround && Math.abs(a.y - m.anchorY) > PROGRESS_PX;
  if (travelled || newFooting) {
    m.anchorX = a.x;
    m.anchorY = a.y;
    m.movedAt = time;
  }
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

/** Horizontal reach of the shelf the slots stand on, hoard width plus its lip. */
function shelfSpan(team: NetTeam): [number, number] {
  return [HOARD_X[team] - 14, HOARD_X[team] + HOARD_WIDTH + 14];
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

/** The ledge a whelp is stood on, or null when airborne or on the floor. */
function footing(a: BotActorView): [number, number, number, number] | null {
  if (!a.onGround) return null;
  for (const p of PLATFORMS) {
    const [px, py, pw] = p;
    if (pw >= W * 0.9) continue; // the floor — nothing below it
    if (Math.abs(a.y + WHELP_HALF - py) > 8) continue;
    if (a.x + WHELP_HALF <= px || a.x - WHELP_HALF >= px + pw) continue;
    return p;
  }
  return null;
}

/**
 * Ledges are one-way from below and there is no drop input, so the only way
 * down is to walk off an end. Head for whichever end points at the target.
 * Without this a bot could only ever climb, which is why carriers stranded up
 * the ladder jittered on the spot instead of returning to the shelf.
 */
function descendToward(a: BotActorView, m: BotMemory, targetX: number): boolean {
  if (!a.onGround) {
    if (!m.dropping) return false;
    // Coast the rest of the fall. Re-aiming at the target the instant the feet
    // clear the lip steers straight back onto the ledge, and the bot stalls on
    // the edge stepping on and off it.
    a.input.x = 0;
    return true;
  }

  m.dropping = false;
  const ledge = footing(a);
  if (!ledge) return false;

  const [px, , pw] = ledge;
  const offLeft = px - WHELP_HALF - 8;
  const offRight = px + pw + WHELP_HALF + 8;
  const exit =
    Math.abs(targetX - offLeft) <= Math.abs(targetX - offRight) ? offLeft : offRight;
  m.dropping = true;
  driveX(a.input, a.x, exit, 4);
  return true;
}

/** Alternate escape directions with a hop when a bot has stopped moving. */
function breakout(a: BotActorView, m: BotMemory, time: number) {
  if (time > m.breakoutUntil) {
    m.breakoutDir = m.breakoutDir === 1 ? -1 : 1;
    m.breakoutUntil = time + 600;
  }
  a.input.x = m.breakoutDir;
  // Throttled: tapping every frame reads as a bot vibrating on the spot.
  jumpThrottled(a, m, time, 300);
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
  y: number,
  accept?: (gem: { x: number; y: number }) => boolean
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;

  for (const g of gems) {
    if (accept && !accept(g)) continue;
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
  // Mounting only needs contact, so close on the cow — but tuck in behind the
  // head, which is the side that stomps.
  const face = world.wyrmFace ?? 1;
  const targetX = world.wyrmX - face * 26;

  // The cow only ever walks the floor, so an escort up the ladder has to come
  // down. Pacing to the cow's x two storeys above it reaches nothing.
  if (a.y < GROUND_Y - WHELP_HALF - PROGRESS_PX && descendToward(a, m, targetX)) {
    if (a.onGround && isStuck(m, world.time, 900)) breakout(a, m, world.time);
    return;
  }

  // Only a bot that is trying to travel can be wedged. Standing still because
  // it has arrived is not stuck, and breaking out of it hops the bot back onto
  // the scenery it just climbed down from.
  const moving = driveX(a.input, a.x, targetX, 8);

  if (moving && isStuck(m, world.time, 800)) breakout(a, m, world.time);
}

function goDeposit(a: BotActorView, world: BotWorld, m: BotMemory) {
  // Aim at the nearest slot that is genuinely empty. Parking on the hoard
  // centre only ever overlaps the middle columns, so once those fill the
  // carrier has nowhere to drop and dithers on the shelf holding its gem.
  const open = world.openSlots?.[a.team] ?? [];
  const targetX = open.length
    ? open.reduce((best, x) => (Math.abs(x - a.x) < Math.abs(best - a.x) ? x : best))
    : hoardCenterX(a.team);

  // Height before aim. The slots sit on the shelf, so a carrier up the ladder
  // has to come down first — walking to the slot's x two storeys above it just
  // parks the bot in mid-air with its gem.
  if (a.y < SHELF_STAND_Y - PROGRESS_PX && descendToward(a, m, targetX)) {
    if (a.onGround && isStuck(m, world.time, 900)) breakout(a, m, world.time);
    return;
  }

  const moving = driveX(a.input, a.x, targetX, 6);

  // On the floor under the shelf — hop up once we are actually beneath it.
  const [shelfL, shelfR] = shelfSpan(a.team);
  const belowShelf = a.y > SHELF_STAND_Y + 20;
  if (a.onGround && belowShelf && a.x > shelfL && a.x < shelfR) {
    jumpThrottled(a, m, world.time, 420);
  }

  if ((moving || belowShelf) && isStuck(m, world.time, 700)) {
    breakout(a, m, world.time);
  }
}

function gemKey(gem: { x: number; y: number }): string {
  return `${Math.round(gem.x)}:${Math.round(gem.y)}`;
}

function isAvoided(m: BotMemory, gem: { x: number; y: number }, time: number): boolean {
  const until = m.avoid.get(gemKey(gem));
  if (until === undefined) return false;
  if (until > time) return true;
  m.avoid.delete(gemKey(gem));
  return false;
}

function goGetGem(
  a: BotActorView,
  world: BotWorld,
  m: BotMemory,
  gem: { x: number; y: number }
) {
  // Give up on a gem we have been failing to reach. Without this a bot that is
  // aligned under something it cannot climb to hops in place indefinitely,
  // because it keeps re-picking the same unreachable gem every frame.
  const key = gemKey(gem);
  if (m.gemKey !== key) {
    m.gemKey = key;
    m.gemSince = world.time;
  } else if (world.time - m.gemSince > GEM_GIVEUP_MS) {
    m.avoid.set(key, world.time + GEM_AVOID_MS);
    m.gemKey = "";
    return;
  }

  const dy = gem.y - a.y;

  // Below us: step off the ledge rather than pacing along it out of reach.
  if (dy > PROGRESS_PX && descendToward(a, m, gem.x)) {
    if (a.onGround && isStuck(m, world.time, 900)) breakout(a, m, world.time);
    return;
  }

  const moving = driveX(a.input, a.x, gem.x, 10);

  // Ledges are one-way from below, so a hop while aligned pops us through.
  const climbing = dy < -30 && Math.abs(gem.x - a.x) < 60;
  if (a.onGround && climbing) {
    jumpThrottled(a, m, world.time, 380);
  }

  if (moving && isStuck(m, world.time, 700)) breakout(a, m, world.time);
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

  const gem = pickBestGem(world.gems, a.x, a.y, (g) => !isAvoided(m, g, world.time));
  if (gem) {
    goGetGem(a, world, m, gem);
    return;
  }

  goToWyrm(a, world, m);
}
