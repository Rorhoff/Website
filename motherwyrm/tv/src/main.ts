import Phaser from "phaser";
import { Net } from "./net";
import { Boot } from "./scenes/Boot";
import { Lobby } from "./scenes/Lobby";
import { Game } from "./scenes/Game";
import { DebugAssets } from "./scenes/DebugAssets";
import { DebugAnims } from "./scenes/DebugAnims";
import { DebugCollision } from "./scenes/DebugCollision";
import { W, H, COLORS, TUNING } from "./arena";

const net = new Net();
net.connect();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: W,
  height: H,
  backgroundColor: COLORS.sky,
  parent: document.body,
  pixelArt: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: {
    default: "arcade",
    arcade: { gravity: { x: 0, y: TUNING.gravity }, debug: false },
  },
});

game.registry.set("net", net);

game.scene.add("Boot", Boot);
game.scene.add("Lobby", Lobby);
game.scene.add("Game", Game);
game.scene.add("DebugAssets", DebugAssets);
game.scene.add("DebugAnims", DebugAnims);
game.scene.add("DebugCollision", DebugCollision);
game.scene.start("Boot");
