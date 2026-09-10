import Phaser from 'phaser';
import { Net, Lobbyist, Team } from '../net';
import { forgetBotMemory, resetBotMemory, updateBotBrains, type BotWorld } from '../bots';
import { applyLocalKeyboard } from '../local-input';
import {
  actorAtlasKey,
  actorTextureKey,
  applyActorScale,
  applyCowScale,
  gemTextureKey,
  getGemAnchor,
  mountBackground,
  mountMapBackground,
  tryPlayAnim,
  wyrmTextureKey,
} from '../assets';
import { drawCollisionOverlay } from '../collision-overlay';
import { formatPlayerLabel } from '../roster';
import { mothersClash, pickWhelpRespawn } from '../spawn';
import { builtinArena, hasGroundPlatform, hasLeftWall, hasRightWall, type LoadedArena } from '../maps/apply';
import {
  W, H, COLORS, TUNING, SLOT_SIZE, slotRect as layoutSlotRect,
  COW_HALF_H, COW_BACK_DY, COW_HEAD_DX, COW_HEAD_DY, COW_PUSH_REACH, COW_BUTT_MIN,
  COW_SHOULDER_ABOVE_FEET, WHELP_HALF,
} from '../arena';

type Sprite = Phaser.Physics.Arcade.Sprite;

interface Actor extends Lobbyist {
  sprite: Sprite;
  atlasKey: string;
  facing: 1 | -1;
  carrying: number;
  carriedGem?: Phaser.GameObjects.Image;
  hp: number;
  deaths: number;
  stunUntil: number;
  invulnUntil: number;
  deadUntil: number;
  attackUntil: number;
  attackStart: number;
  attackCooldownUntil: number;
  attackDir: Phaser.Math.Vector2;
  diving: boolean;
  shortDive: boolean;
  diveFromY: number;
  lungeUntil: number;
  flapUntil: number;
  puntUntil: number;
  riding: boolean;
  disconnected: boolean;
  label: Phaser.GameObjects.Text;
}

const OTHER: Record<Team, Team> = { blue: 'red', red: 'blue' };
const HEX: Record<Team, string> = { blue: '#4aa3d8', red: '#e0663f' };

export class Game extends Phaser.Scene {
  private net!: Net;
  private actors: Actor[] = [];
  private platforms!: Phaser.Physics.Arcade.StaticGroup;
  private gems!: Phaser.Physics.Arcade.Group;
  private slots: Record<Team, boolean[]> = { blue: [], red: [] };
  private slotGfx!: Phaser.GameObjects.Graphics;
  private fx!: Phaser.GameObjects.Graphics;

  private wyrm!: Phaser.Physics.Arcade.Sprite;
  private finishGfx!: Phaser.GameObjects.Graphics;

  private hudBlue!: Phaser.GameObjects.Text;
  private hudRed!: Phaser.GameObjects.Text;
  private hudWyrm!: Phaser.GameObjects.Text;
  private over = false;
  private returningToLobby = false;
  private continueKey?: Phaser.Input.Keyboard.Key;
  private showCollision = false;
  private collisionGfx!: Phaser.GameObjects.Graphics;

  private cowFacing: 1 | -1 = 1;
  private cowStompStart = 0;
  private cowStompHit = false;
  private cowStompCooldownUntil = 0;
  /**
   * The cow answers to one team at a time. Letting both aboard meant their
   * steering summed to zero and the cow simply parked, so a push looked broken
   * rather than contested. Taking it off a team means knocking them off.
   */
  private cowTeam: Team | null = null;
  private cowTakenCueAt = new Map<number, number>();
  /** Only one herder nips the cow at a time; others use normal whelp speed. */
  private activeCowPusherPid: number | null = null;

  private static readonly COW_DEPTH = 12;
  private static readonly COW_PUSHER_DEPTH = 10;
  private static readonly COW_FRONT_DEPTH = 14;

  private arena!: LoadedArena;
  private slotCount = TUNING.slotsToWin;

  constructor() { super('Game'); }

  init(data: { net: Net; arena?: LoadedArena }) {
    this.net = data.net;
    this.arena = data.arena ?? builtinArena();
    this.slotCount = this.arena.slotsToWin;
  }

  // ------------------------------------------------------------------ setup

  create() {
    this.over = false;
    this.actors = [];
    resetBotMemory();
    this.slots = { blue: new Array(this.slotCount).fill(false), red: new Array(this.slotCount).fill(false) };
    this.cameras.main.setBackgroundColor(COLORS.sky);
    this.physics.world.setBounds(0, 0, W, H);

    const sceneryUrl = this.arena.map.sprites?.background;
    if (sceneryUrl) {
      mountMapBackground(this, sceneryUrl);
    } else {
      mountBackground(this);
    }
    this.collisionGfx = this.add.graphics().setDepth(100).setVisible(false);

    this.buildPlatforms();
    this.slotGfx = this.add.graphics();
    this.drawSlots();

    this.gems = this.physics.add.group({ bounceX: 0.35, bounceY: 0.3, dragX: 140 });
    this.physics.add.collider(this.gems, this.platforms);
    this.arena.gemSpawns.forEach((_, i) => this.spawnGem(i));

    this.buildWyrm();
    this.drawFinishLines();
    this.buildActors();

    this.fx = this.add.graphics();
    const hudStyle = { fontFamily: 'system-ui, sans-serif', fontSize: '21px', lineSpacing: 4 };
    this.hudBlue = this.add.text(28, 18, '', { ...hudStyle, color: HEX.blue }).setDepth(50);
    this.hudRed = this.add.text(W - 28, 18, '', { ...hudStyle, color: HEX.red })
      .setOrigin(1, 0).setDepth(50);
    this.hudWyrm = this.add.text(W / 2, 18, '', { ...hudStyle, color: '#c9a25e', align: 'center' })
      .setOrigin(0.5, 0).setDepth(50);

    this.net.onLeave = (pid) => {
      const i = this.actors.findIndex((a) => a.pid === pid);
      if (i >= 0) {
        this.actors[i].carriedGem?.destroy();
        this.actors[i].sprite.destroy();
        this.actors[i].label.destroy();
        this.actors.splice(i, 1);
      }
    };

    this.net.onDisconnect = (pid) => {
      const a = this.actors.find((x) => x.pid === pid);
      if (!a) return;
      a.disconnected = true;
      a.diving = false;
      a.shortDive = false;
      a.input.x = 0;
      a.input.y = 0;
      a.input.jump = false;
      a.input.action = false;
      a.label.setText(`${a.name} (away)`);
      a.sprite.setAlpha(0.45);
    };

    this.net.onRejoin = (pid) => {
      const a = this.actors.find((x) => x.pid === pid);
      if (!a) return;
      a.disconnected = false;
      a.label.setText(a.name);
      a.sprite.setAlpha(a.invulnUntil > this.time.now ? 0.55 : 1);
      this.net.cue(pid, 'Back in the fight!');
    };

    this.input.keyboard?.on('keydown-F3', () => {
      this.showCollision = !this.showCollision;
      this.collisionGfx.setVisible(this.showCollision);
      if (this.showCollision) drawCollisionOverlay(this.collisionGfx);
    });

    this.continueKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.net.onHostContinue = () => this.returnToLobby();
  }

  private mapSlotRect(team: Team, i: number) {
    const slots = this.arena.hoardSlots[team];
    const s = slots.find((x) => x.index === i) ?? slots[i];
    if (s) return new Phaser.Geom.Rectangle(s.x, s.y, SLOT_SIZE, SLOT_SIZE);
    return layoutSlotRect(team, i);
  }

  private buildPlatforms() {
    this.platforms = this.physics.add.staticGroup();
    this.arena.platforms.forEach(([x, y, w, h], idx) => {
      const r = this.add.rectangle(x + w / 2, y + h / 2, w, h, COLORS.soil)
        .setStrokeStyle(2, COLORS.soilLip);
      this.platforms.add(r);
      const body = r.body as Phaser.Physics.Arcade.StaticBody;
      body.updateFromGameObject();
      if (idx > 0) {
        body.checkCollision.down = false;
        body.checkCollision.left = false;
        body.checkCollision.right = false;
      }
    });
    for (const [x, y, w, h] of this.arena.walls) {
      const r = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0x3d3228).setStrokeStyle(1, 0x8b7a66);
      this.platforms.add(r);
      (r.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
    }
  }

  private buildWyrm() {
    this.finishGfx = this.add.graphics().setDepth(11);
    const key = wyrmTextureKey();
    const feetY = this.arena.cowGroundY;
    this.wyrm = this.physics.add
      .sprite(W / 2, feetY - COW_HALF_H, key)
      .setDepth(12);
    applyCowScale(this.wyrm);
    const wb = this.wyrm.body as Phaser.Physics.Arcade.Body;
    wb.setSize(52, 40);
    wb.setAllowGravity(false);
    this.wyrm.setImmovable(true);
    tryPlayAnim(this.wyrm, 'wyrm', 'idle');
  }

  private drawFinishLines() {
    const g = this.finishGfx;
    g.clear();
    const top = this.arena.cowGroundY - this.arena.cowFinishHeight;
    const bottom = this.arena.cowGroundY;

    g.lineStyle(5, COLORS.blue, 0.9);
    g.lineBetween(this.arena.wyrmWin.blue, top, this.arena.wyrmWin.blue, bottom);
    g.lineStyle(3, COLORS.blue, 0.45);
    g.strokeRect(this.arena.wyrmWin.blue - 2, top, 4, bottom - top);

    g.lineStyle(5, COLORS.red, 0.9);
    g.lineBetween(this.arena.wyrmWin.red, top, this.arena.wyrmWin.red, bottom);
    g.lineStyle(3, COLORS.red, 0.45);
    g.strokeRect(this.arena.wyrmWin.red - 2, top, 4, bottom - top);

    const labelStyle = {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '15px',
      fontStyle: 'bold' as const,
    };
    this.add.text(this.arena.wyrmWin.blue + 8, top - 10, 'BLUE\nFINISH', {
      ...labelStyle,
      color: HEX.blue,
      align: 'left',
    }).setOrigin(0, 1).setDepth(12);
    this.add.text(this.arena.wyrmWin.red - 8, top - 10, 'RED\nFINISH', {
      ...labelStyle,
      color: HEX.red,
      align: 'right',
    }).setOrigin(1, 1).setDepth(12);
  }

  private buildActors() {
    for (const p of this.net.players.values()) {
      const atlasKey = actorAtlasKey(p.role, p.team);
      const key = actorTextureKey(p.role, p.team);
      const spawn = this.arena.spawns[p.team].main;
      const sprite = this.physics.add.sprite(spawn.x, spawn.y, key);
      applyActorScale(sprite, p.role);
      sprite.setCollideWorldBounds(p.role !== 'mother');
      const body = sprite.body as Phaser.Physics.Arcade.Body;
      body.setGravityY(
        p.role === 'mother' ? TUNING.motherGravity - TUNING.gravity : 0
      );
      if (p.role === 'mother') {
        // Hitbox sits above the feet anchor (origin 0.5, 1).
        body.setSize(28, 36);
        body.setOffset(-14, -36);
      }
      this.physics.add.collider(sprite, this.platforms);

      const label = this.add.text(0, 0, p.name, {
        fontFamily: 'system-ui, sans-serif', fontSize: '13px', color: HEX[p.team],
      }).setOrigin(0.5, 1).setDepth(40);

      this.actors.push({
        ...p, sprite, atlasKey, label,
        facing: p.team === 'blue' ? 1 : -1,
        carrying: 0,
        hp: TUNING.motherHp,
        deaths: 0,
        stunUntil: 0, invulnUntil: 0, deadUntil: 0,
        attackUntil: 0, attackStart: 0, attackCooldownUntil: 0,
        attackDir: new Phaser.Math.Vector2(1, 0),
        diving: false, shortDive: false, diveFromY: 0,
        lungeUntil: 0, flapUntil: 0, puntUntil: 0, riding: false,
        disconnected: Boolean(p.disconnected),
      });
    }
  }

  private spawnGem(index: number) {
    const [x, y] = this.arena.gemSpawns[index]!;
    const key = gemTextureKey();
    const c = this.gems.create(x, y, key) as Sprite;
    if (key === 'props') c.setFrame(0);
    c.setData('spawn', index);
    c.setCollideWorldBounds(true);
  }

  // ----------------------------------------------------------------- update

  update(time: number, delta: number) {
    if (this.over) {
      this.pollVictoryContinue();
      return;
    }

    // Hand each banked phone press its own frame so none are lost to a burst,
    // but only on a frame the actor can read it. Spending a press while it is
    // dead, stunned or away throws it away silently, and the player is left
    // jabbing a button that looks broken.
    for (const a of this.actors) {
      if (!this.canReadInput(a, time)) continue;
      if (a.input.jumpPresses > 0) { a.input.jumpPresses--; a.input.jumpEdge = true; }
      if (a.input.actionPresses > 0) { a.input.actionPresses--; a.input.actionEdge = true; }
    }

    applyLocalKeyboard(this.net, this.input.keyboard);
    updateBotBrains(this.buildBotWorld(time));

    this.refreshCowPushState();
    for (const a of this.actors) this.updateActor(a, time, delta);

    this.updateWyrm();
    this.updateCowStomp(time);
    this.updateGems(time);
    this.resolveCombat(time);
    this.updateActorDepths();
    this.drawCow();
    this.drawHud();
    this.checkWin();

    // Edge flags live exactly one frame.
    for (const a of this.actors) { a.input.jumpEdge = false; a.input.actionEdge = false; }
  }

  private buildBotWorld(time: number): BotWorld {
    const slotCount = (t: Team) => this.slots[t].filter(Boolean).length;
    const openSlotXs = (t: Team) => {
      const xs: number[] = [];
      for (let i = 0; i < this.slotCount; i++) {
        if (this.slots[t][i]) continue;
        const r = this.mapSlotRect(t, i);
        xs.push(r.x + r.width / 2);
      }
      return xs;
    };
    const gems: Array<{ x: number; y: number }> = [];
    for (const child of this.gems.getChildren()) {
      const s = child as Sprite;
      if (s.active) gems.push({ x: s.x, y: s.y });
    }
    return {
      time,
      wyrmX: this.wyrm.x,
      wyrmFace: this.cowFace(),
      cowTeam: this.cowTeam,
      activeCowPusherPid: this.activeCowPusherPid,
      slotsFilled: { blue: slotCount('blue'), red: slotCount('red') },
      openSlots: { blue: openSlotXs('blue'), red: openSlotXs('red') },
      gems,
      actors: this.actors.map((a) => {
        const body = a.sprite.body as Phaser.Physics.Arcade.Body;
        return {
          pid: a.pid,
          team: a.team,
          role: a.role,
          x: a.sprite.x,
          y: a.sprite.y,
          vy: body.velocity.y,
          onGround: body.blocked.down || body.touching.down,
          carrying: a.carrying,
          riding: a.riding,
          deadUntil: a.deadUntil,
          stunUntil: a.stunUntil,
          input: a.input,
          bot: a.bot,
        };
      }),
    };
  }

  /** A frame on which this actor's update will actually reach its input. */
  private canReadInput(a: Actor, time: number): boolean {
    return !a.disconnected && a.deadUntil <= time && a.stunUntil <= time;
  }

  /** Death and respawn must not inherit a lunge, dive, or cooldown — she reads as broken until they expire. */
  private resetMotherCombat(a: Actor, time: number) {
    a.diving = false;
    a.shortDive = false;
    a.attackUntil = 0;
    a.attackStart = 0;
    a.lungeUntil = 0;
    a.flapUntil = 0;
    a.attackCooldownUntil = time;
  }

  private updateActor(a: Actor, time: number, _delta: number) {
    const body = a.sprite.body as Phaser.Physics.Arcade.Body;

    if (a.disconnected) {
      a.input.x = 0;
      a.input.y = 0;
      a.input.jump = false;
      a.input.action = false;
    }

    // Dead actors: hidden until respawn timer fires.
    if (a.deadUntil > time) {
      a.label.setVisible(false);
      a.sprite.setVisible(false);
      return;
    }
    if (a.deadUntil !== 0 && a.deadUntil <= time) {
      a.deadUntil = 0;
      body.enable = true;
      body.setVelocity(0, 0);
      if (a.role === 'mother') {
        a.hp = TUNING.motherHp;
        a.invulnUntil = time + TUNING.motherInvulnMs;
        this.resetMotherCombat(a, time);
        a.sprite.setPosition(this.arena.spawns[a.team].main.x, this.arena.spawns[a.team].main.y).setVisible(true);
      } else {
        a.invulnUntil = time + TUNING.whelpInvulnMs;
        const enemy = this.enemyMotherPos(a.team, time);
        const pt = pickWhelpRespawn(a.team, enemy, TUNING.spawnCampRadius, this.arena.spawns[a.team].backup);
        a.sprite.setPosition(pt.x, pt.y).setVisible(true);
      }
    }

    const labelY =
      a.role === 'mother'
        ? a.sprite.y - a.sprite.displayHeight - 4
        : a.sprite.y - a.sprite.displayHeight / 2 - 4;
    a.label.setVisible(true).setPosition(a.sprite.x, labelY);
    const baseAlpha = a.disconnected ? 0.45 : 1;
    a.sprite.setAlpha(a.invulnUntil > time ? Math.min(baseAlpha, 0.55) : baseAlpha);

    if (a.disconnected) return;

    if (a.role === 'whelp') {
      this.syncCarriedGem(a);
      if (a.stunUntil <= time && a.deadUntil <= time) {
        if (!body.blocked.down) {
          tryPlayAnim(a.sprite, a.atlasKey, body.velocity.y < 0 ? 'jump' : 'fall');
        } else if (Math.abs(a.input.x) > 0.3) {
          tryPlayAnim(a.sprite, a.atlasKey, 'run');
        } else {
          tryPlayAnim(a.sprite, a.atlasKey, 'idle');
        }
      }
      if (a.carrying > 0) {
        a.label.setText(`${a.name} ◆`);
      } else {
        a.label.setText(a.name);
      }
    }

    if (a.stunUntil > time) { a.sprite.setAngle(Math.sin(time / 40) * 14); return; }
    a.sprite.setAngle(0);

    if (Math.abs(a.input.x) > 0.3) a.facing = a.input.x > 0 ? 1 : -1;
    a.sprite.setFlipX(a.facing < 0);

    if (a.riding) {
      a.riding = false;
      const body = a.sprite.body as Phaser.Physics.Arcade.Body;
      body.setAllowGravity(true);
    }

    if (a.role === 'mother') this.updateMother(a, time, body);
    else this.updateWhelp(a, time, body);
  }

  private updateWhelp(a: Actor, time: number, body: Phaser.Physics.Arcade.Body) {
    const goalDir: 1 | -1 = a.team === 'blue' ? -1 : 1;
    const shoulderY = this.cowFeetY() - COW_SHOULDER_ABOVE_FEET;
    const dx = this.wyrm.x - a.sprite.x;
    const behind = goalDir < 0 ? dx > COW_BUTT_MIN : dx < -COW_BUTT_MIN;
    const wouldPush =
      (body.blocked.down || body.touching.down) &&
      behind &&
      Math.abs(dx) <= COW_PUSH_REACH &&
      Math.abs(a.sprite.y - shoulderY) <= 34 &&
      Math.abs(a.input.x) >= 0.3 &&
      Math.sign(a.input.x) === goalDir;
    const pushing = wouldPush && a.pid === this.activeCowPusherPid;

    let vx = a.input.x * TUNING.whelpSpeed;
    if (wouldPush && !pushing) vx = 0;
    else if (pushing) vx = goalDir * TUNING.wyrmSpeed;
    else if (
      (body.blocked.down || body.touching.down) &&
      Math.abs(a.sprite.y - (this.cowFeetY() - WHELP_HALF)) < 36 &&
      Math.abs(a.sprite.x - this.wyrm.x) < 44 &&
      !behind
    ) {
      // On the cow's back or head — step to the rear flank instead of stacking.
      vx = (a.team === 'blue' ? -1 : 1) * TUNING.whelpSpeed;
    }
    body.setVelocityX(vx);

    const floorY = this.cowFeetY() - WHELP_HALF;
    const nearCow =
      Math.abs(this.wyrm.x - a.sprite.x) <= 175 && a.sprite.y >= floorY - 130;
    if (a.input.jumpEdge && body.blocked.down && !nearCow) {
      body.setVelocityY(TUNING.whelpJump);
    }

    // Punting and throwing are airborne moves. That is the timing window.
    if (a.input.actionEdge && !body.blocked.down) {
      if (a.carrying > 0) {
        a.carrying--;
        const key = gemTextureKey();
        const c = this.gems.create(a.sprite.x + a.facing * 20, a.sprite.y - 10, key) as Sprite;
        if (key === 'props') c.setFrame(0);
        c.setData('spawn', Phaser.Math.Between(0, this.arena.gemSpawns.length - 1));
        c.setCollideWorldBounds(true);
        c.setVelocity(a.facing * TUNING.throwPower, -320);
        this.syncCarriedGem(a);
      } else {
        a.puntUntil = time + TUNING.puntWindowMs;
      }
    }

    if (a.puntUntil > time) this.resolvePunt(a);
  }

  private updateMother(a: Actor, time: number, body: Phaser.Physics.Arcade.Body) {
    if (a.diving) {
      // The dive ends on the timer, on its distance cap, the instant she
      // touches down — or on a fly tap. Landing must drop the pose immediately
      // or she reads as frozen mid-attack.
      //
      // The bail matters as much as the rest: a dive used to hold the controls
      // for its whole duration, so a fly tap during one went nowhere and the
      // button itself got the blame. Falling through from here spends that same
      // press on thrust below, which is what the player was asking for.
      const bail = a.input.jumpEdge;
      const landed = body.blocked.down && body.velocity.y >= 0;
      const dropped = a.sprite.y - a.diveFromY;
      if (!bail && time < a.attackUntil && !landed && dropped < TUNING.motherDiveMaxDrop) {
        tryPlayAnim(a.sprite, a.atlasKey, 'dive');
        return;
      }
      a.diving = false;
      a.shortDive = false;
      a.attackUntil = Math.min(a.attackUntil, time);
      a.lungeUntil = Math.min(a.lungeUntil, time);
      if (landed) {
        this.diveImpact(a);
      } else {
        // Spend the plunge here. Left running it carries her to the floor and
        // the dive reads as full-screen however short the timer is.
        body.setVelocity(body.velocity.x * 0.3, Math.min(body.velocity.y, 0));
      }
      // Fall through so this same frame restores flight control and pose.
    }

    if (a.lungeUntil > time) {
      body.setVelocityX(Phaser.Math.Linear(body.velocity.x, a.input.x * TUNING.motherSpeed * 0.35, 0.15));
      return;
    }

    body.setVelocityX(a.input.x * TUNING.motherSpeed);

    if (a.input.jumpEdge) {
      body.setVelocityY(Math.max(body.velocity.y + TUNING.motherThrust, TUNING.motherThrustCap));
      a.flapUntil = time + TUNING.motherFlapMs;
      this.puff(a.sprite.x, a.sprite.y + 22);
    }

    if (a.flapUntil > time) {
      tryPlayAnim(a.sprite, a.atlasKey, 'flap_down', false);
    } else if (!body.blocked.down) {
      tryPlayAnim(a.sprite, a.atlasKey, 'flap');
    } else {
      tryPlayAnim(a.sprite, a.atlasKey, 'idle');
    }

    if (a.input.actionEdge && time >= a.attackCooldownUntil) {
      let dx = a.input.x;
      let dy = a.input.y;
      const stickMag = Math.hypot(dx, dy);
      if (stickMag < 0.3) {
        dx = a.facing;
        dy = 0;
      } else {
        dx /= stickMag;
        dy /= stickMag;
        if (dy < 0) dy = 0;
      }
      if (Math.abs(dx) > 0.1) a.facing = dx > 0 ? 1 : -1;

      a.attackStart = time;
      a.attackCooldownUntil = time + TUNING.motherAttackCooldownMs;

      // A dive needs air underneath. Standing on the floor it swings level instead.
      if (body.blocked.down && dy > 0.35) {
        dy = 0;
        if (Math.abs(dx) < 0.1) dx = a.facing;
      }

      if (dy > 0.35) {
        a.diving = true;
        a.shortDive = true;
        a.diveFromY = a.sprite.y;
        a.attackUntil = time + TUNING.motherDiveMs;
        a.lungeUntil = time + TUNING.motherDiveMs;
        a.attackDir.set(dx, dy);
        if (a.attackDir.length() > 0) a.attackDir.normalize();
        const spd = TUNING.motherDiveSpeed;
        body.setVelocity(dx * spd, dy * spd);
        tryPlayAnim(a.sprite, a.atlasKey, 'dive');
      } else {
        const mag = Math.hypot(dx, dy) || 1;
        dx /= mag;
        dy /= mag;
        a.attackDir.set(dx, dy);
        a.attackUntil = time + TUNING.swipeMs;
        a.lungeUntil = time + TUNING.motherLungeMs;
        body.setVelocity(dx * TUNING.motherLungeSpeed, dy * TUNING.motherLungeSpeed);
        tryPlayAnim(a.sprite, a.atlasKey, 'claw');
      }
    }

    this.wrapSpriteX(a.sprite);
    this.wrapSpriteY(a.sprite);
  }

  private wrapSpriteY(sprite: Phaser.Physics.Arcade.Sprite) {
    if (hasGroundPlatform(this.arena)) return;
    if (sprite.y > H + 24) {
      sprite.y = -24;
      const body = sprite.body as Phaser.Physics.Arcade.Body;
      body.setVelocityY(Math.min(body.velocity.y, 0));
    }
  }

  private wrapSpriteX(sprite: Phaser.Physics.Arcade.Sprite) {
    const blockLeft = hasLeftWall(this.arena);
    const blockRight = hasRightWall(this.arena, W);
    if (!blockLeft && sprite.x < 0) sprite.x += W;
    else if (!blockRight && sprite.x > W) sprite.x -= W;
  }

  private dismount(a: Actor, vy: number) {
    a.riding = false;
    const body = a.sprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(true);
    body.setVelocityY(vy);
  }

  private cowFeetY() {
    return this.arena.cowGroundY;
  }

  // ------------------------------------------------------------------- wyrm

  private cowFace(): 1 | -1 {
    // Latched, not read live: the cow is held at zero velocity mid-stomp, and a
    // live read would swing its head to the right in the middle of the swing.
    return this.cowFacing;
  }

  /** Team holding the cow. Its own herders never get stomped. */
  private cowPushTeam(): Team | null {
    return this.cowTeam;
  }

  /**
   * Herders on the ground nip the cow from behind — no saddle. Two wyrms
   * walking inward from opposite flanks summed to zero and the herd never moved.
   */
  private whelpInFrontOfCow(a: Actor): boolean {
    if (a.role !== 'whelp' || a.deadUntil > this.time.now) return false;
    if (a.team === this.cowPushTeam()) return false;
    const cx = this.wyrm.x;
    const feetY = this.cowFeetY();
    const face = this.cowFace();
    const dx = a.sprite.x - cx;
    const forward = face > 0 ? dx : -dx;
    if (forward < 10 || forward > 90) return false;
    if (Math.abs(a.sprite.y - (feetY - COW_SHOULDER_ABOVE_FEET)) > 34) return false;
    const body = a.sprite.body as Phaser.Physics.Arcade.Body;
    return body.blocked.down || body.touching.down || a.sprite.y >= feetY - 40;
  }

  /** Herder at the cow's rear flank — draw behind the cow so the head can stomp. */
  private whelpBehindCow(a: Actor): boolean {
    if (a.role !== 'whelp' || a.deadUntil > this.time.now) return false;
    const shoulderY = this.cowFeetY() - COW_SHOULDER_ABOVE_FEET;
    const dx = this.wyrm.x - a.sprite.x;
    const goalDir: 1 | -1 = a.team === 'blue' ? -1 : 1;
    const behind = goalDir < 0 ? dx > COW_BUTT_MIN : dx < -COW_BUTT_MIN;
    if (!behind || Math.abs(dx) > COW_PUSH_REACH) return false;
    if (Math.abs(a.sprite.y - shoulderY) > 34) return false;
    const body = a.sprite.body as Phaser.Physics.Arcade.Body;
    return body.blocked.down || body.touching.down;
  }

  private updateActorDepths() {
    for (const a of this.actors) {
      if (a.role !== 'whelp') continue;
      if (this.whelpBehindCow(a)) {
        a.sprite.setDepth(Game.COW_PUSHER_DEPTH);
        a.label.setDepth(Game.COW_PUSHER_DEPTH + 1);
      } else if (this.whelpInFrontOfCow(a)) {
        a.sprite.setDepth(Game.COW_FRONT_DEPTH);
        a.label.setDepth(Game.COW_FRONT_DEPTH + 1);
      } else {
        a.sprite.setDepth(0);
        a.label.setDepth(40);
      }
    }
  }

  /**
   * One team owns the cow; one herder on that team nips it. Opposite-flank
   * herders get a cue instead of wyrm speed, so two wyrms never cancel out.
   */
  private refreshCowPushState() {
    const stomping = this.cowStompStart > 0;
    const candidates = stomping ? [] : this.cowPushers();

    if (candidates.length === 0) {
      this.cowTeam = null;
      this.activeCowPusherPid = null;
      return;
    }

    if (this.cowTeam === null) this.cowTeam = candidates[0].team;

    for (const p of candidates) {
      if (p.team !== this.cowTeam) this.cueCowTaken(p);
    }

    const teamPushers = candidates.filter((p) => p.team === this.cowTeam);
    if (teamPushers.length === 0) {
      this.cowTeam = null;
      this.activeCowPusherPid = null;
      return;
    }

    let best = teamPushers[0];
    let bestDx = Math.abs(this.wyrm.x - best.sprite.x);
    for (const p of teamPushers.slice(1)) {
      const dx = Math.abs(this.wyrm.x - p.sprite.x);
      if (dx < bestDx) {
        best = p;
        bestDx = dx;
      }
    }
    this.activeCowPusherPid = best.pid;
  }

  private updateCowStomp(time: number) {
    const downMs = TUNING.cowStompDownMs;
    const upMs = TUNING.cowStompUpMs;

    // A loose cow does not stomp. Whoever reaches it first is there to push it
    // (see cowPushers), and trampling that herder made an unclaimed cow lethal
    // to approach for both teams at once — so nobody could ever start moving it.
    if (this.cowTeam === null && this.cowStompStart === 0) return;

    if (this.cowStompStart > 0) {
      const elapsed = time - this.cowStompStart;
      if (elapsed >= downMs && elapsed < downMs + upMs) {
        if (!this.cowStompHit) {
          this.cowStompHit = true;
          this.applyCowStompKill(time);
        }
      } else if (elapsed >= downMs + upMs) {
        this.cowStompStart = 0;
        this.cowStompHit = false;
        this.cowStompCooldownUntil = time + TUNING.cowStompCooldownMs;
      }
      return;
    }

    if (time < this.cowStompCooldownUntil) return;

    for (const a of this.actors) {
      if (a.invulnUntil > time) continue;
      if (!this.whelpInFrontOfCow(a)) continue;
      this.cowStompStart = time;
      this.cowStompHit = false;
      return;
    }
  }

  private applyCowStompKill(time: number) {
    const face = this.cowFace();
    const headX = this.wyrm.x + face * COW_HEAD_DX;
    const headY = this.wyrm.y + COW_HEAD_DY;
    const pushing = this.cowPushTeam();

    for (const a of this.actors) {
      if (a.role !== 'whelp' || a.riding || a.deadUntil > time || a.invulnUntil > time) continue;
      if (a.team === pushing) continue;
      if (Phaser.Math.Distance.Between(a.sprite.x, a.sprite.y, headX, headY) > 46) continue;
      this.killWhelp(a, time, 0, 'The cow stomped you! Respawning…');
    }
    this.cameras.main.shake(90, 0.004);
  }

  /**
   * Herders behind the cow, nipping it toward their finish. The head faces
   * travel; only the rear flank counts, so snipping at the butt reads right.
   */
  private cowPushers(): Actor[] {
    const now = this.time.now;
    const shoulderY = this.cowFeetY() - COW_SHOULDER_ABOVE_FEET;
    const out: Actor[] = [];

    for (const a of this.actors) {
      if (a.role !== 'whelp') continue;
      if (a.deadUntil > now || a.stunUntil > now || a.disconnected) continue;
      const body = a.sprite.body as Phaser.Physics.Arcade.Body;
      if (!body.blocked.down && !body.touching.down) continue;

      const dx = this.wyrm.x - a.sprite.x;
      const goalDir: 1 | -1 = a.team === 'blue' ? -1 : 1;
      const behind = goalDir < 0 ? dx > COW_BUTT_MIN : dx < -COW_BUTT_MIN;
      if (!behind || Math.abs(dx) > COW_PUSH_REACH) continue;
      if (Math.abs(a.sprite.y - shoulderY) > 34) continue;

      if (Math.abs(a.input.x) < 0.3) continue;
      if (Math.sign(a.input.x) !== goalDir) continue;
      out.push(a);
    }
    return out;
  }

  private updateWyrm() {
    const stomping = this.cowStompStart > 0;
    const pusher =
      !stomping && this.activeCowPusherPid !== null
        ? this.actors.find((a) => a.pid === this.activeCowPusherPid)
        : undefined;

    if (pusher) {
      const pull = pusher.input.x;
      const vx = Phaser.Math.Clamp(pull, -1, 1) * TUNING.wyrmSpeed;
      this.wyrm.setVelocityX(vx);
      if (Math.abs(vx) > 1) this.cowFacing = vx > 0 ? 1 : -1;
    } else {
      this.wyrm.setVelocityX(0);
    }
    this.wrapSpriteX(this.wyrm);
    this.wyrm.y = this.wyrm.y + (this.cowFeetY() - COW_HALF_H - this.wyrm.y) * 0.35;
    this.wyrm.setDepth(Game.COW_DEPTH);
  }

  /** Throttled, because the refusal is tested on every frame of contact. */
  private cueCowTaken(a: Actor) {
    const now = this.time.now;
    if (now - (this.cowTakenCueAt.get(a.pid) ?? -Infinity) < 1500) return;
    this.cowTakenCueAt.set(a.pid, now);
    this.net.cue(a.pid, 'The cow is taken — get behind it and nip it first.');
  }

  // --------------------------------------------------------------- gems

  private updateGems(_time: number) {
    for (const obj of this.gems.getChildren() as Sprite[]) {
      if (!obj.active) continue;
      const bounds = obj.getBounds();

      // A gem that lands in an empty slot fills it, whoever threw it.
      let consumed = false;
      for (const team of ['blue', 'red'] as Team[]) {
        for (let i = 0; i < this.slotCount; i++) {
          if (this.slots[team][i]) continue;
          if (Phaser.Geom.Intersects.RectangleToRectangle(bounds, this.mapSlotRect(team, i))) {
            this.slots[team][i] = true;
            this.consumeGem(obj);
            this.drawSlots();
            consumed = true;
            break;
          }
        }
        if (consumed) break;
      }
      if (consumed) continue;

      // Otherwise a whelp with room in its arms scoops it up on contact.
      for (const a of this.actors) {
        if (a.role === 'mother' || a.carrying >= TUNING.carryMax) continue;
        if (a.stunUntil > this.time.now || a.deadUntil > 0) continue;
        if (Phaser.Geom.Intersects.RectangleToRectangle(bounds, a.sprite.getBounds())) {
          a.carrying++;
          this.consumeGem(obj);
          this.syncCarriedGem(a);
          break;
        }
      }
    }

    // Running across your own empty slot deposits one without any aiming.
    for (const a of this.actors) {
      if (a.role === 'mother' || a.carrying === 0) continue;
      for (let i = 0; i < this.slotCount; i++) {
        if (this.slots[a.team][i]) continue;
        if (Phaser.Geom.Intersects.RectangleToRectangle(a.sprite.getBounds(), this.mapSlotRect(a.team, i))) {
          this.slots[a.team][i] = true;
          a.carrying--;
          this.drawSlots();
          this.syncCarriedGem(a);
          break;
        }
      }
    }
  }

  private consumeGem(obj: Sprite) {
    obj.destroy();
  }

  private dropOneCarried(a: Actor) {
    if (a.carrying <= 0) return;
    a.carrying--;
    const key = gemTextureKey();
    const c = this.gems.create(a.sprite.x, a.sprite.y - 12, key) as Sprite;
    if (key === 'props') c.setFrame(0);
    c.setData('spawn', Phaser.Math.Between(0, this.arena.gemSpawns.length - 1));
    c.setCollideWorldBounds(true);
    c.setVelocity(Phaser.Math.Between(-260, 260), -340);
    this.syncCarriedGem(a);
  }

  private dropCarried(a: Actor) {
    while (a.carrying > 0) this.dropOneCarried(a);
  }

  private syncCarriedGem(a: Actor) {
    if (a.role === 'mother') return;
    if (a.carrying > 0) {
      if (!a.carriedGem) {
        const key = gemTextureKey();
        a.carriedGem = this.add.image(0, 0, key);
        if (key === 'props') a.carriedGem.setFrame(0);
        a.carriedGem.setDepth(a.sprite.depth + 1);
      }
      a.carriedGem.setVisible(true);
      const anchor = getGemAnchor(a.atlasKey);
      a.carriedGem.setPosition(
        a.sprite.x + anchor.x * a.facing,
        a.sprite.y + anchor.y
      );
    } else {
      a.carriedGem?.setVisible(false);
    }
  }

  // ---------------------------------------------------------------- combat

  private resolvePunt(a: Actor) {
    const reach = TUNING.puntReach;

    for (const obj of this.gems.getChildren() as Sprite[]) {
      if (!obj.active) continue;
      if (Phaser.Math.Distance.Between(a.sprite.x, a.sprite.y, obj.x, obj.y) > reach) continue;
      obj.setVelocity(a.facing * TUNING.puntPower, -380);
      a.puntUntil = 0;
      this.puff(obj.x, obj.y);
      return;
    }

    for (const t of this.actors) {
      if (t.team === a.team || t.carrying === 0) continue;
      if (Phaser.Math.Distance.Between(a.sprite.x, a.sprite.y, t.sprite.x, t.sprite.y) > reach) continue;
      this.dropOneCarried(t);
      a.puntUntil = 0;
      this.puff(t.sprite.x, t.sprite.y);
      return;
    }
  }

  private motherAttackPoint(a: Actor) {
    return {
      x: a.sprite.x + a.attackDir.x * TUNING.swipeReach,
      y: a.sprite.y + a.attackDir.y * TUNING.swipeReach,
    };
  }

  private motherClash(a: Actor, b: Actor, time: number) {
    const ab = a.sprite.body as Phaser.Physics.Arcade.Body;
    const bb = b.sprite.body as Phaser.Physics.Arcade.Body;
    const sep = Math.sign(a.sprite.x - b.sprite.x) || 1;
    ab.setVelocity(-sep * TUNING.motherClashRecoil, -200);
    bb.setVelocity(sep * TUNING.motherClashRecoil, -200);
    a.attackUntil = time;
    b.attackUntil = time;
    a.lungeUntil = time;
    b.lungeUntil = time;
    a.diving = false;
    b.diving = false;
    a.shortDive = false;
    b.shortDive = false;
    this.puff((a.sprite.x + b.sprite.x) / 2, (a.sprite.y + b.sprite.y) / 2);
    this.cameras.main.shake(90, 0.004);
  }

  private resolveCombat(time: number) {
    const mothers = this.actors.filter(
      (a) => a.role === 'mother' && a.attackUntil > time && a.deadUntil <= time
    );
    const clashed = new Set<number>();

    for (let i = 0; i < mothers.length; i++) {
      for (let j = i + 1; j < mothers.length; j++) {
        const a = mothers[i];
        const b = mothers[j];
        if (a.team === b.team) continue;

        const ap = this.motherAttackPoint(a);
        const bp = this.motherAttackPoint(b);
        const reach = TUNING.motherClashReach;
        if (
          !mothersClash(
            ap,
            { x: b.sprite.x, y: b.sprite.y },
            bp,
            { x: a.sprite.x, y: a.sprite.y },
            a.attackDir,
            b.attackDir,
            reach
          )
        ) {
          continue;
        }

        this.motherClash(a, b, time);
        clashed.add(a.pid);
        clashed.add(b.pid);
      }
    }

    for (const a of mothers) {
      if (clashed.has(a.pid)) continue;
      // Let the strike travel first, so a kill lands on contact rather than the
      // frame the button was pressed.
      if (time < a.attackStart + TUNING.motherAttackWindupMs) continue;

      const hits: Actor[] = [];
      for (const t of this.actors) {
        if (t.team === a.team || t.invulnUntil > time || t.deadUntil > 0) continue;

        // Reach is measured from the mother herself, inside the arc she swung.
        const dx = t.sprite.x - a.sprite.x;
        const dy = t.sprite.y - a.sprite.y;
        const dist = Math.hypot(dx, dy);
        if (dist > TUNING.swipeReach) continue;
        if (dist > 1) {
          const aim = (dx * a.attackDir.x + dy * a.attackDir.y) / dist;
          if (aim < TUNING.motherStrikeCone) continue;
        }
        hits.push(t);
      }

      if (hits.length === 0) continue;

      // Everything caught in the same swing goes down together.
      for (const t of hits) {
        if (t.role === 'mother') this.hurtMother(t, time, a.attackDir.x || a.facing);
        else this.killWhelp(t, time, a.attackDir.x || a.facing);
      }
      a.attackUntil = time;
    }
  }

  private enemyMotherPos(team: Team, time: number): { x: number; y: number } | null {
    const m = this.actors.find(
      (a) => a.role === 'mother' && a.team === OTHER[team] && a.deadUntil <= time
    );
    return m ? { x: m.sprite.x, y: m.sprite.y } : null;
  }

  private killWhelp(t: Actor, time: number, _dir: number, cue?: string) {
    if (t.deadUntil > time) return;
    forgetBotMemory(t.pid);
    if (t.riding) this.dismount(t, 0);
    this.dropCarried(t);
    t.stunUntil = 0;
    t.deadUntil = time + TUNING.whelpRespawnMs;
    t.sprite.setVisible(false);
    (t.sprite.body as Phaser.Physics.Arcade.Body).enable = false;
    this.puff(t.sprite.x, t.sprite.y);
    this.net.cue(t.pid, cue ?? 'Gulp! Back in 1.5 seconds…');
  }

  private stun(t: Actor, time: number, dir: number) {
    t.stunUntil = time + TUNING.stunMs;
    t.invulnUntil = time + TUNING.stunMs + 300;
    if (t.riding) this.dismount(t, -260);
    (t.sprite.body as Phaser.Physics.Arcade.Body).setVelocity(dir * 300, -260);
    this.dropCarried(t);
    this.net.cue(t.pid, 'Knocked loose. Hang on.');
  }

  private hurtMother(b: Actor, time: number, dir: number) {
    b.hp--;
    b.invulnUntil = time + 700;
    (b.sprite.body as Phaser.Physics.Arcade.Body).setVelocity(dir * 340, -300);
    this.puff(b.sprite.x, b.sprite.y);

    if (b.hp > 0) return;

    b.deaths++;
    b.deadUntil = time + TUNING.motherRespawnMs;
    this.resetMotherCombat(b, time);
    b.sprite.setVisible(false);
    (b.sprite.body as Phaser.Physics.Arcade.Body).enable = false;
    this.net.cue(b.pid, `Down ${b.deaths} of ${TUNING.motherDeathsToWin}. Back in 3.`);
  }

  private diveImpact(a: Actor) {
    this.puff(a.sprite.x, a.sprite.y + 20);
    this.cameras.main.shake(140, 0.006);

    // Landing on the enemy hoard pops a gem back out of a filled slot.
    for (let i = 0; i < this.slotCount; i++) {
      const enemy = OTHER[a.team];
      if (!this.slots[enemy][i]) continue;
      const r = this.mapSlotRect(enemy, i);
      if (Math.abs(a.sprite.x - (r.x + r.width / 2)) > 90) continue;
      if (Math.abs(a.sprite.y - (r.y + r.height / 2)) > 120) continue;
      this.slots[enemy][i] = false;
      const key = gemTextureKey();
      const c = this.gems.create(r.x + r.width / 2, r.y - 20, key) as Sprite;
      if (key === 'props') c.setFrame(0);
      c.setData('spawn', Phaser.Math.Between(0, this.arena.gemSpawns.length - 1));
      c.setCollideWorldBounds(true);
      c.setVelocity(Phaser.Math.Between(-300, 300), -420);
      this.drawSlots();
      break;
    }

    // And it shakes riders loose if it lands near the wyrm.
    for (const r of this.actors) {
      if (!r.riding || r.team === a.team) continue;
      if (Math.abs(r.sprite.x - a.sprite.x) > 140) continue;
      this.dismount(r, -300);
      this.stun(r, this.time.now, Math.sign(r.sprite.x - a.sprite.x) || 1);
    }
  }

  // -------------------------------------------------------------- rendering

  private drawSlots() {
    this.slotGfx.clear();
    for (const team of ['blue', 'red'] as Team[]) {
      for (let i = 0; i < this.slotCount; i++) {
        const r = this.mapSlotRect(team, i);
        if (this.slots[team][i]) {
          this.slotGfx.fillStyle(COLORS.gem, 1);
          this.slotGfx.fillRect(r.x + 3, r.y + 3, r.width - 6, r.height - 6);
        } else {
          this.slotGfx.lineStyle(2, team === 'blue' ? COLORS.blue : COLORS.red, 0.5);
          this.slotGfx.strokeRect(r.x, r.y, r.width, r.height);
        }
      }
    }
  }

  private drawCow() {
    // Art is drawn facing right, so a leftward push mirrors it.
    this.wyrm.setFlipX(this.cowFace() < 0);

    let tag = 'idle';
    if (this.cowStompStart > 0) {
      const elapsed = this.time.now - this.cowStompStart;
      tag = elapsed < TUNING.cowStompDownMs ? 'charge' : 'recoil';
    }
    tryPlayAnim(this.wyrm, 'wyrm', tag);
  }

  private puff(x: number, y: number) {
    const g = this.add.circle(x, y, 6, COLORS.bone, 0.6);
    this.tweens.add({ targets: g, radius: 26, alpha: 0, duration: 260, onComplete: () => g.destroy() });
  }

  private drawHud() {
    const count = (t: Team) => this.slots[t].filter(Boolean).length;
    const mother = (t: Team) => this.actors.find((a) => a.role === 'mother' && a.team === t);
    const pips = (t: Team) => {
      const d = mother(t)?.deaths ?? 0;
      return '●'.repeat(d) + '○'.repeat(Math.max(0, TUNING.motherDeathsToWin - d));
    };
    const line = (t: Team) => [
      `Gems ${count(t)}/${this.slotCount}`,
      `Mother down ${pips(t)}`,
    ];

    this.hudBlue.setText(line('blue'));
    this.hudRed.setText(line('red'));

    const distBlue = Math.max(0, this.wyrm.x - this.arena.wyrmWin.blue);
    const distRed = Math.max(0, this.arena.wyrmWin.red - this.wyrm.x);
    const span = this.arena.wyrmWin.red - this.arena.wyrmWin.blue;
    const pct = Phaser.Math.Clamp((this.wyrm.x - this.arena.wyrmWin.blue) / span, 0, 1);
    const cells = 21;
    const at = Math.round(pct * (cells - 1));
    this.hudWyrm.setText([
      'Cow push',
      `Blue finish ${Math.round(distBlue)}px · Red finish ${Math.round(distRed)}px`,
      Array.from({ length: cells }, (_, i) => (i === at ? '◆' : '·')).join(''),
    ]);
  }

  // ------------------------------------------------------------------- win

  private victoryRosterLines(team: Team): string[] {
    const host = this.net.hostPid;
    const players = [...this.net.players.values()].filter((p) => p.team === team);
    if (players.length === 0) return ['(empty)'];
    return players.map((p) => {
      const crown = p.pid === host ? ' 👑' : '';
      return `${formatPlayerLabel(p)}${crown}`;
    });
  }

  private canContinueFromTv(): boolean {
    const host = this.net.hostPid;
    if (host == null) return true;
    const hostPlayer = this.net.players.get(host);
    return Boolean(hostPlayer?.local);
  }

  private pollVictoryContinue() {
    if (this.returningToLobby || !this.canContinueFromTv()) return;
    if (this.continueKey && Phaser.Input.Keyboard.JustDown(this.continueKey)) {
      this.returnToLobby();
    }
  }

  private returnToLobby() {
    if (!this.over || this.returningToLobby) return;
    this.returningToLobby = true;
    this.net.onHostContinue = () => {};
    this.net.notifyReturnLobby();
    this.scene.start('Lobby', { net: this.net });
  }

  private checkWin() {
    const finish = (team: Team, why: string) => {
      this.over = true;
      this.physics.pause();
      this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.72).setDepth(90);
      this.add.text(W / 2, H / 2 - 168, `${team.toUpperCase()} WINS`, {
        fontFamily: 'system-ui, sans-serif', fontSize: '84px', fontStyle: 'bold', color: HEX[team],
      }).setOrigin(0.5).setDepth(91);
      this.add.text(W / 2, H / 2 - 72, why, {
        fontFamily: 'system-ui, sans-serif', fontSize: '26px', color: '#efe4d2',
      }).setOrigin(0.5).setDepth(91);
      this.add.text(W / 2, H / 2 - 16, this.victoryRosterLines(team).join('\n'), {
        fontFamily: 'system-ui, sans-serif', fontSize: '20px', color: '#efe4d2',
        align: 'center', lineSpacing: 6,
      }).setOrigin(0.5, 0).setDepth(91);
      const hostHint = this.net.hostPid != null
        ? 'Host 👑: tap Continue on phone · or Space on TV'
        : 'Space to return to lobby';
      this.add.text(W / 2, H - 56, hostHint, {
        fontFamily: 'system-ui, sans-serif', fontSize: '20px', color: '#7fe3c4',
      }).setOrigin(0.5).setDepth(91);
      for (const a of this.actors) {
        this.net.cue(a.pid, a.team === team ? 'You won!' : `${team.toUpperCase()} wins.`);
      }
      this.net.notifyGameEnd(team, why);
    };

    for (const team of ['blue', 'red'] as Team[]) {
      const m = this.actors.find((a) => a.role === 'mother' && a.team === team);
      if (m && m.deaths >= TUNING.motherDeathsToWin) {
        return finish(
          OTHER[team],
          `The ${team} mother fell ${TUNING.motherDeathsToWin} times.`
        );
      }
    }

    for (const team of ['blue', 'red'] as Team[]) {
      if (this.slots[team].every(Boolean)) return finish(team, `All ${this.slotCount} gems hoarded.`);
    }

    if (this.wyrm.x <= this.arena.wyrmWin.blue) return finish('blue', 'Cow reached the blue finish line.');
    if (this.wyrm.x >= this.arena.wyrmWin.red) return finish('red', 'Cow reached the red finish line.');
  }
}
