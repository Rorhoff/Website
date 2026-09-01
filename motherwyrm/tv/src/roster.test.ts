import { describe, expect, it } from "vitest";
import { Net } from "./net";
import {
  addBotPlayer,
  addLocalPlayer,
  fillWithBots,
  formatPlayerLabel,
} from "./roster";

function freshNet() {
  return new Net();
}

describe("roster", () => {
  it("fills both teams with ten robots", () => {
    const net = freshNet();
    expect(fillWithBots(net)).toBe(10);
    expect(net.players.size).toBe(10);
    const blues = [...net.players.values()].filter((p) => p.team === "blue");
    const reds = [...net.players.values()].filter((p) => p.team === "red");
    expect(blues).toHaveLength(5);
    expect(reds).toHaveLength(5);
    expect(blues.filter((p) => p.role === "mother")).toHaveLength(1);
    expect(reds.filter((p) => p.role === "mother")).toHaveLength(1);
    expect([...net.players.values()].every((p) => p.bot)).toBe(true);
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
