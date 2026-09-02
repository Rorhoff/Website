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

function homePatrolX(team: NetTeam): number {
  return team === "blue" ? W * 0.38 : W * 0.62;
}

/** Prefer nearby gems; heavily penalize gems far above until we're closer. */
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

function steerToward(input: InputState, fromX: number, toX: number, tol = 18) {
  const dx = toX - fromX;
  if (Math.abs(dx) < tol) {
    setStick(input, 0, 0);
    return;
  }
  setStick(input, Math.sign(dx), 0);
}

function shouldEscortCow(a: BotActorView, world: BotWorld): boolean {
  const our = world.slotsFilled[a.team];
  const their = world.slotsFilled[OTHER[a.team]];
  const escortTurn = (a.pid + Math.floor(world.time / 5000)) % 2 === 0;

  if (their > our + 1) return true;
  if (world.gems.length <= 6) return escortTurn;
  if (our >= 6 && their <= our) return escortTurn;
  return false;
}

function goToWyrm(a: BotActorView, world: BotWorld) {
  steerToward(a.input, a.x, world.wyrmX, 24);
  if (a.onGround && Math.abs(a.x - world.wyrmX) < 72) {
    if (world.time % 600 < 50) tapJump(a.input);
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

  if (a.y > 500) {
    tapJump(a.input);
  }

  if (enemy && Math.abs(a.x - enemy.x) < 220 && Math.abs(a.y - enemy.y) < 160) {
    steerToward(a.input, a.x, enemy.x, 36);
    if (Math.abs(a.x - enemy.x) < 90 && Math.abs(a.y - enemy.y) < 80) {
      tapAction(a.input);
    }
    return;
  }

  if (theirGems >= 3 && Math.abs(a.x - hoardX) < 200) {
    steerToward(a.input, a.x, hoardX, 28);
    if (Math.abs(a.x - enemyHoardX) < 100 && a.y < 480 && world.time % 600 < 50) {
      tapAction(a.input);
    }
    return;
  }

  steerToward(a.input, a.x, homePatrolX(a.team), 40);

  if (ourGems >= 10 && world.time % 900 < 50 && Math.abs(a.x - enemyHoardX) < 140) {
    tapAction(a.input);
  }
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
    steerToward(a.input, a.x, hoardX, 22);
    if (!a.onGround && Math.abs(a.x - hoardX) < 50) {
      tapAction(a.input);
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
      // Under a ledge — walk out and try again instead of hopping in place.
      setStick(a.input, a.x < gem.x ? -1 : 1, 0);
    }
    return;
  }

  if (theirGems > ourGems || world.gems.length === 0) {
    goToWyrm(a, world);
  }
}
