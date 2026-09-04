import { describe, expect, it } from "vitest";
import { Net } from "./net";
import {
  addBotPlayer,
  addLocalPlayer,
  addOneBot,
  ensureMinimumPlayers,
  fillWithBots,
  formatPlayerLabel,
  MIN_PLAYERS,
} from "./roster";

function freshNet() {
  return new Net();
}

describe("roster", () => {
  it("fills roster to max with fillWithBots", () => {
    const net = freshNet();
    expect(fillWithBots(net)).toBe(10);
    expect(net.players.size).toBe(10);
  });

  it("addOneBot adds a single robot", () => {
    const net = freshNet();
    expect(addOneBot(net)?.bot).toBe(true);
    expect(net.players.size).toBe(1);
    expect(addOneBot(net)?.bot).toBe(true);
    expect(net.players.size).toBe(2);
  });

  it("ensureMinimumPlayers fills to four from one human", () => {
    const net = freshNet();
    addLocalPlayer(net, "You");
    expect(net.players.size).toBe(1);
    expect(ensureMinimumPlayers(net, MIN_PLAYERS)).toBe(3);
    expect(net.players.size).toBe(MIN_PLAYERS);
    const teams = new Set([...net.players.values()].map((p) => p.team));
    expect(teams.size).toBe(2);
  });

  it("assigns the first player on each team as mother", () => {
    const net = freshNet();
    addBotPlayer(net, "BlueMother");
    addBotPlayer(net, "RedMother");
    addBotPlayer(net, "BlueWhelp");
    const blueMother = [...net.players.values()].find(
      (p) => p.team === "blue" && p.role === "mother"
    );
    const redMother = [...net.players.values()].find(
      (p) => p.team === "red" && p.role === "mother"
    );
    const whelp = [...net.players.values()].find((p) => p.role === "whelp");
    expect(blueMother?.name).toBe("BlueMother");
    expect(redMother?.name).toBe("RedMother");
    expect(whelp?.team).toBe("blue");
  });

  it("allows only one local keyboard player", () => {
    const net = freshNet();
    expect(addLocalPlayer(net, "You")?.local).toBe(true);
    expect(addLocalPlayer(net, "You again")).toBeNull();
    expect([...net.players.values()].filter((p) => p.local)).toHaveLength(1);
  });

  it("formats bot and local labels", () => {
    expect(
      formatPlayerLabel({
        pid: 1,
        name: "Clank",
        team: "blue",
        role: "mother",
        input: { x: 0, y: 0, jump: false, action: false, jumpEdge: false, actionEdge: false },
        bot: true,
      })
    ).toBe("★ Clank 🤖");

    expect(
      formatPlayerLabel({
        pid: 2,
        name: "You",
        team: "red",
        role: "whelp",
        input: { x: 0, y: 0, jump: false, action: false, jumpEdge: false, actionEdge: false },
        local: true,
      })
    ).toBe("You (you)");
  });

  it("allocates unique local pids above phone ids", () => {
    const net = freshNet();
    const bot = addBotPlayer(net);
    const human = addLocalPlayer(net)!;
    expect(bot.pid).toBeGreaterThan(1000);
    expect(human.pid).toBeGreaterThan(bot.pid);
  });
});
