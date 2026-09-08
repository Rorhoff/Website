import Phaser from "phaser";
import { Net } from "../net";
import { allMaps, loadPublishedMaps, pickRandomMap, findMapById, type LoadedMapEntry } from "../maps/load";
import { W, H, COLORS } from "../arena";
import { addLocalPlayer, addOneBot, ensureMinimumPlayers, formatPlayerLabel, MIN_PLAYERS } from "../roster";
import { padJoinUrl, qrDataUrl } from "../qr";

export class Lobby extends Phaser.Scene {
  private net!: Net;
  private codeText!: Phaser.GameObjects.Text;
  private roster!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private countingDown = false;
  private countdownOverlay?: Phaser.GameObjects.Text;
  private countdownSub?: Phaser.GameObjects.Text;
  private qrImage?: Phaser.GameObjects.Image;
  private qrCaption?: Phaser.GameObjects.Text;

  private mapLabels: Phaser.GameObjects.Text[] = [];
  private selectedMap: LoadedMapEntry | null = null;
  private mapHint!: Phaser.GameObjects.Text;
  private mapTitle!: Phaser.GameObjects.Text;

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

    this.add.text(W / 2, 168, "R add robot · P play as you · Space start", {
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

    this.add.text(W / 2, 582, "Keyboard: WASD · Z jump/fly · X attack  ·  Nip the cow from behind & herd it to your finish line", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "14px",
      color: "#8b7a66",
    }).setOrigin(0.5);

    this.hint = this.add.text(W / 2, H - 56, "Waiting for players…", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "20px",
      color: "#8b7a66",
    }).setOrigin(0.5);

    this.selectedMap = null;
    this.buildMapSelect();

    this.net.onCode = (code) => {
      this.codeText.setText(code);
      void this.refreshQr(code);
    };
    this.net.onJoin = () => this.redraw();
    this.net.onLeave = () => this.redraw();
    this.net.onDisconnect = () => this.redraw();
    this.net.onRejoin = () => this.redraw();
    this.net.onHostStart = () => this.tryStart();
    this.net.onHostFillBots = () => this.addRobots();
    this.net.onHostMap = (id) => {
      this.applyMapChoice(id === null ? null : findMapById(id) ?? null, false);
    };
    if (this.net.code) {
      this.codeText.setText(this.net.code);
      void this.refreshQr(this.net.code);
    }
    this.redraw();

    this.input.keyboard?.on("keydown-R", () => this.addRobots());
    this.input.keyboard?.on("keydown-P", () => this.addHuman());
    this.input.keyboard?.on("keydown-SPACE", () => this.tryStart());
  }

  private buildMapSelect() {
    this.mapTitle = this.add.text(W / 2, 608, "Map", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "26px",
      fontStyle: "bold",
      color: "#efe4d2",
    }).setOrigin(0.5);

    this.mapHint = this.add.text(W / 2, 642, "", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "16px",
      color: "#7fe3c4",
    }).setOrigin(0.5);

    const maps = allMaps();
    const cols = Math.min(maps.length + 1, 4);
    const startX = W / 2 - ((cols - 1) * 140) / 2;
    let x = startX;
    const y = 678;

    const randomLabel = this.add.text(x, y, "🎲 Random", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "17px",
      color: "#7fe3c4",
    }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
    randomLabel.on("pointerdown", () => this.applyMapChoice(null, true));
    this.mapLabels.push(randomLabel);
    x += 140;

    for (const entry of maps) {
      const label = this.add.text(x, y, entry.map.name, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "16px",
        color: "#8b7a66",
        wordWrap: { width: 120 },
        align: "center",
      }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
      label.on("pointerdown", () => this.applyMapChoice(entry, true));
      this.mapLabels.push(label);
      x += 140;
    }
    this.refreshMapSelect();
  }

  private applyMapChoice(entry: LoadedMapEntry | null, broadcast: boolean) {
    this.selectedMap = entry;
    this.refreshMapSelect();
    if (broadcast) {
      this.net.broadcastMapPick(entry?.map.id ?? null, entry?.map.name ?? "Random");
    }
  }

  private refreshMapSelect() {
    const name = this.selectedMap?.map.name ?? "Random";
    const mode = this.selectedMap ? "Fixed map for this match" : "Random from published pool";
    this.mapHint.setText(`Selected: ${name} · ${mode}`);
    for (const label of this.mapLabels) {
      const isRandom = label.text.startsWith("🎲");
      const selected =
        (isRandom && !this.selectedMap)
        || (!isRandom && this.selectedMap && label.text === this.selectedMap.map.name);
      label.setColor(selected ? "#7fe3c4" : isRandom ? "#7fe3c4" : "#8b7a66");
      label.setAlpha(selected || isRandom ? 1 : 0.75);
    }
  }

  private resolveArena() {
    if (this.selectedMap) return this.selectedMap.arena;
    return pickRandomMap()?.arena;
  }

  private refreshQr(code: string) {
    const url = padJoinUrl(code, location.origin);
    void qrDataUrl(url).then((dataUrl) => {
      const img = new Image();
      img.onload = () => {
        if (!this.scene.isActive()) return;
        const key = "mw_pad_qr";
        if (this.textures.exists(key)) this.textures.remove(key);
        this.textures.addImage(key, img);
        this.qrImage?.destroy();
        this.qrImage = this.add.image(W - 132, 268, key)
          .setDisplaySize(148, 148)
          .setDepth(10);
        this.qrCaption?.setVisible(true);
      };
      img.onerror = () => {
        this.qrCaption?.setText("QR unavailable").setVisible(true);
      };
      img.src = dataUrl;
    }).catch(() => {
      this.qrCaption?.setText("QR unavailable").setVisible(true);
    });
  }

  private addRobots() {
    const bot = addOneBot(this.net);
    if (!bot) {
      this.hint.setText("Roster full — Space to start.");
      return;
    }
    this.redraw();
    this.hint.setText(`Robot joined (${this.net.players.size}/${MIN_PLAYERS} min). Space to start.`);
  }

  private addHuman() {
    const p = addLocalPlayer(this.net, "You");
    if (!p) {
      this.hint.setText("Already playing — or roster is full.");
      return;
    }
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
    const count = this.net.players.size;

    if (count === 0) {
      this.hint.setText("Press R to add a robot, or P to play yourself.");
      return;
    }

    if (teams.size < 2) {
      this.hint.setText(
        count >= 1 && this.hasHumanPlayer()
          ? `Start adds robots for both teams (${MIN_PLAYERS} players min).`
          : "Need both teams — press R to add a robot."
      );
      return;
    }

    if (count < MIN_PLAYERS) {
      this.hint.setText(
        `Need ${MIN_PLAYERS} players to start — start will add ${MIN_PLAYERS - count} robot(s).`
      );
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
    if (this.countingDown) return;
    ensureMinimumPlayers(this.net, MIN_PLAYERS);
    this.redraw();

    const teams = new Set([...this.net.players.values()].map((p) => p.team));
    if (teams.size < 2 || this.net.players.size < MIN_PLAYERS) return;

    this.countingDown = true;
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
        this.scene.start("Game", { net: this.net, arena: this.resolveArena() });
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
