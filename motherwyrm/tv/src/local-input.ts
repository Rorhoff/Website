import Phaser from "phaser";
import type { Net } from "./net";

/** WASD / arrows + Z jump, X action for the local keyboard player. */
export function applyLocalKeyboard(
  net: Net,
  keys: Phaser.Types.Input.Keyboard.KeyboardPlugin | null | undefined
) {
  const local = [...net.players.values()].find((p) => p.local);
  if (!local || !keys) return;

  const left = keys.addKey("A").isDown || keys.addKey("LEFT").isDown;
  const right = keys.addKey("D").isDown || keys.addKey("RIGHT").isDown;
  const up = keys.addKey("W").isDown || keys.addKey("UP").isDown;
  const down = keys.addKey("S").isDown || keys.addKey("DOWN").isDown;

  let x = 0;
  if (left) x -= 1;
  if (right) x += 1;

  let y = 0;
  if (up) y -= 1;
  if (down) y += 1;

  local.input.x = x;
  local.input.y = y;

  const jumpKey = keys.addKey("Z");
  const actionKey = keys.addKey("X");
  const jumpAlt = keys.addKey("SPACE");

  if (Phaser.Input.Keyboard.JustDown(jumpKey) || Phaser.Input.Keyboard.JustDown(jumpAlt)) {
    local.input.jumpEdge = true;
  }
  local.input.jump = jumpKey.isDown || jumpAlt.isDown;

  if (Phaser.Input.Keyboard.JustDown(actionKey)) {
    local.input.actionEdge = true;
  }
  local.input.action = actionKey.isDown;
}
