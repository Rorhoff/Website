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
  /** Awaiting team pick before lobby slot is final. */
  pending?: boolean;
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
  /** First phone player to join — runs lobby (bots, start). */
  hostPid: number | null = null;
  pendingPick = new Map<number, string>();

  onCode: (code: string) => void = () => {};
  onJoin: (p: Lobbyist) => void = () => {};
  onLeave: (pid: number) => void = () => {};
  onHostStart: () => void = () => {};
  onHostFillBots: () => void = () => {};

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
          this.handlePhoneJoin(m.pid, m.name);
          break;
        }

        case "player_leave":
          this.players.delete(m.pid);
          this.pendingPick.delete(m.pid);
          if (this.hostPid === m.pid) {
            const next = [...this.players.values()].find((p) => !p.bot && !p.local);
            this.hostPid = next?.pid ?? null;
          }
          this.onLeave(m.pid);
          break;

        case "pick": {
          const team = m.team === "red" ? "red" : "blue";
          this.handleTeamPick(m.pid, team);
          break;
        }

        case "host_start": {
          if (m.pid === this.hostPid) this.onHostStart();
          break;
        }

        case "host_fill_bots": {
          if (m.pid === this.hostPid) this.onHostFillBots();
          break;
        }

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

  sendToPhone(pid: number, msg: Record<string, unknown>) {
    const p = this.players.get(pid);
    if (p?.bot || p?.local) return;
    this.send({ ...msg, pid });
  }

  notifyCountdown(n: number) {
    for (const p of this.players.values()) {
      if (!p.bot && !p.local) {
        this.send({ t: "countdown", pid: p.pid, n });
      }
    }
  }

  notifyGameStart() {
    for (const p of this.players.values()) {
      if (!p.bot && !p.local) {
        this.send({ t: "game_start", pid: p.pid });
      }
    }
  }

  notifyGameEnd(winner: Team, reason: string) {
    for (const p of this.players.values()) {
      if (!p.bot && !p.local) {
        this.send({ t: "game_end", pid: p.pid, winner, reason });
      }
    }
  }

  handlePhoneJoin(pid: number, name: string) {
    if (this.hostPid === null) this.hostPid = pid;

    const motherSlot = this.motherSlotForJoin();
    if (motherSlot) {
      const p: Lobbyist = {
        pid,
        name,
        team: motherSlot.team,
        role: "mother",
        input: blank(),
      };
      this.players.set(pid, p);
      this.sendAssign(pid, p);
      this.onJoin(p);
      return;
    }

    this.pendingPick.set(pid, name);
    this.send({ t: "pick_team", pid, host: pid === this.hostPid });
  }

  handleTeamPick(pid: number, team: Team) {
    const name = this.pendingPick.get(pid);
    if (!name) return;

    const resolved = this.resolveWhelpTeam(team);
    if (!resolved) return;

    this.pendingPick.delete(pid);
    const p: Lobbyist = {
      pid,
      name,
      team: resolved,
      role: "whelp",
      input: blank(),
    };
    this.players.set(pid, p);
    this.sendAssign(pid, p);
    this.onJoin(p);
  }

  private sendAssign(pid: number, p: Lobbyist) {
    this.send({
      t: "assign",
      pid,
      team: p.team,
      role: p.role,
      host: pid === this.hostPid,
      name: p.name,
    });
  }

  private motherSlotForJoin(): { team: Team; role: "mother" } | null {
    const blues = [...this.players.values()].filter((p) => p.team === "blue");
    const reds = [...this.players.values()].filter((p) => p.team === "red");
    const blueMother = blues.some((p) => p.role === "mother");
    const redMother = reds.some((p) => p.role === "mother");
    if (!blueMother) return { team: "blue", role: "mother" };
    if (!redMother) return { team: "red", role: "mother" };
    return null;
  }

  private resolveWhelpTeam(preferred: Team): Team | null {
    const blue = [...this.players.values()].filter((p) => p.team === "blue").length;
    const red = [...this.players.values()].filter((p) => p.team === "red").length;
    if (blue >= 5 && red >= 5) return null;
    if (blue >= 5) return "red";
    if (red >= 5) return "blue";
    if (preferred === "blue" && blue < 5) return "blue";
    if (preferred === "red" && red < 5) return "red";
    return blue <= red ? "blue" : "red";
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }
}
