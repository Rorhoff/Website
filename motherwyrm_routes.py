"""MotherWyrm — WebSocket relay for TV + phone controllers."""
from __future__ import annotations

import json
import random
from dataclasses import dataclass, field
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["motherwyrm"])

CODE_ALPHABET = "ACDEFGHJKLMNPQRTUVWXY"


@dataclass
class MwPlayer:
    ws: WebSocket | None
    name: str
    team: str | None = None
    role: str | None = None
    disconnected: bool = False


@dataclass
class MwRoom:
    tv: WebSocket
    players: dict[int, MwPlayer] = field(default_factory=dict)
    next_pid: int = 1


rooms: dict[str, MwRoom] = {}


def _make_code() -> str:
    while True:
        code = "".join(random.choices(CODE_ALPHABET, k=4))
        if code not in rooms:
            return code


async def _send(ws: WebSocket | None, msg: dict[str, Any]) -> None:
    if ws is None:
        return
    try:
        await ws.send_json(msg)
    except Exception:
        pass


def _find_reconnect_slot(room: MwRoom, name: str) -> int | None:
    key = name.strip().casefold()
    if not key:
        return None
    for pid, player in room.players.items():
        if player.disconnected and player.name.strip().casefold() == key:
            return pid
    return None


async def _restore_phone_session(
    room: MwRoom, pid: int, ws: WebSocket, player: MwPlayer
) -> None:
    player.ws = ws
    player.disconnected = False
    await _send(ws, {"t": "rejoined", "pid": pid, "name": player.name})
    await _send(room.tv, {"t": "player_rejoin", "pid": pid})
    if player.team and player.role:
        await _send(
            ws,
            {
                "t": "assigned",
                "team": player.team,
                "role": player.role,
                "host": False,
                "name": player.name,
            },
        )


@router.websocket("/api/mw/ws")
async def motherwyrm_ws(ws: WebSocket) -> None:
    await ws.accept()
    meta: dict[str, Any] | None = None

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            t = msg.get("t")

            if t == "host":
                code = _make_code()
                rooms[code] = MwRoom(tv=ws)
                meta = {"kind": "tv", "code": code}
                await _send(ws, {"t": "hosted", "code": code})
                continue

            if t == "join":
                code = str(msg.get("code", "")).upper()
                room = rooms.get(code)
                if not room:
                    await _send(ws, {"t": "error", "reason": "No game with that code."})
                    continue

                name = str(msg.get("name", "Whelp"))[:12]
                reconnect_pid = _find_reconnect_slot(room, name)
                if reconnect_pid is not None:
                    player = room.players[reconnect_pid]
                    meta = {"kind": "phone", "code": code, "pid": reconnect_pid}
                    await _restore_phone_session(room, reconnect_pid, ws, player)
                    continue

                active = sum(1 for p in room.players.values() if not p.disconnected)
                if active >= 10:
                    await _send(ws, {"t": "error", "reason": "That game is full."})
                    continue

                pid = room.next_pid
                room.next_pid += 1
                room.players[pid] = MwPlayer(ws=ws, name=name)
                meta = {"kind": "phone", "code": code, "pid": pid}

                await _send(ws, {"t": "joined", "pid": pid, "name": name})
                await _send(room.tv, {"t": "player_join", "pid": pid, "name": name})
                continue

            if not meta:
                continue

            room = rooms.get(str(meta.get("code", "")))
            if not room:
                continue

            if meta.get("kind") == "tv" and t == "assign":
                player = room.players.get(int(msg.get("pid", 0)))
                if player:
                    player.team = msg.get("team")
                    player.role = msg.get("role")
                    await _send(
                        player.ws,
                        {
                            "t": "assigned",
                            "team": player.team,
                            "role": player.role,
                            "host": bool(msg.get("host")),
                            "name": msg.get("name") or player.name,
                        },
                    )
                continue

            if meta.get("kind") == "tv" and t == "pick_team":
                player = room.players.get(int(msg.get("pid", 0)))
                if player:
                    await _send(
                        player.ws,
                        {
                            "t": "pick_team",
                            "host": bool(msg.get("host")),
                        },
                    )
                continue

            if meta.get("kind") == "tv" and t == "countdown":
                player = room.players.get(int(msg.get("pid", 0)))
                if player:
                    await _send(player.ws, {"t": "countdown", "n": msg.get("n")})
                continue

            if meta.get("kind") == "tv" and t == "game_start":
                player = room.players.get(int(msg.get("pid", 0)))
                if player:
                    await _send(player.ws, {"t": "game_start"})
                continue

            if meta.get("kind") == "tv" and t == "game_end":
                player = room.players.get(int(msg.get("pid", 0)))
                if player:
                    await _send(
                        player.ws,
                        {
                            "t": "game_end",
                            "winner": msg.get("winner"),
                            "reason": msg.get("reason"),
                        },
                    )
                continue

            if meta.get("kind") == "tv" and t == "cue":
                player = room.players.get(int(msg.get("pid", 0)))
                if player:
                    await _send(player.ws, {"t": "cue", "cue": msg.get("cue")})
                continue

            if meta.get("kind") == "phone" and t in ("i", "b"):
                msg["pid"] = meta["pid"]
                await _send(room.tv, msg)
                continue

            if meta.get("kind") == "phone" and t == "pick":
                msg["pid"] = meta["pid"]
                await _send(room.tv, msg)
                continue

            if meta.get("kind") == "phone" and t in ("host_start", "host_fill_bots"):
                msg["pid"] = meta["pid"]
                await _send(room.tv, msg)

    except WebSocketDisconnect:
        pass

    if meta:
        code = str(meta.get("code", ""))
        room = rooms.get(code)
        if room:
            if meta.get("kind") == "tv":
                for player in room.players.values():
                    await _send(player.ws, {"t": "ended"})
                rooms.pop(code, None)
            else:
                pid = int(meta.get("pid", 0))
                player = room.players.get(pid)
                if player:
                    player.ws = None
                    player.disconnected = True
                    await _send(room.tv, {"t": "player_disconnect", "pid": pid})
