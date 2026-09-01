import Phaser from "phaser";
import { finalizeAssets, queueAssetLoads } from "../assets";
import { Net } from "../net";

/** Loads atlases with procedural fallbacks, then routes to Lobby or a debug scene. */
export class Boot extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  preload() {
    queueAssetLoads(this.load);
  }

  create() {
    finalizeAssets(this);

    const debug = new URLSearchParams(location.search).get("debug");
    const net = this.registry.get("net") as Net;

    if (debug === "assets") {
      this.scene.start("DebugAssets");
      return;
    }
    if (debug === "anims") {
      this.scene.start("DebugAnims");
      return;
    }
    if (debug === "collision") {
      this.scene.start("DebugCollision");
      return;
    }

    this.scene.start("Lobby", { net });
  }
}
