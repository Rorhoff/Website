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
      wyrmX: W / 2,
      wyrmFace: 1,
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
    }

    this.time += DT * 1000;
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
    ["centre stack 570", 640, 570],
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
    sim.run(12000);
    // Either it found a route up, or it gave up and went somewhere useful.
    // Standing under the gem hammering jump is the failure being guarded.
    const hoppingInPlace = (sim.collected.get(1) ?? 0) === 0 && Math.abs(w.x - 300) < 40;
    expect(hoppingInPlace).toBe(false);
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
    it(`comes down off the ${name}`, () => {
      const w = makeWhelp(1, "blue", x, standingY(top));
      const sim = new Sim([w], []);
      sim.run(10000);
      // On the floor, near the cow at mid-arena, rather than stranded aloft.
      expect(w.y).toBeGreaterThan(standingY(690) - PROGRESS_SLACK);
      expect(Math.abs(w.x - W / 2)).toBeLessThan(120);
    });
  }

  it("does not hop on the spot while stranded", () => {
    const w = makeWhelp(1, "blue", 165, standingY(225));
    const sim = new Sim([w], []);
    sim.run(10000);
    expect(sim.rapidFlips.get(1) ?? 0).toBeLessThan(5);
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
