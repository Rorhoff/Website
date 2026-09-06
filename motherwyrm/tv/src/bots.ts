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
  /** Team holding the cow, or null when the saddle is free. */
  cowTeam?: NetTeam | null;
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
/**
 * Time making no headway toward a gem before we accept we cannot route to it.
 * This has to measure stalling, not elapsed time: climbing three rungs is
 * several seconds of honest progress, and a flat budget cancelled it every
 * time, leaving the bot to hop at the same gem forever.
 */
const GEM_GIVEUP_MS = 2200;
const GEM_AVOID_MS = 6000;
/** Distance that counts as having got somewhere, for the wedged check. */
const PROGRESS_PX = 45;
/**
 * Height a whelp gains from a standing jump, less a safety margin. The ladders
 * rise ~90-100px a rung, so one hop clears exactly one rung and no more.
 */
const MAX_RISE = 125;

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
  /** Gems that beat us recently, keyed as above, mapped to when to retry. */
  avoid: Map<string, number>;
  /** Committed to stepping off a ledge, so the fall is not steered back onto it. */
  dropping: boolean;
  /** Mid climb hop, and the x it is aimed at, held for the whole flight. */
  climbing: boolean;
  climbAim: number;
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
      avoid: new Map(),
      dropping: false,
      climbing: false,
      climbAim: a.x,
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

function jumpThrottled(a: BotActorView, m: BotMemory, time: number, ms: number): boolean {
  if (time - m.lastJump < ms) return false;
  m.lastJump = time;
  tapJump(a.input);
  return true;
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

/** Top of the lowest ledge a standing hop would land us on, or null for clear air. */
function ceilingAbove(a: BotActorView): number | null {
  const feet = a.y + WHELP_HALF;
  let best: number | null = null;
  for (const [px, py, pw] of PLATFORMS) {
    if (pw >= W * 0.9) continue;
    if (py >= feet) continue;
    if (feet - py > MAX_RISE) continue;
    if (a.x + WHELP_HALF <= px || a.x - WHELP_HALF >= px + pw) continue;
    if (best === null || py > best) best = py;
  }
  return best;
}

/** How far a rung's span sits from x, zero when x is over it. */
function rungGap(p: [number, number, number, number], x: number): number {
  const [px, , pw] = p;
  if (x < px) return px - x;
  if (x > px + pw) return x - (px + pw);
  return 0;
}

/**
 * Climb one rung toward something above us.
 *
 * Hopping at the target's x only works when a ledge happens to overhang that
 * spot. On the outer ladders it usually does not — rungs are staggered and two
 * rungs apart is 180px, well past a 137px jump — so the bot hammered jump under
 * open air. This instead picks the lowest rung that is both within jump range
 * and overlapping the ledge we are stood on, walks into that overlap, and hops
 * from there.
 */
function climbToward(
  a: BotActorView,
  m: BotMemory,
  time: number,
  targetX: number,
  targetY: number
): boolean {
  if (!a.onGround) {
    if (!m.climbing) return false;
    // Hold the aim for the whole hop. Re-aiming at the target the moment the
    // feet leave the rung drifts us off the landing strip — the staggered rungs
    // only overlap by 30-40px — and drops us right back where we started.
    driveX(a.input, a.x, m.climbAim, 6);
    return true;
  }
  m.climbing = false;

  // No ledge underfoot means the floor, which spans the whole arena.
  const stand = footing(a);
  const [sx, sy, sw] = stand ?? [0, GROUND_Y, W, 0];

  let best: [number, number, number, number] | null = null;
  for (const p of PLATFORMS) {
    const [px, py, pw] = p;
    if (pw >= W * 0.9) continue;
    if (py >= sy) continue; // not above us
    if (sy - py > MAX_RISE) continue; // out of reach in one hop
    if (py + 8 < targetY) continue; // would carry us past the target
    const lo = Math.max(px, sx);
    const hi = Math.min(px + pw, sx + sw);
    // Landing needs the bodies to overlap, not a whole body's width of ledge.
    // Rungs are staggered, so most useful overlaps are only 30-40px.
    if (hi - lo < 16) continue;
    if (best && py < best[1]) continue; // prefer the lowest qualifying rung
    if (best && py === best[1] && rungGap(best, targetX) <= rungGap(p, targetX)) continue;
    best = p;
  }
  if (!best) return false;
  // The rung has to belong to the ladder that leads to the target. Without this
  // a bot heading for an outer gem will happily climb the centre stack, which
  // tops out overlapping nothing, and then fall back down it forever.
  if (rungGap(best, targetX) > 120) return false;

  const [bx, , bw] = best;
  const lo = Math.max(bx, sx);
  const hi = Math.min(bx + bw, sx + sw);
  // Stand in from the edges where there is room, so the hop is not a knife edge.
  const inset = Math.min(12, Math.max(0, (hi - lo) / 2 - 1));
  const aim = clamp(targetX, lo + inset, hi - inset);

  // Hop only once lined up under the rung, so the jump has somewhere to land.
  if (!driveX(a.input, a.x, aim, 8) && jumpThrottled(a, m, time, 380)) {
    m.climbing = true;
    m.climbAim = aim;
  }
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
  // Line up on the cow's centre. That is directly under the gap in the centre
  // stack, and it is out of the head's stomp arc, which starts further forward.
  const targetX = world.wyrmX;

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

  // Boarding means landing on the back, so the last move is a hop. Skip it
  // where a ledge overhead would catch us instead, which just bounces the bot
  // up and down on the scenery.
  const claimable = !world.cowTeam || world.cowTeam === a.team;
  if (a.onGround && !moving && claimable && ceilingAbove(a) === null) {
    jumpThrottled(a, m, world.time, 700);
  }

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
    // A new target gets a fresh stall budget, or a stale one cancels it at once.
    m.gemKey = key;
    m.anchorX = a.x;
    m.anchorY = a.y;
    m.movedAt = world.time;
  } else if (isStuck(m, world.time, GEM_GIVEUP_MS)) {
    m.avoid.set(key, world.time + GEM_AVOID_MS);
    m.gemKey = "";
    return;
  }

  // Mid hop up the ladder: see it through. At the top of the arc the gem often
  // looks like it is within a single hop, and reconsidering there steers off the
  // rung and drops us back on the ledge we started from, over and over.
  if (m.climbing && !a.onGround) {
    climbToward(a, m, world.time, gem.x, gem.y);
    return;
  }

  const dy = gem.y - a.y;

  // Below us: step off the ledge rather than pacing along it out of reach.
  if (dy > PROGRESS_PX && descendToward(a, m, gem.x)) {
    if (a.onGround && isStuck(m, world.time, 900)) breakout(a, m, world.time);
    return;
  }

  // Above us. A gem within one hop of the ledge we are stood on only needs us
  // lined up underneath — many float in open air with no ledge at all. Anything
  // higher, or out past our ledge, needs the ladder a rung at a time. Staying
  // put for a rung on the far side of the map is not progress either, so only
  // climb once we are roughly beneath the thing.
  const stand = footing(a);
  const overLedge =
    !stand || (gem.x > stand[0] - 10 && gem.x < stand[0] + stand[2] + 10);
  const needsLadder = dy < -MAX_RISE || !overLedge;
  const overhead = Math.abs(gem.x - a.x) < 300;
  if (dy < -30 && needsLadder && overhead && climbToward(a, m, world.time, gem.x, gem.y)) {
    if (a.onGround && isStuck(m, world.time, 1200)) breakout(a, m, world.time);
    return;
  }

  const moving = driveX(a.input, a.x, gem.x, 10);

  // Lined up under a gem within reach: hop. Ledges are one-way from below, so
  // this pops through anything in the way too.
  if (a.onGround && dy < -30 && Math.abs(gem.x - a.x) < 60) {
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
