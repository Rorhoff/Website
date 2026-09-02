import { describe, expect, it, vi } from "vitest";
import type { InputState } from "./net";

vi.mock("./arena", () => ({
  W: 1280,
  TUNING: {
    wyrmWin: { blue: 1220, red: 60 },
    slotsToWin: 15,
  },
  HOARD_X: { blue: 70, red: 900 },
  HOARD_WIDTH: 240,
}));

import { pickBestGem, updateBotBrains, type BotWorld } from "./bots";

function blankInput(): InputState {
  return { x: 0, y: 0, jump: false, action: false, jumpEdge: false, actionEdge: false };
}

function world(partial: Partial<BotWorld> & Pick<BotWorld, "actors">): BotWorld {
  return {
    time: 1000,
    wyrmX: 640,
    slotsFilled: { blue: 0, red: 0 },
    gems: [],
    ...partial,
  };
}

describe("pickBestGem", () => {
  it("prefers reachable ground gems over gems far above", () => {
    const gems = [
      { x: 650, y: 260 },
      { x: 640, y: 680 },
    ];
    const pick = pickBestGem(gems, 640, 680);
    expect(pick).toEqual({ x: 640, y: 680 });
  });
});

describe("updateBotBrains", () => {
  it("steers whelp bots toward nearby gems", () => {
    const input = blankInput();
    updateBotBrains(
      world({
        gems: [
          { x: 720, y: 400 },
          { x: 700, y: 380 },
          { x: 740, y: 420 },
          { x: 760, y: 390 },
        ],
        slotsFilled: { blue: 3, red: 0 },
        actors: [
          {
            pid: 1,
            team: "blue",
            role: "whelp",
            x: 640,
            y: 400,
            vy: 0,
            onGround: true,
            carrying: 0,
            riding: false,
            deadUntil: 0,
            stunUntil: 0,
            input,
            bot: true,
          },
        ],
      })
    );
    expect(input.x).toBeGreaterThan(0);
  });

  it("ignores human and dead bots", () => {
    const input = blankInput();
    updateBotBrains(
      world({
        gems: [{ x: 900, y: 400 }],
        actors: [
          {
            pid: 1,
            team: "blue",
            role: "whelp",
            x: 640,
            y: 400,
            vy: 0,
            onGround: true,
            carrying: 0,
            riding: false,
            deadUntil: 0,
            stunUntil: 0,
            input,
            local: true,
          },
          {
            pid: 2,
            team: "red",
            role: "whelp",
            x: 640,
            y: 400,
            vy: 0,
            onGround: true,
            carrying: 0,
            riding: false,
            deadUntil: 9999,
            stunUntil: 0,
            input: blankInput(),
            bot: true,
          },
        ],
      })
    );
    expect(input.x).toBe(0);
  });

  it("steers whelp bots toward the cart when losing the hoard race", () => {
    const input = blankInput();
    updateBotBrains(
      world({
        wyrmX: 800,
        gems: [{ x: 720, y: 400 }],
        slotsFilled: { blue: 1, red: 6 },
        actors: [
          {
            pid: 2,
            team: "blue",
            role: "whelp",
            x: 640,
            y: 400,
            vy: 0,
            onGround: true,
            carrying: 0,
            riding: false,
            deadUntil: 0,
            stunUntil: 0,
            input,
            bot: true,
          },
        ],
      })
    );
    expect(input.x).toBeGreaterThan(0);
  });

  it("mother bots chase the enemy mother", () => {
    const input = blankInput();
    updateBotBrains(
      world({
        actors: [
          {
            pid: 1,
            team: "blue",
            role: "mother",
            x: 200,
            y: 300,
            vy: 0,
            onGround: true,
            carrying: 0,
            riding: false,
            deadUntil: 0,
            stunUntil: 0,
            input,
            bot: true,
          },
          {
            pid: 2,
            team: "red",
            role: "mother",
            x: 500,
            y: 300,
            vy: 0,
            onGround: true,
            carrying: 0,
            riding: false,
            deadUntil: 0,
            stunUntil: 0,
            input: blankInput(),
            bot: true,
          },
        ],
      })
    );
    expect(input.x).toBeGreaterThan(0);
  });
});
