/**
 * Headless arena sim for the whelp bots.
 *
 * bots.ts is pure, so the only way to catch a bot that looks busy but never
 * finishes anything is to actually run it against the real geometry. This
 * mirrors the Arcade physics Game.ts sets up: 48x48 bodies, one-way ledges,
 * and slot/gem pickup by AABB overlap.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  GEM_SPAWNS,
  HOARD_SHELF_Y,
  PLATFORMS,
  SLOT_COLS,
  TUNING,
  W,
  slotRect,
} from "./arena-layout";
import { blankInput, type Team } from "./net";
import { resetBotMemory, updateBotBrains, type BotActorView, type BotWorld } from "./bots";

const DT = 1 / 60;
const WHELP_HALF = 24;
const GEM_HALF = 10;
/**
 * Centre of the mount window, from Game.ts: the cow sits COW_HALF_H above its
 * feet, its back is 22px above that, and a rider stands a half-whelp higher.
 */
const COW_BACK_Y = (TUNING.cowGroundY ?? 690) - 44 - 22 - WHELP_HALF;

type SimGem = { x: number; y: number; alive: boolean };

type SimWhelp = BotActorView & { vx: number };

function makeWhelp(pid: number, team: Team, x: number, y: number, carrying = 0): SimWhelp {
  return {
    pid,
    team,
    role: "whelp",
    x,
    y,
    vx: 0,
    vy: 0,
    onGround: false,
    carrying,
    riding: false,
    deadUntil: 0,
    stunUntil: 0,
    input: blankInput(),
    bot: true,
  };
}

class Sim {
  time = 0;
  gems: SimGem[];
  slots: Record<Team, boolean[]> = { blue: [], red: [] };
  /** Gems picked up over the whole run, so progress is not sampled at one instant. */
  collected = new Map<number, number>();
  /**
   * Reversals that land within 300ms of the previous one. Walking a route
   * reverses seconds apart; jitter reverses continuously, so this separates the
   * two where a raw reversal count cannot.
   */
  rapidFlips = new Map<number, number>();
  private lastDir = new Map<number, number>();
  private lastFlipAt = new Map<number, number>();

  /** Mirrors Game.ts: the cow is claimed by one team until the saddle empties. */
  cowTeam: Team | null = null;
  cowX = W / 2;
  cowFace: 1 | -1 = 1;

  constructor(public whelps: SimWhelp[], gems: Array<[number, number]> = GEM_SPAWNS) {
    this.gems = gems.map(([x, y]) => ({ x, y, alive: true }));
    for (const t of ["blue", "red"] as Team[]) {
      this.slots[t] = new Array(TUNING.slotsToWin).fill(false);
    }
  }

  fill(team: Team, count: number) {
    for (let i = 0; i < count; i++) this.slots[team][i] = true;
  }

  private world(): BotWorld {
    const openSlotXs = (t: Team) => {
      const xs: number[] = [];
      for (let i = 0; i < TUNING.slotsToWin; i++) {
        if (this.slots[t][i]) continue;
        const r = slotRect(t, i);
        xs.push(r.x + r.width / 2);
      }
      return xs;
    };
    return {
      time: this.time,
      wyrmX: this.cowX,
      wyrmFace: this.cowFace,
      cowTeam: this.cowTeam,
      slotsFilled: {
        blue: this.slots.blue.filter(Boolean).length,
        red: this.slots.red.filter(Boolean).length,
      },
      openSlots: { blue: openSlotXs("blue"), red: openSlotXs("red") },
      gems: this.gems.filter((g) => g.alive).map((g) => ({ x: g.x, y: g.y })),
      actors: this.whelps,
    };
  }

  step() {
    for (const w of this.whelps) {
      w.input.jumpEdge = false;
      w.input.actionEdge = false;
    }
    updateBotBrains(this.world());

    for (const w of this.whelps) {
      const dir = Math.sign(w.input.x);
      const prev = this.lastDir.get(w.pid) ?? 0;
      if (dir !== 0 && prev !== 0 && dir !== prev) {
        const since = this.time - (this.lastFlipAt.get(w.pid) ?? -Infinity);
        if (since < 300) {
          this.rapidFlips.set(w.pid, (this.rapidFlips.get(w.pid) ?? 0) + 1);
        }
        this.lastFlipAt.set(w.pid, this.time);
      }
      if (dir !== 0) this.lastDir.set(w.pid, dir);

      // Riders are carried, not self-propelled, and a jump drops them off.
      if (w.riding) {
        if (w.input.jumpEdge) {
          w.riding = false;
          w.vy = -480;
        } else {
          w.x = this.cowX;
          w.y = COW_BACK_Y;
          w.vy = 0;
          w.onGround = false;
          continue;
        }
      }

      if (w.input.jumpEdge && w.onGround) w.vy = TUNING.whelpJump;

      w.vx = w.input.x * TUNING.whelpSpeed;
      w.vy += TUNING.gravity * DT;

      const prevBottom = w.y + WHELP_HALF;
      w.x = Math.min(W - WHELP_HALF, Math.max(WHELP_HALF, w.x + w.vx * DT));
      w.y += w.vy * DT;

      w.onGround = false;
      if (w.vy >= 0) {
        const bottom = w.y + WHELP_HALF;
        for (let i = 0; i < PLATFORMS.length; i++) {
          const [px, py, pw] = PLATFORMS[i];
          if (w.x + WHELP_HALF <= px || w.x - WHELP_HALF >= px + pw) continue;
          // One-way ledges: only catch a body that was above the lip last frame.
          if (prevBottom > py + 1 || bottom < py) continue;
          w.y = py - WHELP_HALF;
          w.vy = 0;
          w.onGround = true;
          break;
        }
      }

      this.collect(w);
      this.deposit(w);
      this.tryMount(w);
    }

    // Riders steer; an empty saddle releases the cow for the next team.
    const riders = this.whelps.filter((w) => w.riding);
    if (riders.length === 0) {
      this.cowTeam = null;
    } else {
      const pull = Math.max(-1, Math.min(1, riders.reduce((s, r) => s + r.input.x, 0)));
      const vx = pull * TUNING.wyrmSpeed;
      this.cowX = Math.max(40, Math.min(W - 40, this.cowX + vx * DT));
      if (Math.abs(vx) > 1) this.cowFace = vx > 0 ? 1 : -1;
    }

    this.time += DT * 1000;
  }

  /** Same rule as Game.ts: land on the back, and one team at a time. */
  private tryMount(w: SimWhelp) {
    if (w.riding || w.vy < 0) return;
    if (Math.abs(w.x - this.cowX) >= 46) return;
    if (Math.abs(w.y - COW_BACK_Y) >= 28) return;
    if (this.cowTeam && this.cowTeam !== w.team) return;
    this.cowTeam = w.team;
    w.riding = true;
  }

  run(ms: number) {
    const steps = Math.round(ms / (DT * 1000));
    for (let i = 0; i < steps; i++) this.step();
  }

  private overlaps(w: SimWhelp, cx: number, cy: number, hx: number, hy: number) {
    return (
      Math.abs(w.x - cx) < WHELP_HALF + hx && Math.abs(w.y - cy) < WHELP_HALF + hy
    );
  }

  private collect(w: SimWhelp) {
    if (w.carrying >= TUNING.carryMax) return;
    for (const g of this.gems) {
      if (!g.alive) continue;
      if (!this.overlaps(w, g.x, g.y, GEM_HALF, GEM_HALF)) continue;
      g.alive = false;
      w.carrying++;
      this.collected.set(w.pid, (this.collected.get(w.pid) ?? 0) + 1);
      return;
    }
  }

  private deposit(w: SimWhelp) {
    if (w.carrying === 0) return;
    for (let i = 0; i < TUNING.slotsToWin; i++) {
      if (this.slots[w.team][i]) continue;
      const r = slotRect(w.team, i);
      if (!this.overlaps(w, r.x + r.width / 2, r.y + r.height / 2, r.width / 2, r.height / 2)) {
        continue;
      }
      this.slots[w.team][i] = true;
      w.carrying--;
      return;
    }
  }
}

/** Centre y a whelp settles at when standing on the given platform top. */
function standingY(platformTop: number) {
  return platformTop - WHELP_HALF;
}

/** Slack for "is it down on the floor", allowing for a hop in progress. */
const PROGRESS_SLACK = 60;

beforeEach(() => resetBotMemory());

describe("carrier reaches the hoard", () => {
  // The ladder platforms a blue carrier can strand itself on above its shelf.
  const ledges: Array<[string, number, number]> = [
    ["outer ladder 490", 250, 490],
    ["outer ladder 400", 150, 400],
    ["outer ladder 310", 300, 310],
    ["outer ladder 225", 165, 225],
    ["centre stack 570", 545, 570],
  ];

  for (const [name, x, top] of ledges) {
    it(`deposits after starting on the ${name}`, () => {
      const w = makeWhelp(1, "blue", x, standingY(top), 1);
      const sim = new Sim([w]);
      sim.run(12000);
      // Banked at least the gem it started with. It may well be holding the
      // next one by now, so the slot count is what matters, not its hands.
      expect(sim.slots.blue.filter(Boolean).length).toBeGreaterThanOrEqual(1);
    });
  }

  it("does not jitter left and right while depositing", () => {
    const w = makeWhelp(1, "blue", 150, standingY(400), 1);
    const sim = new Sim([w]);
    sim.run(12000);
    expect(sim.rapidFlips.get(1) ?? 0).toBeLessThan(5);
  });

  it("still deposits when only late slots are open", () => {
    const w = makeWhelp(1, "blue", 250, standingY(490), 1);
    const sim = new Sim([w]);
    const prefilled = SLOT_COLS + 4;
    sim.fill("blue", prefilled);
    sim.run(12000);
    expect(sim.slots.blue.filter(Boolean).length).toBeGreaterThan(prefilled);
  });
});

describe("gem hunter makes progress", () => {
  it("collects a gem instead of hopping on the spot", () => {
    // Perched high on the outer ladder with the nearby gems already taken, so
    // the only candidates need a route rather than a hop.
    const w = makeWhelp(1, "blue", 165, standingY(225));
    const sim = new Sim(
      [w],
      GEM_SPAWNS.filter(([, gy]) => !(gy === 203 || gy === 288))
    );
    sim.run(12000);
    expect(sim.collected.get(1) ?? 0).toBeGreaterThan(0);
    expect(sim.rapidFlips.get(1) ?? 0).toBeLessThan(5);
  });

  it("gives up on a gem it cannot reach and takes another", () => {
    // One gem sealed under the centre stack plus one easy gem on the ground.
    const w = makeWhelp(1, "blue", 300, standingY(690));
    const sim = new Sim([w], [
      [640, 548],
      [200, 650],
    ]);
    sim.run(12000);
    expect(sim.collected.get(1) ?? 0).toBeGreaterThan(0);
  });

  it("does not park under a ledge it cannot clear", () => {
    const w = makeWhelp(1, "blue", 300, standingY(690));
    const sim = new Sim([w], [[300, 203]]);
    // Track how far it ever gets from the gem it cannot reach. Standing
    // underneath hammering jump is the failure being guarded, so what matters
    // is that it gave up and went somewhere, not where it ended up.
    let ranged = 0;
    for (let i = 0; i < 12000 / (1000 / 60); i++) {
      sim.step();
      ranged = Math.max(ranged, Math.abs(w.x - 300));
    }
    expect(ranged).toBeGreaterThan(150);
  });
});

describe("escort reaches the cow", () => {
  // Escorting kicks in once the gems run out, so give it an empty arena.
  const perches: Array<[string, number, number]> = [
    ["outer ladder 225", 165, 225],
    ["outer ladder 490", 250, 490],
    ["centre stack 330", 640, 330],
  ];

  for (const [name, x, top] of perches) {
    it(`comes down off the ${name} and gets aboard`, () => {
      const w = makeWhelp(1, "blue", x, standingY(top));
      const sim = new Sim([w], []);
      sim.run(10000);
      // Riding proves the whole route: down off the ledge, across, and on.
      expect(w.riding).toBe(true);
    });
  }

  it("does not hop on the spot while stranded", () => {
    const w = makeWhelp(1, "blue", 165, standingY(225));
    const sim = new Sim([w], []);
    sim.run(10000);
    expect(sim.rapidFlips.get(1) ?? 0).toBeLessThan(5);
  });

  it("actually gets aboard rather than standing beside it", () => {
    const w = makeWhelp(1, "blue", 500, standingY(690));
    const sim = new Sim([w], []);
    sim.run(10000);
    expect(w.riding).toBe(true);
    expect(sim.cowTeam).toBe("blue");
  });

  it("leaves an enemy-held cow alone instead of hopping at it", () => {
    const mine = makeWhelp(1, "blue", 500, standingY(690));
    const theirs = makeWhelp(2, "red", 780, standingY(690));
    const sim = new Sim([mine, theirs], []);
    sim.run(10000);
    // Whoever gets there first owns it; the other never shares the saddle.
    expect(mine.riding !== theirs.riding).toBe(true);
    expect(sim.cowTeam).toBe(mine.riding ? "blue" : "red");
  });
});

describe("no bot idles anywhere on the map", () => {
  // Every ledge, both roles, both teams. The reported symptom was several bots
  // frozen on different platforms at once, so cover the whole map rather than
  // the one spot that happened to be screenshotted.
  const spots = PLATFORMS.filter(([, , pw]) => pw < W * 0.9).map(
    ([px, py, pw]) => [Math.round(px + pw / 2), py] as [number, number]
  );

  for (const carrying of [0, 1]) {
    it(`${carrying ? "carriers" : "hunters"} all make progress from every ledge`, () => {
      const stalled: string[] = [];
      for (const [x, top] of spots) {
        for (const team of ["blue", "red"] as Team[]) {
          resetBotMemory();
          const w = makeWhelp(1, team, x, standingY(top), carrying);
          const sim = new Sim([w]);
          const startX = w.x;
          const startY = w.y;
          sim.run(9000);

          const banked = sim.slots[team].filter(Boolean).length;
          const picked = sim.collected.get(1) ?? 0;
          const travelled = Math.abs(w.x - startX) > 80 || Math.abs(w.y - startY) > 80;
          const jittering = (sim.rapidFlips.get(1) ?? 0) >= 5;

          if (jittering || (banked === 0 && picked === 0 && !travelled)) {
            stalled.push(
              `${team} at ${x},${top} banked=${banked} picked=${picked} jitter=${sim.rapidFlips.get(1) ?? 0}`
            );
          }
        }
      }
      expect(stalled).toEqual([]);
    });
  }
});

describe("every gem is reachable", () => {
  // One gem, one bot, every ledge as a starting point. This is the invariant
  // behind the repeated "bot jumping on the spot" reports: a bot that cannot
  // route to the only gem left just hammers jump underneath it.
  const starts = PLATFORMS.filter(([, , pw]) => pw < W * 0.9).map(
    ([px, py, pw]) => [Math.round(px + pw / 2), py] as [number, number]
  );
  // The awkward ones: top of each outer ladder, and the centre stack.
  const targets: Array<[number, number]> = [
    [165, 203],
    [1115, 203],
    [275, 288],
    [1005, 288],
    [155, 378],
    [1125, 378],
    [640, 548],
    [280, 650],
  ];

  /** Same side, which is the real case: bots always pick the nearest gem. */
  const sameSide = ([x]: [number, number], [gx]: [number, number]) =>
    (x < W / 2) === (gx < W / 2);

  it("routes to the only gem on its own side", () => {
    const missed: string[] = [];
    for (const g of targets) {
      for (const s of starts) {
        if (!sameSide(s, g)) continue;
        resetBotMemory();
        const w = makeWhelp(1, "blue", s[0], standingY(s[1]));
        const sim = new Sim([w], [[g[0], g[1]]]);
        sim.run(20000);
        if ((sim.collected.get(1) ?? 0) === 0) {
          missed.push(`from ${s[0]},${s[1]} to gem ${g[0]},${g[1]}`);
        }
      }
    }
    expect(missed).toEqual([]);
  });

  it("never just stalls over a gem on the far side", () => {
    const stalled: string[] = [];
    for (const g of targets) {
      for (const s of starts) {
        if (sameSide(s, g)) continue;
        resetBotMemory();
        const w = makeWhelp(1, "blue", s[0], standingY(s[1]));
        const sim = new Sim([w], [[g[0], g[1]]]);
        sim.run(20000);
        // Crossing for one far gem is optional — escorting the cow instead is a
        // fine answer. Hopping on the spot is not.
        const busy =
          (sim.collected.get(1) ?? 0) > 0 || w.riding || Math.abs(w.x - s[0]) > 300;
        if (!busy || (sim.rapidFlips.get(1) ?? 0) >= 5) {
          stalled.push(`from ${s[0]},${s[1]} to gem ${g[0]},${g[1]}`);
        }
      }
    }
    expect(stalled).toEqual([]);
  });
});

describe("the cow moves when pushed", () => {
  it("rolls toward the pusher's finish line", () => {
    const w = makeWhelp(1, "blue", 500, standingY(690));
    const sim = new Sim([w], []);
    sim.run(12000);
    // Blue drives it left, toward blue's finish.
    expect(sim.cowX).toBeLessThan(W / 2 - 60);
  });

  it("is not stalled by an enemy whelp shoving at it", () => {
    const mine = makeWhelp(1, "blue", 560, standingY(690));
    const theirs = makeWhelp(2, "red", 720, standingY(690));
    const sim = new Sim([mine, theirs], []);
    sim.run(12000);
    // Whoever claimed it keeps driving; the other cannot cancel the push.
    expect(Math.abs(sim.cowX - W / 2)).toBeGreaterThan(60);
  });
});

describe("full team of bots", () => {
  it("banks gems steadily without deadlocking", () => {
    const whelps = [
      makeWhelp(1, "blue", 150, standingY(690)),
      makeWhelp(2, "blue", 250, standingY(490)),
      makeWhelp(3, "blue", 300, standingY(310)),
    ];
    const sim = new Sim(whelps);
    sim.run(25000);
    expect(sim.slots.blue.filter(Boolean).length).toBeGreaterThanOrEqual(3);
  });
});
