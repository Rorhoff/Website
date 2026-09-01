import Phaser from "phaser";
import { Net } from "../net";
import { W, H, COLORS } from "../arena";
import { addLocalPlayer, fillWithBots, formatPlayerLabel } from "../roster";

export class Lobby extends Phaser.Scene {
  private net!: Net;
  private codeText!: Phaser.GameObjects.Text;
  private roster!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private autoStartAt = 0;

  constructor() {
    super("Lobby");
  }

  init(data: { net: Net }) {
    this.net = data.net;
  }

  create() {
    this.cameras.main.setBackgroundColor(COLORS.sky);

    this.add.text(W / 2, 72, "MotherWyrm", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "58px",
      fontStyle: "bold",
      color: "#efe4d2",
    }).setOrigin(0.5);

    this.add.text(W / 2, 132, `Phones: ${location.origin}/mw/pad/  ·  or play on keyboard`, {
      fontFamily: "system-ui, sans-serif",
      fontSize: "20px",
      color: "#8b7a66",
    }).setOrigin(0.5);

    this.add.text(W / 2, 168, "R robots · P play as you · Space start", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "18px",
      color: "#7fe3c4",
    }).setOrigin(0.5);

    this.add.text(W / 2, 192, "?debug=assets · anims · collision", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "14px",
      color: "#5a4a3a",
    }).setOrigin(0.5);

    this.codeText = this.add.text(W / 2, 248, "····", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "112px",
      fontStyle: "bold",
      color: "#7fe3c4",
    }).setOrigin(0.5);

    this.roster = this.add.text(W / 2, 400, "", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "22px",
      color: "#efe4d2",
      align: "center",
      lineSpacing: 8,
    }).setOrigin(0.5, 0);

    this.hint = this.add.text(W / 2, H - 56, "Press R to fill with robots.", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "20px",
      color: "#8b7a66",
    }).setOrigin(0.5);

    this.net.onCode = (code) => this.codeText.setText(code);
    this.net.onJoin = () => this.redraw();
    this.net.onLeave = () => this.redraw();
    if (this.net.code) this.codeText.setText(this.net.code);
    this.redraw();

    this.input.keyboard?.on("keydown-R", () => this.addRobots());
    this.input.keyboard?.on("keydown-P", () => this.addHuman());
    this.input.keyboard?.on("keydown-SPACE", () => this.tryStart());
  }

  private addRobots() {
    const added = fillWithBots(this.net);
    if (added === 0 && this.net.players.size >= 10) {
      this.hint.setText("Roster full — Space to start.");
      return;
    }
    this.redraw();
    if (!this.hasHumanPlayer()) {
      this.autoStartAt = this.time.now + 2200;
      this.hint.setText("Robot rumble loading… (Space to start now)");
    } else {
      this.hint.setText("Robots joined. Space to start.");
    }
  }

  private addHuman() {
    const p = addLocalPlayer(this.net, "You");
    if (!p) {
      this.hint.setText("Already playing — or roster is full.");
      return;
    }
    this.autoStartAt = 0;
    this.redraw();
    this.hint.setText("WASD move · Z jump · X action · Space to start");
  }

  private hasHumanPlayer(): boolean {
    return [...this.net.players.values()].some((p) => !p.bot);
  }

  private redraw() {
    const line = (team: "blue" | "red") =>
      [...this.net.players.values()]
        .filter((p) => p.team === team)
        .map((p) => formatPlayerLabel(p))
        .join("   ") || "(empty)";

    this.roster.setText([`Blue   ${line("blue")}`, "", `Red   ${line("red")}`]);
  }

  update() {
    const teams = new Set([...this.net.players.values()].map((p) => p.team));
    const ready = teams.size === 2 && this.net.players.size >= 2;

    if (!ready) {
      this.hint.setText(
        this.net.players.size === 0
          ? "Press R for a full robot match, or P to play yourself."
          : "Need both teams — press R to fill robots."
      );
      return;
    }

    if (this.autoStartAt > 0 && this.time.now >= this.autoStartAt) {
      this.autoStartAt = 0;
      this.tryStart();
      return;
    }

    if (this.hasHumanPlayer()) {
      for (const p of this.net.players.values()) {
        if (p.role === "mother" && p.input.actionEdge) {
          p.input.actionEdge = false;
          this.tryStart();
          return;
        }
      }
      if (!this.hint.text.includes("Space")) {
        this.hint.setText("Space to start · mothers can tap Action on phone");
      }
    }
  }

  private tryStart() {
    const teams = new Set([...this.net.players.values()].map((p) => p.team));
    if (teams.size < 2) return;
    this.autoStartAt = 0;
    this.scene.start("Game", { net: this.net });
  }
}
