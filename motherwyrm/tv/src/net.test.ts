import { describe, expect, it, vi } from "vitest";
import { blankInput, Net } from "./net";

function mockNet() {
  const net = new Net();
  let sent: unknown[] = [];
  (net as unknown as { send: (msg: unknown) => void }).send = (msg) => {
    sent.push(msg);
  };
  return { net, sent: () => sent, clearSent: () => { sent = []; } };
}

describe("phone join assignment", () => {
  it("first joiner is blue mother and host", () => {
    const { net, sent } = mockNet();
    net.handlePhoneJoin(1, "Alpha");
    expect(net.hostPid).toBe(1);
    const p = net.players.get(1);
    expect(p?.team).toBe("blue");
    expect(p?.role).toBe("mother");
    expect(sent()).toEqual([
      expect.objectContaining({ t: "assign", team: "blue", role: "mother", host: true }),
    ]);
  });

  it("second joiner is red mother", () => {
    const { net, sent } = mockNet();
    net.handlePhoneJoin(1, "Alpha");
    sent().length = 0;
    net.handlePhoneJoin(2, "Beta");
    const p = net.players.get(2);
    expect(p?.team).toBe("red");
    expect(p?.role).toBe("mother");
    expect(sent()).toEqual([
      expect.objectContaining({ t: "assign", team: "red", role: "mother", host: false }),
    ]);
  });

  it("third joiner must pick a team", () => {
    const { net, sent } = mockNet();
    net.handlePhoneJoin(1, "Alpha");
    net.handlePhoneJoin(2, "Beta");
    sent().length = 0;
    net.handlePhoneJoin(3, "Gamma");
    expect(net.players.has(3)).toBe(false);
    expect(net.pendingPick.get(3)).toBe("Gamma");
    expect(sent()).toEqual([expect.objectContaining({ t: "pick_team", pid: 3 })]);
  });

  it("team pick assigns whelp and auto-fills full team", () => {
    const { net, sent } = mockNet();
    net.handlePhoneJoin(1, "Alpha");
    net.handlePhoneJoin(2, "Beta");
    net.handlePhoneJoin(3, "Gamma");
    for (let i = 4; i <= 7; i++) {
      net.handlePhoneJoin(i, `P${i}`);
      net.handleTeamPick(i, "blue");
    }
    sent().length = 0;
    net.handlePhoneJoin(8, "Last");
    expect(sent()).toEqual([expect.objectContaining({ t: "pick_team", pid: 8 })]);
    net.handleTeamPick(8, "blue");
    expect(net.players.get(8)?.team).toBe("red");
  });
});

describe("button presses", () => {
  it("banks every press even when a release goes missing", () => {
    const { net } = mockNet();
    net.handlePhoneJoin(1, "Alpha");
    const input = net.players.get(1)!.input;

    net.handleButton(1, "jump", true);
    net.handleButton(1, "jump", false);
    expect(input.jumpPresses).toBe(1);

    // Release dropped in transit, so the level flag stays high.
    net.handleButton(1, "jump", true);
    net.handleButton(1, "jump", true);
    expect(input.jump).toBe(true);
    expect(input.jumpPresses).toBe(3);
  });

  it("counts taps that land inside a single frame", () => {
    const { net } = mockNet();
    net.handlePhoneJoin(1, "Alpha");
    const input = net.players.get(1)!.input;

    for (let i = 0; i < 3; i++) {
      net.handleButton(1, "action", true);
      net.handleButton(1, "action", false);
    }
    expect(input.actionPresses).toBe(3);
    expect(input.action).toBe(false);
  });
});

describe("Net local players", () => {
  it("cue skips bots and local keyboard players", () => {
    const net = new Net();
    let sent = 0;
    (net as unknown as { send: (msg: unknown) => void }).send = () => {
      sent += 1;
    };

    net.players.set(1, {
      pid: 1,
      name: "Bot",
      team: "blue",
      role: "whelp",
      input: blankInput(),
      bot: true,
    });
    net.players.set(2, {
      pid: 2,
      name: "You",
      team: "blue",
      role: "whelp",
      input: blankInput(),
      local: true,
    });
    net.players.set(3, {
      pid: 3,
      name: "Phone",
      team: "red",
      role: "whelp",
      input: blankInput(),
    });

    net.cue(1, "nope");
    net.cue(2, "nope");
    net.cue(3, "go!");
    expect(sent).toBe(1);
  });
});
