import { HOARD_WIDTH, HOARD_X, TUNING, W, type Team } from "./arena-layout";
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
};

export type BotWorld = {
  time: number;
  actors: BotActorView[];
  wyrmX: number;
  slotsFilled: Record<NetTeam, number>;
  gems: Array<{ x: number; y: number }>;
};

const OTHER: Record<NetTeam, NetTeam> = { blue: "red", red: "blue" };
const GROUND_Y = 655;

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
  input.action = false;
}

function tapAction(input: InputState) {
  input.actionEdge = true;
  input.action = false;
}

function hoardCenterX(team: NetTeam): number {
  return HOARD_X[team] + HOARD_WIDTH / 2;
}

function steerToward(input: InputState, fromX: number, toX: number, tol = 18) {
  const dx = toX - fromX;
  if (Math.abs(dx) < tol) {
    setStick(input, 0, 0);
    return;
  }
  setStick(input, Math.sign(dx), 0);
}

function steerTowardPoint(
  input: InputState,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  tol = 24
) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.hypot(dx, dy);
  if (dist < tol) {
    setStick(input, 0, 0);
    return;
  }
  setStick(input, dx / dist, dy / dist);
}

/** Prefer nearby gems; skip ledge gems when on the ground far below. */
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
    let penalty = 0;
    if (dy < -50) penalty += 500 + Math.abs(dy) * 3;
    if (dy > 80) penalty += 200;
    if (y > 520 && dy < -100) penalty += 2000;
    const score = dx * dx + dy * dy + penalty;
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

function nearestEnemyWhelp(
  world: BotWorld,
  team: NetTeam,
  fromX: number,
  fromY: number
): BotActorView | null {
  let best: BotActorView | null = null;
  let bestScore = Infinity;

  for (const w of world.actors) {
    if (w.team === team || w.role !== "whelp" || w.deadUntil > world.time) continue;
    const dx = w.x - fromX;
    const dy = w.y - fromY;
    let score = dx * dx + dy * dy;
    if (w.carrying > 0) score *= 0.35;
    if (w.riding) score *= 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = w;
    }
  }

  return best;
}

function shouldEscortCow(a: BotActorView, world: BotWorld): boolean {
  const our = world.slotsFilled[a.team];
  const their = world.slotsFilled[OTHER[a.team]];

  if (their > our + 3) return true;
  if (world.gems.length <= 4 && our >= 4) return true;
  if (our >= 10 && (a.pid + Math.floor(world.time / 9000)) % 2 === 0) return true;
  return false;
}

/** Approach cart from the team side — avoids camping under the center platform. */
function goToWyrm(a: BotActorView, world: BotWorld) {
  const side = a.team === "blue" ? -1 : 1;
  const targetX = world.wyrmX + side * 70;
  steerToward(a.input, a.x, targetX, 28);

  if (a.onGround && Math.abs(a.x - targetX) < 56 && a.y > GROUND_Y - 50) {
    if (world.time % 650 < 50) tapJump(a.input);
  }
}

/** Simple heuristics — enough to chase gems, hoard, ride the wyrm, and scrap. */
export function updateBotBrains(world: BotWorld) {
  for (const a of world.actors) {
    if (!a.bot) continue;
    if (a.deadUntil > world.time || a.stunUntil > world.time) continue;

    a.input.x = 0;
    a.input.y = 0;
    a.input.jump = false;
    a.input.action = false;

    if (a.role === "mother") {
      updateMotherBot(a, world);
    } else {
      updateWhelpBot(a, world);
    }
  }
}

function updateMotherBot(a: BotActorView, world: BotWorld) {
  const enemy = enemyMother(world, a.team);
  const ourGems = world.slotsFilled[a.team];
  const theirGems = world.slotsFilled[OTHER[a.team]];
  const hoardX = hoardCenterX(a.team);
  const enemyHoardX = hoardCenterX(OTHER[a.team]);
  const winX = a.team === "blue" ? TUNING.wyrmWin.blue : TUNING.wyrmWin.red;

  if (a.y > 500) {
    tapJump(a.input);
  }

  if (enemy && Math.abs(a.x - enemy.x) < 260 && Math.abs(a.y - enemy.y) < 200) {
    const dx = enemy.x - a.x;
    const dy = enemy.y - a.y;
    steerTowardPoint(a.input, a.x, a.y, enemy.x, enemy.y, 40);
    if (Math.hypot(dx, dy) < 110) {
      tapAction(a.input);
    }
    return;
  }

  const prey = nearestEnemyWhelp(world, a.team, a.x, a.y);
  if (prey) {
    const dx = prey.x - a.x;
    const dy = prey.y - a.y;
    steerTowardPoint(a.input, a.x, a.y, prey.x, prey.y, 36);
    if (Math.hypot(dx, dy) < 130) {
      tapAction(a.input);
    }
    return;
  }

  if (theirGems > ourGems) {
    steerToward(a.input, a.x, enemyHoardX, 40);
    if (Math.abs(a.x - enemyHoardX) < 140 && a.y < 520 && world.time % 550 < 45) {
      tapAction(a.input);
    }
    return;
  }

  if (ourGems >= theirGems + 2 && Math.abs(a.x - world.wyrmX) > 100) {
    const pushX = world.wyrmX + (a.team === "blue" ? -40 : 40);
    steerToward(a.input, a.x, pushX, 36);
    if (Math.abs(world.wyrmX - winX) < 160 && world.time % 700 < 50) {
      tapAction(a.input);
    }
    return;
  }

  const patrolX = a.team === "blue" ? hoardX + 140 : hoardX - 140;
  steerToward(a.input, a.x, patrolX, 48);
}

function updateWhelpBot(a: BotActorView, world: BotWorld) {
  const hoardX = hoardCenterX(a.team);
  const winX = a.team === "blue" ? TUNING.wyrmWin.blue : TUNING.wyrmWin.red;
  const ourGems = world.slotsFilled[a.team];
  const theirGems = world.slotsFilled[OTHER[a.team]];

  if (a.riding) {
    const pull = a.team === "blue" ? 1 : -1;
    setStick(a.input, pull, 0);
    if (Math.abs(world.wyrmX - winX) < 120 && world.time % 800 < 50) {
      tapJump(a.input);
    }
    return;
  }

  if (a.carrying > 0) {
    const depositX = hoardX + (a.team === "blue" ? 30 : -30);
    steerToward(a.input, a.x, depositX, 22);
    if (!a.onGround && Math.abs(a.x - hoardX) < 60) {
      tapAction(a.input);
    } else if (a.onGround && a.y > 600 && Math.abs(a.x - hoardX) < 40) {
      if (world.time % 500 < 45) tapJump(a.input);
    }
    return;
  }

  if (shouldEscortCow(a, world)) {
    goToWyrm(a, world);
    return;
  }

  const gem = pickBestGem(world.gems, a.x, a.y);
  if (gem) {
    steerToward(a.input, a.x, gem.x, 20);
    const dy = gem.y - a.y;

    if (a.onGround && dy < -35 && Math.abs(a.x - gem.x) < 48) {
      if (world.time % 550 < 45) tapJump(a.input);
    } else if (a.onGround && dy > 40 && Math.abs(a.x - gem.x) < 32) {
      setStick(a.input, a.x < gem.x ? -1 : 1, 0);
    } else if (a.onGround && dy < -100 && Math.abs(a.x - gem.x) < 64) {
      setStick(a.input, a.x < gem.x ? -1 : 1, 0);
    }
    return;
  }

  if (theirGems > ourGems || world.gems.length === 0) {
    goToWyrm(a, world);
  }
}
