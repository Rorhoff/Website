import Phaser from "phaser";
import { mountBackground } from "../assets";
import { W, H, COLORS } from "../arena";
import { drawCollisionOverlay, overlayLegend } from "../collision-overlay";

export class DebugCollision extends Phaser.Scene {
  private overlay!: Phaser.GameObjects.Graphics;
  private bgOnly = false;

  constructor() {
    super("DebugCollision");
  }

  create() {
    this.cameras.main.setBackgroundColor(COLORS.sky);
    mountBackground(this);

    this.overlay = this.add.graphics().setDepth(50);
    drawCollisionOverlay(this.overlay, { backgroundOnly: this.bgOnly });
    overlayLegend(this);

    this.add
      .text(W / 2, H - 28, "B = toggle background-only overlay", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "14px",
        color: "#8b7a66",
      })
      .setOrigin(0.5);

    this.input.keyboard?.on("keydown-B", () => {
      this.bgOnly = !this.bgOnly;
      drawCollisionOverlay(this.overlay, { backgroundOnly: this.bgOnly });
    });

    this.input.keyboard?.on("keydown-E", () => this.exportPng());

    this.input.keyboard?.on("keydown-ESC", () => {
      const net = this.registry.get("net");
      this.scene.start("Lobby", { net });
    });
  }

  private exportPng() {
    this.game.renderer.snapshot(
      (image: HTMLImageElement) => {
        const link = document.createElement("a");
        link.download = "motherwyrm-collision-overlay.png";
        link.href = image.src;
        link.click();
      },
      "image/png"
    );
  }
}
