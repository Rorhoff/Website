import Phaser from "phaser";
import { ATLAS_MANIFEST, IMAGE_MANIFEST } from "../asset-manifest";
import { getAtlasStatuses } from "../assets";
import { W, H, COLORS } from "../arena";

export class DebugAssets extends Phaser.Scene {
  constructor() {
    super("DebugAssets");
  }

  create() {
    this.cameras.main.setBackgroundColor(COLORS.sky);

    this.add
      .text(W / 2, 28, "Asset status", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "32px",
        fontStyle: "bold",
        color: "#efe4d2",
      })
      .setOrigin(0.5, 0);

    this.add
      .text(W / 2, 68, "Esc → lobby · missing atlases fall back to procedural sprites", {
        fontFamily: "system-ui, sans-serif",
        fontSize: "16px",
        color: "#8b7a66",
      })
      .setOrigin(0.5, 0);

    const lines: string[] = [];
    const statuses = getAtlasStatuses();

    for (const s of statuses) {
      const stateLabel = s.state === "loaded" ? "loaded" : "procedural";
      lines.push(`${s.key}: ${stateLabel}`);
      if (s.state === "loaded" && s.expectedTags.length > 0) {
        lines.push(`  tags found: ${s.foundTags.length}/${s.expectedTags.length}`);
        if (s.missingTags.length > 0) {
          lines.push(`  MISSING: ${s.missingTags.join(", ")}`);
        }
      }
    }

    for (const img of IMAGE_MANIFEST) {
      const s = statuses.find((x) => x.key === img.key);
      lines.push(`${img.key}: ${s?.state ?? "procedural"}`);
    }

    this.add
      .text(40, 110, lines.join("\n"), {
        fontFamily: "ui-monospace, monospace",
        fontSize: "15px",
        color: "#efe4d2",
        lineSpacing: 6,
      })
      .setDepth(10);

    this.add
      .text(40, H - 48, `Manifest: ${ATLAS_MANIFEST.length} atlases · ${IMAGE_MANIFEST.length} images`, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "14px",
        color: "#7fe3c4",
      });

    this.input.keyboard?.on("keydown-ESC", () => {
      const net = this.registry.get("net");
      this.scene.start("Lobby", { net });
    });
  }
}
