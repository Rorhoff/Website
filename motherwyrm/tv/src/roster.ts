import { blankInput } from "./net";
import type { InputState, Lobbyist, Net, Role, Team } from "./net";

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 10;

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
    input: blankInput(),
    bot: true,
  };
  net.players.set(pid, p);
  net.onJoin(p);
  return p;
}

export function addLocalPlayer(net: Net, name = "You"): Lobbyist | null {
  if ([...net.players.values()].some((p) => p.local)) return null;
  if (net.players.size >= MAX_PLAYERS) return null;
  const { team, role } = assignTeamRole(net.players);
  const pid = net.allocatePid();
  const p: Lobbyist = {
    pid,
    name,
    team,
    role,
    input: blankInput(),
    local: true,
  };
  net.players.set(pid, p);
  net.onJoin(p);
  return p;
}

function rosterFull(net: Net): boolean {
  const blues = [...net.players.values()].filter((p) => p.team === "blue").length;
  const reds = [...net.players.values()].filter((p) => p.team === "red").length;
  return net.players.size >= MAX_PLAYERS || (blues >= 5 && reds >= 5);
}

/** Add one robot if there is room on the roster. */
export function addOneBot(net: Net): Lobbyist | null {
  if (rosterFull(net)) return null;
  return addBotPlayer(net);
}

/** Add robots until at least `minimum` players (e.g. before start). */
export function ensureMinimumPlayers(net: Net, minimum = MIN_PLAYERS): number {
  let added = 0;
  while (net.players.size < minimum && !rosterFull(net)) {
    addBotPlayer(net);
    added += 1;
  }
  return added;
}

/** @deprecated Prefer addOneBot / ensureMinimumPlayers. */
export function fillWithBots(net: Net): number {
  return ensureMinimumPlayers(net, MAX_PLAYERS);
}

export function formatPlayerLabel(p: Lobbyist): string {
  const tag = p.role === "mother" ? "★ " : "";
  const away = p.disconnected ? " (away)" : "";
  const suffix = p.bot ? " 🤖" : p.local ? " (you)" : away;
  return `${tag}${p.name}${suffix}`;
}
