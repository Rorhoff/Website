import Phaser from "phaser";
import { Net } from "./net";
import { Lobby } from "./scenes/Lobby";
import { Game } from "./scenes/Game";
import { W, H, COLORS, TUNING } from "./arena";

const net = new Net();
net.connect();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: W,
  height: H,
  backgroundColor: COLORS.sky,
  parent: document.body,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: {
    default: "arcade",
    arcade: { gravity: { x: 0, y: TUNING.gravity }, debug: false },
  },
});

game.scene.add("Lobby", Lobby);
game.scene.add("Game", Game);
game.scene.start("Lobby", { net });
