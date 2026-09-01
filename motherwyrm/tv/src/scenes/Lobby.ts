import Phaser from "phaser";
import { Net } from "../net";
import { W, H, COLORS } from "../arena";
import { addLocalPlayer, fillWithBots, formatPlayerLabel } from "../roster";
import { padJoinUrl, qrDataUrl } from "../qr";

export class Lobby extends Phaser.Scene {
  private net!: Net;
  private codeText!: Phaser.GameObjects.Text;
  private roster!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private autoStartAt = 0;
  private countingDown = false;
  private countdownOverlay?: Phaser.GameObjects.Text;
  private countdownSub?: Phaser.GameObjects.Text;
  private qrImage?: Phaser.GameObjects.Image;
  private qrCaption?: Phaser.GameObjects.Text;

  constructor() {
    super("Lobby");
  }

  init(data: { net: Net }) {
    this.net = data.net;
  }

  create() {
    this.cameras.main.setBackgroundColor(COLORS.sky);
    this.countingDown = false;

    this.add.text(W / 2, 72, "MotherWyrm", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "58px",
      fontStyle: "bold",
      color: "#efe4d2",
    }).setOrigin(0.5);

    this.add.text(W / 2, 132, "Scan the QR code on your phone · or play on keyboard", {
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

    this.qrCaption = this.add.text(W - 132, 358, "Scan to join", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "16px",
      color: "#8b7a66",
    }).setOrigin(0.5).setVisible(false);

    this.roster = this.add.text(W / 2, 400, "", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "22px",
      color: "#efe4d2",
      align: "center",
      lineSpacing: 8,
    }).setOrigin(0.5, 0);

    this.add.text(W / 2, 528, "Blue button — Jump / Fly", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "17px",
      color: "#4aa3d8",
    }).setOrigin(0.5);

    this.add.text(W / 2, 554, "Red button — Drop gem / Attack", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "17px",
      color: "#e0663f",
    }).setOrigin(0.5);

    this.hint = this.add.text(W / 2, H - 56, "Waiting for players…", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "20px",
      color: "#8b7a66",
    }).setOrigin(0.5);

    this.net.onCode = (code) => {
      this.codeText.setText(code);
      void this.refreshQr(code);
    };
    this.net.onJoin = () => this.redraw();
    this.net.onLeave = () => this.redraw();
    this.net.onHostStart = () => this.tryStart();
    this.net.onHostFillBots = () => this.addRobots();
    if (this.net.code) {
      this.codeText.setText(this.net.code);
      void this.refreshQr(this.net.code);
    }
    this.redraw();

    this.input.keyboard?.on("keydown-R", () => this.addRobots());
    this.input.keyboard?.on("keydown-P", () => this.addHuman());
    this.input.keyboard?.on("keydown-SPACE", () => this.tryStart());
  }

  private async refreshQr(code: string) {
    try {
      const url = padJoinUrl(code, location.origin);
      const dataUrl = await qrDataUrl(url);
      const key = "mw_pad_qr";
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
      if (this.textures.exists(key)) this.textures.remove(key);
      this.textures.addBase64(key, base64);
      this.qrImage?.destroy();
      this.qrImage = this.add.image(W - 132, 268, key)
        .setDisplaySize(148, 148)
        .setDepth(10);
      this.qrCaption?.setVisible(true);
    } catch {
      this.qrCaption?.setText("QR unavailable").setVisible(true);
    }
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
    const host = this.net.hostPid;
    const line = (team: "blue" | "red") =>
      [...this.net.players.values()]
        .filter((p) => p.team === team)
        .map((p) => {
          const label = formatPlayerLabel(p);
          return p.pid === host ? `${label} 👑` : label;
        })
        .join("   ") || "(empty)";

    const pending = this.net.pendingPick.size;
    const lines = [`Blue   ${line("blue")}`, "", `Red   ${line("red")}`];
    if (pending > 0) lines.push(`(${pending} picking a team…)`);
    this.roster.setText(lines);
  }

  update() {
    if (this.countingDown) return;

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
      if (!this.hint.text.includes("Space") && !this.hint.text.includes("countdown")) {
        const hostHint =
          this.net.hostPid != null
            ? "Host can start from phone · Space on TV · mothers tap Action"
            : "Space to start · mothers can tap Action on phone";
        this.hint.setText(hostHint);
      }
    }
  }

  private tryStart() {
    const teams = new Set([...this.net.players.values()].map((p) => p.team));
    if (teams.size < 2 || this.countingDown) return;
    this.countingDown = true;
    this.autoStartAt = 0;
    this.beginCountdown();
  }

  private beginCountdown() {
    this.hint.setText("Rotate phones to landscape…");

    this.countdownOverlay = this.add.text(W / 2, H / 2 - 30, "3", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "200px",
      fontStyle: "bold",
      color: "#efe4d2",
    }).setOrigin(0.5).setDepth(200);

    this.countdownSub = this.add.text(W / 2, H / 2 + 90, "Rotate phones to landscape", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "26px",
      color: "#8b7a66",
    }).setOrigin(0.5).setDepth(200);

    const steps = [3, 2, 1];
    let i = 0;

    const tick = () => {
      if (i >= steps.length) {
        this.countdownOverlay?.destroy();
        this.countdownSub?.destroy();
        this.net.notifyGameStart();
        this.scene.start("Game", { net: this.net });
        return;
      }
      const n = steps[i++];
      this.countdownOverlay?.setText(String(n));
      this.net.notifyCountdown(n);
      this.time.delayedCall(1000, tick);
    };

    tick();
  }
}
