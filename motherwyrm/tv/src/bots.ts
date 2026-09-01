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

function nearestGem(gems: Array<{ x: number; y: number }>, x: number, y: number) {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const g of gems) {
    const d = (g.x - x) ** 2 + (g.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
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
    if (Math.abs(world.wyrmX - winX) < 80) tapJump(a.input);
    return;
  }

  if (a.carrying > 0) {
    steerToward(a.input, a.x, hoardX, 22);
    if (!a.onGround && a.carrying > 0 && Math.abs(a.x - hoardX) < 50) {
      tapAction(a.input);
    } else if (a.onGround && Math.random() < 0.02) {
      tapJump(a.input);
    }
    return;
  }

  if (ourGems + 3 <= theirGems || world.gems.length < 4) {
    steerToward(a.input, a.x, world.wyrmX, 30);
    if (a.onGround && Math.abs(a.x - world.wyrmX) < 70) {
      tapJump(a.input);
    }
    return;
  }

  const gem = nearestGem(world.gems, a.x, a.y);
  if (gem) {
    steerToward(a.input, a.x, gem.x, 16);
    if (a.onGround && gem.y < a.y - 40 && Math.abs(a.x - gem.x) < 40) {
      tapJump(a.input);
    }
    if (!a.onGround && Math.abs(a.x - gem.x) < 36 && Math.random() < 0.04) {
      tapAction(a.input);
    }
    return;
  }

  steerToward(a.input, a.x, world.wyrmX, 40);
  if (a.onGround && Math.abs(a.x - world.wyrmX) < 60) tapJump(a.input);
}
