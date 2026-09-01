export type Team = "blue" | "red";
export type Role = "mother" | "whelp";

export interface InputState {
  x: number;
  y: number;
  jump: boolean;
  action: boolean;
  jumpEdge: boolean;
  actionEdge: boolean;
}

export interface Lobbyist {
  pid: number;
  name: string;
  team: Team;
  role: Role;
  input: InputState;
  /** Simulated phone player — no WebSocket. */
  bot?: boolean;
  /** Keyboard player on the TV. */
  local?: boolean;
}

const blank = (): InputState => ({
  x: 0,
  y: 0,
  jump: false,
  action: false,
  jumpEdge: false,
  actionEdge: false,
});

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/api/mw/ws`;
}

/** TV-side socket: hosts the room and receives phone input. */
export class Net {
  code = "";
  players = new Map<number, Lobbyist>();

  onCode: (code: string) => void = () => {};
  onJoin: (p: Lobbyist) => void = () => {};
  onLeave: (pid: number) => void = () => {};

  private ws!: WebSocket;
  private localPid = 1000;

  allocatePid(): number {
    this.localPid += 1;
    return this.localPid;
  }

  connect(url?: string) {
    this.ws = new WebSocket(url ?? wsUrl());

    this.ws.addEventListener("open", () => this.send({ t: "host" }));

    this.ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data as string);

      switch (m.t) {
        case "hosted":
          this.code = m.code;
          this.onCode(m.code);
          break;

        case "player_join": {
          const blues = [...this.players.values()].filter((p) => p.team === "blue");
          const reds = [...this.players.values()].filter((p) => p.team === "red");
          const team: Team = blues.length <= reds.length ? "blue" : "red";
          const role: Role =
            (team === "blue" ? blues.length : reds.length) === 0 ? "mother" : "whelp";

          const p: Lobbyist = { pid: m.pid, name: m.name, team, role, input: blank() };
          this.players.set(m.pid, p);
          if (!p.bot && !p.local) {
            this.send({ t: "assign", pid: m.pid, team, role });
          }
          this.onJoin(p);
          break;
        }

        case "player_leave":
          this.players.delete(m.pid);
          this.onLeave(m.pid);
          break;

        case "i": {
          const p = this.players.get(m.pid);
          if (p) {
            p.input.x = m.x;
            p.input.y = m.y;
          }
          break;
        }

        case "b": {
          const p = this.players.get(m.pid);
          if (!p) break;
          const down = m.d === 1;
          if (m.k === "jump") {
            if (down && !p.input.jump) p.input.jumpEdge = true;
            p.input.jump = down;
          } else {
            if (down && !p.input.action) p.input.actionEdge = true;
            p.input.action = down;
          }
          break;
        }
      }
    });
  }

  cue(pid: number, text: string) {
    const p = this.players.get(pid);
    if (p?.bot || p?.local) return;
    this.send({ t: "cue", pid, cue: text });
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }
}
