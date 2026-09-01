import Phaser from "phaser";
import { ATLAS_MANIFEST, SPRITE_SCALE } from "../asset-manifest";
import { isAtlasLoaded } from "../assets";
import { W, H, COLORS } from "../arena";

export class DebugAnims extends Phaser.Scene {
  constructor() {
    super("DebugAnims");
  }

  create() {
    this.cameras.main.setBackgroundColor(COLORS.sky);

    this.add
      .text(W / 2, 20, "Animation viewer (2×)", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "28px",
        fontStyle: "bold",
        color: "#efe4d2",
      })
      .setOrigin(0.5, 0);

    this.add
      .text(W / 2, 54, "Esc → lobby · baseline drift shows up as floating feet", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "15px",
        color: "#8b7a66",
      })
      .setOrigin(0.5, 0);

    let row = 0;
    let col = 0;
    const colW = 200;
    const rowH = 120;
    const startX = 60;
    const startY = 90;

    for (const entry of ATLAS_MANIFEST) {
      if (entry.expectedTags.length === 0) continue;
      if (!isAtlasLoaded(entry.key)) {
        this.add
          .text(startX + col * colW, startY + row * rowH, `${entry.key}\n(procedural)`, {
            fontFamily: "system-ui, sans-serif",
            fontSize: "12px",
            color: "#8b7a66",
          })
          .setOrigin(0.5, 0);
        col++;
        if (col >= 5) {
          col = 0;
          row++;
        }
        continue;
      }

      for (const tag of entry.expectedTags) {
        const x = startX + col * colW;
        const y = startY + row * rowH;

        const sprite = this.add.sprite(x, y + 40, entry.key).setScale(SPRITE_SCALE);
        if (this.anims.exists(tag)) {
          sprite.play(tag);
        }

        this.add
          .text(x, y, tag.replace(`${entry.key}_`, ""), {
            fontFamily: "ui-monospace, monospace",
            fontSize: "11px",
            color: "#7fe3c4",
          })
          .setOrigin(0.5, 0);

        this.add
          .text(x, y + 88, entry.key, {
            fontFamily: "system-ui, sans-serif",
            fontSize: "10px",
            color: "#8b7a66",
          })
          .setOrigin(0.5, 0);

        col++;
        if (col >= 5) {
          col = 0;
          row++;
        }
      }
    }

    this.input.keyboard?.on("keydown-ESC", () => {
      const net = this.registry.get("net");
      this.scene.start("Lobby", { net });
    });
  }
}
