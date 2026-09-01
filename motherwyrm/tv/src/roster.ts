import type { InputState, Lobbyist, Net, Role, Team } from "./net";

const BOT_NAMES = [
  "Clank",
  "Rusty",
  "Bolt",
  "Gear",
  "Copper",
  "Brass",
  "Iron",
  "Steel",
  "Piston",
  "Cog",
  "Widget",
  "Servo",
  "Droid",
  "Auto",
  "Mech",
];

let botNameIdx = 0;

function nextBotName(): string {
  const name = BOT_NAMES[botNameIdx % BOT_NAMES.length];
  botNameIdx += 1;
  return name;
}

function assignTeamRole(players: Map<number, Lobbyist>): { team: Team; role: Role } {
  const blues = [...players.values()].filter((p) => p.team === "blue");
  const reds = [...players.values()].filter((p) => p.team === "red");
  const team: Team = blues.length <= reds.length ? "blue" : "red";
  const role: Role =
    (team === "blue" ? blues.length : reds.length) === 0 ? "mother" : "whelp";
  return { team, role };
}

export function addBotPlayer(net: Net, name?: string): Lobbyist {
  const { team, role } = assignTeamRole(net.players);
  const pid = net.allocatePid();
  const p: Lobbyist = {
    pid,
    name: name ?? nextBotName(),
    team,
    role,
    input: { x: 0, y: 0, jump: false, action: false, jumpEdge: false, actionEdge: false },
    bot: true,
  };
  net.players.set(pid, p);
  net.onJoin(p);
  return p;
}

export function addLocalPlayer(net: Net, name = "You"): Lobbyist | null {
  if ([...net.players.values()].some((p) => p.local)) return null;
  if (net.players.size >= 10) return null;
  const { team, role } = assignTeamRole(net.players);
  const pid = net.allocatePid();
  const p: Lobbyist = {
    pid,
    name,
    team,
    role,
    input: { x: 0, y: 0, jump: false, action: false, jumpEdge: false, actionEdge: false },
    local: true,
  };
  net.players.set(pid, p);
  net.onJoin(p);
  return p;
}

/** Fill both teams to five players with robots. */
export function fillWithBots(net: Net): number {
  let added = 0;
  while (net.players.size < 10) {
    const blues = [...net.players.values()].filter((p) => p.team === "blue").length;
    const reds = [...net.players.values()].filter((p) => p.team === "red").length;
    if (blues >= 5 && reds >= 5) break;
    addBotPlayer(net);
    added += 1;
  }
  return added;
}

export function formatPlayerLabel(p: Lobbyist): string {
  const tag = p.role === "mother" ? "★ " : "";
  const suffix = p.bot ? " 🤖" : p.local ? " (you)" : "";
  return `${tag}${p.name}${suffix}`;
}
