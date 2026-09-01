import { describe, expect, it } from "vitest";
import { Net } from "./net";

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
      input: { x: 0, y: 0, jump: false, action: false, jumpEdge: false, actionEdge: false },
      bot: true,
    });
    net.players.set(2, {
      pid: 2,
      name: "You",
      team: "blue",
      role: "whelp",
      input: { x: 0, y: 0, jump: false, action: false, jumpEdge: false, actionEdge: false },
      local: true,
    });
    net.players.set(3, {
      pid: 3,
      name: "Phone",
      team: "red",
      role: "whelp",
      input: { x: 0, y: 0, jump: false, action: false, jumpEdge: false, actionEdge: false },
    });

    net.cue(1, "nope");
    net.cue(2, "nope");
    net.cue(3, "go!");
    expect(sent).toBe(1);
  });
});
