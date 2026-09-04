import Phaser from 'phaser';
import { Net, Lobbyist, Team } from '../net';
import { resetBotMemory, updateBotBrains, type BotWorld } from '../bots';
import { applyLocalKeyboard } from '../local-input';
import {
  actorAtlasKey,
  actorTextureKey,
  applySpriteScale,
  gemTextureKey,
  getGemAnchor,
  mountBackground,
  tryPlayAnim,
  wyrmTextureKey,
} from '../assets';
import { drawCollisionOverlay } from '../collision-overlay';
import { mothersClash, pickWhelpRespawn } from '../spawn';
import {
  W, H, COLORS, TUNING, PLATFORMS, GEM_SPAWNS, SPAWN, slotRect,
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
  attackDir: Phaser.Math.Vector2;
  diving: boolean;
  shortDive: boolean;
  lungeUntil: number;
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

  private wyrm!: Phaser.Physics.Arcade.Image;
  private wyrmGfx!: Phaser.GameObjects.Graphics;
  private finishGfx!: Phaser.GameObjects.Graphics;

  private hudBlue!: Phaser.GameObjects.Text;
  private hudRed!: Phaser.GameObjects.Text;
  private hudWyrm!: Phaser.GameObjects.Text;
  private over = false;
  private showCollision = false;
  private collisionGfx!: Phaser.GameObjects.Graphics;

  private cowHeadDrop = 0;
  private cowStompStart = 0;
  private cowStompHit = false;
  private cowStompCooldownUntil = 0;

  constructor() { super('Game'); }

  init(data: { net: Net }) { this.net = data.net; }

  // ------------------------------------------------------------------ setup

  create() {
    this.over = false;
    this.actors = [];
    resetBotMemory();
    this.slots = { blue: new Array(TUNING.slotsToWin).fill(false), red: new Array(TUNING.slotsToWin).fill(false) };
    this.cameras.main.setBackgroundColor(COLORS.sky);
    this.physics.world.setBounds(0, 0, W, H);

    mountBackground(this);
    this.collisionGfx = this.add.graphics().setDepth(100).setVisible(false);

    this.buildPlatforms();
    this.slotGfx = this.add.graphics();
    this.drawSlots();

    this.gems = this.physics.add.group({ bounceX: 0.35, bounceY: 0.3, dragX: 140 });
    this.physics.add.collider(this.gems, this.platforms);
    GEM_SPAWNS.forEach((_, i) => this.spawnGem(i));

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
  }

  private buildPlatforms() {
    this.platforms = this.physics.add.staticGroup();
    PLATFORMS.forEach(([x, y, w, h], idx) => {
      const r = this.add.rectangle(x + w / 2, y + h / 2, w, h, COLORS.soil)
        .setStrokeStyle(2, COLORS.soilLip);
      this.platforms.add(r);
      const body = r.body as Phaser.Physics.Arcade.StaticBody;
      body.updateFromGameObject();
      // Everything except the ground is a drop-through ledge, so a whelp
      // can pop up from below instead of bonking its cap.
      if (idx > 0) {
        body.checkCollision.down = false;
        body.checkCollision.left = false;
        body.checkCollision.right = false;
      }
    });
  }

  private buildWyrm() {
    this.wyrmGfx = this.add.graphics().setDepth(12);
    this.finishGfx = this.add.graphics().setDepth(11);
    const key = wyrmTextureKey();
    const feetY = TUNING.cowGroundY;
    this.wyrm = this.physics.add.image(W / 2, feetY - 22, key).setVisible(false);
    applySpriteScale(this.wyrm);
    const wb = this.wyrm.body as Phaser.Physics.Arcade.Body;
    wb.setSize(52, 36);
    wb.setAllowGravity(false);
    this.wyrm.setImmovable(true);
  }

  private drawFinishLines() {
    const g = this.finishGfx;
    g.clear();
    const top = TUNING.cowGroundY - TUNING.cowFinishHeight;
    const bottom = TUNING.cowGroundY;

    g.lineStyle(5, COLORS.blue, 0.9);
    g.lineBetween(TUNING.wyrmWin.blue, top, TUNING.wyrmWin.blue, bottom);
    g.lineStyle(3, COLORS.blue, 0.45);
    g.strokeRect(TUNING.wyrmWin.blue - 2, top, 4, bottom - top);

    g.lineStyle(5, COLORS.red, 0.9);
    g.lineBetween(TUNING.wyrmWin.red, top, TUNING.wyrmWin.red, bottom);
    g.lineStyle(3, COLORS.red, 0.45);
    g.strokeRect(TUNING.wyrmWin.red - 2, top, 4, bottom - top);

    const labelStyle = {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '15px',
      fontStyle: 'bold' as const,
    };
    this.add.text(TUNING.wyrmWin.blue + 8, top - 10, 'BLUE\nFINISH', {
      ...labelStyle,
      color: HEX.blue,
      align: 'left',
    }).setOrigin(0, 1).setDepth(12);
    this.add.text(TUNING.wyrmWin.red - 8, top - 10, 'RED\nFINISH', {
      ...labelStyle,
      color: HEX.red,
      align: 'right',
    }).setOrigin(1, 1).setDepth(12);
  }

  private buildActors() {
    for (const p of this.net.players.values()) {
      const atlasKey = actorAtlasKey(p.role, p.team);
      const key = actorTextureKey(p.role, p.team);
      const spawn = SPAWN[p.team];
      const sprite = this.physics.add.sprite(spawn.x, spawn.y, key);
      applySpriteScale(sprite);
      sprite.setCollideWorldBounds(true);
      const body = sprite.body as Phaser.Physics.Arcade.Body;
      body.setGravityY(
        p.role === 'mother' ? TUNING.motherGravity - TUNING.gravity : 0
      );
      if (p.role === 'mother') {
        body.setSize(28, 40, true);
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
        attackUntil: 0, attackDir: new Phaser.Math.Vector2(1, 0),
        diving: false, shortDive: false, lungeUntil: 0, puntUntil: 0, riding: false,
        disconnected: Boolean(p.disconnected),
      });
    }
  }

  private spawnGem(index: number) {
    const [x, y] = GEM_SPAWNS[index];
    const key = gemTextureKey();
    const c = this.gems.create(x, y, key) as Sprite;
    if (key === 'props') c.setFrame(0);
    c.setData('spawn', index);
    c.setCollideWorldBounds(true);
  }

  // ----------------------------------------------------------------- update

  update(time: number, delta: number) {
    if (this.over) return;

    applyLocalKeyboard(this.net, this.input.keyboard);
    updateBotBrains(this.buildBotWorld(time));

    for (const a of this.actors) this.updateActor(a, time, delta);

    this.updateWyrm();
    this.updateCowStomp(time);
    this.updateGems(time);
    this.resolveCombat(time);
    this.drawCow();
    this.drawHud();
    this.checkWin();

    // Edge flags live exactly one frame.
    for (const a of this.actors) { a.input.jumpEdge = false; a.input.actionEdge = false; }
  }

  private buildBotWorld(time: number): BotWorld {
    const slotCount = (t: Team) => this.slots[t].filter(Boolean).length;
    const gems: Array<{ x: number; y: number }> = [];
    for (const child of this.gems.getChildren()) {
      const s = child as Sprite;
      if (s.active) gems.push({ x: s.x, y: s.y });
    }
    return {
      time,
      wyrmX: this.wyrm.x,
      wyrmFace: this.cowFace(),
      slotsFilled: { blue: slotCount('blue'), red: slotCount('red') },
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
        a.sprite.setPosition(SPAWN[a.team].x, SPAWN[a.team].y).setVisible(true);
      } else {
        a.invulnUntil = time + TUNING.whelpInvulnMs;
        const enemy = this.enemyMotherPos(a.team, time);
        const pt = pickWhelpRespawn(a.team, enemy, TUNING.spawnCampRadius);
        a.sprite.setPosition(pt.x, pt.y).setVisible(true);
      }
    }

    a.label.setVisible(true).setPosition(a.sprite.x, a.sprite.y - a.sprite.displayHeight / 2 - 4);
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

    if (a.riding) { this.updateRider(a); return; }

    if (a.role === 'mother') this.updateMother(a, time, body);
    else this.updateWhelp(a, time, body);
  }

  private updateWhelp(a: Actor, time: number, body: Phaser.Physics.Arcade.Body) {
    body.setVelocityX(a.input.x * TUNING.whelpSpeed);

    if (a.input.jumpEdge && body.blocked.down) body.setVelocityY(TUNING.whelpJump);

    // Punting and throwing are airborne moves. That is the timing window.
    if (a.input.actionEdge && !body.blocked.down) {
      if (a.carrying > 0) {
        a.carrying--;
        const key = gemTextureKey();
        const c = this.gems.create(a.sprite.x + a.facing * 20, a.sprite.y - 10, key) as Sprite;
        if (key === 'props') c.setFrame(0);
        c.setData('spawn', Phaser.Math.Between(0, GEM_SPAWNS.length - 1));
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
      tryPlayAnim(a.sprite, a.atlasKey, 'dive', false);
      if (time < a.attackUntil) {
        return;
      }
      a.diving = false;
      a.shortDive = false;
      if (body.blocked.down && body.velocity.y >= 0) {
        this.diveImpact(a);
      }
      return;
    }

    if (a.lungeUntil > time) {
      body.setVelocityX(Phaser.Math.Linear(body.velocity.x, a.input.x * TUNING.motherSpeed * 0.35, 0.15));
      return;
    }

    if (!body.blocked.down) {
      tryPlayAnim(a.sprite, a.atlasKey, 'flap');
    } else {
      tryPlayAnim(a.sprite, a.atlasKey, 'idle');
    }

    body.setVelocityX(a.input.x * TUNING.motherSpeed);

    if (a.input.jumpEdge) {
      body.setVelocityY(Math.max(body.velocity.y + TUNING.motherThrust, TUNING.motherThrustCap));
      this.puff(a.sprite.x, a.sprite.y + 22);
    }

    if (a.input.actionEdge) {
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

      if (dy > 0.35) {
        a.diving = true;
        a.shortDive = true;
        a.attackUntil = time + TUNING.motherDiveMs;
        a.lungeUntil = time + TUNING.motherDiveMs;
        a.attackDir.set(dx, dy);
        if (a.attackDir.length() > 0) a.attackDir.normalize();
        const spd = TUNING.motherDiveSpeed;
        body.setVelocity(dx * spd, dy * spd);
        tryPlayAnim(a.sprite, a.atlasKey, 'dive', false);
      } else {
        const mag = Math.hypot(dx, dy) || 1;
        dx /= mag;
        dy /= mag;
        a.attackDir.set(dx, dy);
        a.attackUntil = time + TUNING.swipeMs;
        a.lungeUntil = time + TUNING.motherLungeMs;
        body.setVelocity(dx * TUNING.motherLungeSpeed, dy * TUNING.motherLungeSpeed);
        tryPlayAnim(a.sprite, a.atlasKey, 'claw', false);
      }
    }
  }

  private updateRider(a: Actor) {
    const body = a.sprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    const riders = this.actors.filter((r) => r.riding);
    const i = riders.indexOf(a);
    const spread = (i - (riders.length - 1) / 2) * 28;
    const backY = this.cowBackY();
    a.sprite.setPosition(this.wyrm.x + spread, backY);
    body.setVelocity(0, 0);

    if (a.input.jumpEdge) this.dismount(a, -480);
  }

  private cowBackY() {
    return this.wyrm.y - 30;
  }

  private cowFeetY() {
    return TUNING.cowGroundY;
  }

  private dismount(a: Actor, vy: number) {
    a.riding = false;
    const body = a.sprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(true);
    body.setVelocityY(vy);
  }

  // ------------------------------------------------------------------- wyrm

  private cowFace(): 1 | -1 {
    return (this.wyrm.body as Phaser.Physics.Arcade.Body).velocity.x >= 0 ? 1 : -1;
  }

  private whelpInFrontOfCow(a: Actor): boolean {
    if (a.role !== 'whelp' || a.riding || a.deadUntil > this.time.now) return false;
    const cx = this.wyrm.x;
    const feetY = this.cowFeetY();
    const face = this.cowFace();
    const dx = a.sprite.x - cx;
    const forward = face > 0 ? dx : -dx;
    if (forward < 6 || forward > 62) return false;
    if (Math.abs(a.sprite.y - (feetY - 22)) > 34) return false;
    const body = a.sprite.body as Phaser.Physics.Arcade.Body;
    return body.blocked.down || body.touching.down || a.sprite.y >= feetY - 40;
  }

  private updateCowStomp(time: number) {
    const downMs = TUNING.cowStompDownMs;
    const upMs = TUNING.cowStompUpMs;

    if (this.cowStompStart > 0) {
      const elapsed = time - this.cowStompStart;
      if (elapsed < downMs) {
        this.cowHeadDrop = Phaser.Math.Easing.Quadratic.In(elapsed / downMs);
      } else if (elapsed < downMs + upMs) {
        if (!this.cowStompHit) {
          this.cowStompHit = true;
          this.applyCowStompKill(time);
        }
        this.cowHeadDrop = 1 - Phaser.Math.Easing.Quadratic.Out((elapsed - downMs) / upMs);
      } else {
        this.cowStompStart = 0;
        this.cowHeadDrop = 0;
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
      this.cowHeadDrop = 0;
      return;
    }
  }

  private applyCowStompKill(time: number) {
    const cx = this.wyrm.x;
    const feetY = this.cowFeetY();
    const face = this.cowFace();
    const headX = cx + face * 20;
    const headY = feetY - 34;

    for (const a of this.actors) {
      if (a.role !== 'whelp' || a.riding || a.deadUntil > time || a.invulnUntil > time) continue;
      if (Phaser.Math.Distance.Between(a.sprite.x, a.sprite.y, headX, headY) > 38) continue;
      this.killWhelp(a, time, 0, 'The cow stomped you! Respawning…');
    }
    this.cameras.main.shake(90, 0.004);
  }

  private updateWyrm() {
    const stomping = this.cowStompStart > 0;
    const riders = this.actors.filter((r) => r.riding);

    if (!stomping) {
      // Whoever is aboard steers. Two teams pulling opposite ways cancel out,
      // so a contested wyrm just sits there and the fight decides it.
      const pull = riders.reduce((s, r) => s + r.input.x, 0);
      this.wyrm.setVelocityX(Phaser.Math.Clamp(pull, -1, 1) * TUNING.wyrmSpeed);
    } else {
      this.wyrm.setVelocityX(0);
    }
    this.wyrm.x = Phaser.Math.Clamp(this.wyrm.x, 40, W - 40);
    this.wyrm.y = this.wyrm.y + (this.cowFeetY() - 22 - this.wyrm.y) * 0.35;

    // Mount by landing on the cow's back.
    const backY = this.cowBackY();
    for (const a of this.actors) {
      if (a.riding || a.role === 'mother' || a.stunUntil > this.time.now) continue;
      const body = a.sprite.body as Phaser.Physics.Arcade.Body;
      if (body.velocity.y < 0) continue;
      if (Math.abs(a.sprite.x - this.wyrm.x) < 46 &&
          Math.abs(a.sprite.y - backY) < 28) {
        a.riding = true;
      }
    }
  }

  // --------------------------------------------------------------- gems

  private updateGems(_time: number) {
    for (const obj of this.gems.getChildren() as Sprite[]) {
      if (!obj.active) continue;
      const bounds = obj.getBounds();

      // A gem that lands in an empty slot fills it, whoever threw it.
      let consumed = false;
      for (const team of ['blue', 'red'] as Team[]) {
        for (let i = 0; i < TUNING.slotsToWin; i++) {
          if (this.slots[team][i]) continue;
          if (Phaser.Geom.Intersects.RectangleToRectangle(bounds, slotRect(team, i))) {
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
      for (let i = 0; i < TUNING.slotsToWin; i++) {
        if (this.slots[a.team][i]) continue;
        if (Phaser.Geom.Intersects.RectangleToRectangle(a.sprite.getBounds(), slotRect(a.team, i))) {
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
    c.setData('spawn', Phaser.Math.Between(0, GEM_SPAWNS.length - 1));
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

      const hx = a.sprite.x + a.attackDir.x * TUNING.swipeReach;
      const hy = a.sprite.y + a.attackDir.y * TUNING.swipeReach;

      for (const t of this.actors) {
        if (t.team === a.team || t.invulnUntil > time || t.deadUntil > 0) continue;
        if (Phaser.Math.Distance.Between(hx, hy, t.sprite.x, t.sprite.y) > TUNING.motherClashReach) continue;

        if (t.role === 'mother') this.hurtMother(t, time, a.attackDir.x || a.facing);
        else this.killWhelp(t, time, a.attackDir.x || a.facing);
        a.attackUntil = time;
        break;
      }
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
    b.diving = false;
    b.sprite.setVisible(false);
    (b.sprite.body as Phaser.Physics.Arcade.Body).enable = false;
    this.net.cue(b.pid, `Down ${b.deaths} of ${TUNING.motherDeathsToWin}. Back in 3.`);
  }

  private diveImpact(a: Actor) {
    this.puff(a.sprite.x, a.sprite.y + 20);
    this.cameras.main.shake(140, 0.006);

    // Landing on the enemy hoard pops a gem back out of a filled slot.
    for (let i = 0; i < TUNING.slotsToWin; i++) {
      const enemy = OTHER[a.team];
      if (!this.slots[enemy][i]) continue;
      const r = slotRect(enemy, i);
      if (Math.abs(a.sprite.x - (r.x + r.width / 2)) > 90) continue;
      if (Math.abs(a.sprite.y - (r.y + r.height / 2)) > 120) continue;
      this.slots[enemy][i] = false;
      const key = gemTextureKey();
      const c = this.gems.create(r.x + r.width / 2, r.y - 20, key) as Sprite;
      if (key === 'props') c.setFrame(0);
      c.setData('spawn', Phaser.Math.Between(0, GEM_SPAWNS.length - 1));
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
      for (let i = 0; i < TUNING.slotsToWin; i++) {
        const r = slotRect(team, i);
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
    const g = this.wyrmGfx;
    g.clear();
    const cx = this.wyrm.x;
    const feetY = this.cowFeetY();
    const face = this.cowFace();
    const drop = this.cowHeadDrop;

    // Legs on the ground
    g.fillStyle(0xf4f0e8, 1);
    for (const ox of [-14, -5, 5, 14]) {
      g.fillRect(cx + ox - 3, feetY - 16, 6, 16);
    }
    g.fillStyle(0x2c2420, 1);
    for (const ox of [-14, -5, 5, 14]) {
      g.fillRect(cx + ox - 4, feetY - 4, 8, 4);
    }

    const bodyY = feetY - 28;
    g.fillStyle(0xf4f0e8, 1);
    g.fillEllipse(cx, bodyY, 34, 22);
    g.fillStyle(0x2c2420, 1);
    g.fillCircle(cx - 9, bodyY - 1, 5);
    g.fillCircle(cx + 7, bodyY + 3, 4);
    g.fillCircle(cx + 12, bodyY - 3, 3);

    const neckBaseX = cx + face * 14;
    const neckBaseY = bodyY - 8;
    const headX = neckBaseX + face * (4 + drop * 6);
    const headY = neckBaseY + drop * 22;
    if (drop > 0.05) {
      g.lineStyle(5, 0xf4f0e8, 1);
      g.lineBetween(neckBaseX, neckBaseY, headX - face * 3, headY);
    }

    g.fillStyle(0xf4f0e8, 1);
    g.fillCircle(headX, headY, 9 + drop * 2);
    g.fillStyle(0x2c2420, 1);
    g.fillCircle(headX + face * 4, headY - 2 + drop * 3, 2);
    g.fillCircle(headX + face * 2, headY + 2 + drop * 2, 2);
    g.fillStyle(0xc97a5a, 1);
    g.fillCircle(headX + face * 8, headY + 1 + drop * 4, 3);
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
      `Gems ${count(t)}/${TUNING.slotsToWin}`,
      `Mother down ${pips(t)}`,
    ];

    this.hudBlue.setText(line('blue'));
    this.hudRed.setText(line('red'));

    const distBlue = Math.max(0, this.wyrm.x - TUNING.wyrmWin.blue);
    const distRed = Math.max(0, TUNING.wyrmWin.red - this.wyrm.x);
    const span = TUNING.wyrmWin.red - TUNING.wyrmWin.blue;
    const pct = Phaser.Math.Clamp((this.wyrm.x - TUNING.wyrmWin.blue) / span, 0, 1);
    const cells = 21;
    const at = Math.round(pct * (cells - 1));
    this.hudWyrm.setText([
      'Cow push',
      `Blue finish ${Math.round(distBlue)}px · Red finish ${Math.round(distRed)}px`,
      Array.from({ length: cells }, (_, i) => (i === at ? '◆' : '·')).join(''),
    ]);
  }

  // ------------------------------------------------------------------- win

  private checkWin() {
    const finish = (team: Team, why: string) => {
      this.over = true;
      this.physics.pause();
      this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.72).setDepth(90);
      this.add.text(W / 2, H / 2 - 40, `${team.toUpperCase()} WINS`, {
        fontFamily: 'system-ui, sans-serif', fontSize: '84px', fontStyle: 'bold', color: HEX[team],
      }).setOrigin(0.5).setDepth(91);
      this.add.text(W / 2, H / 2 + 40, why, {
        fontFamily: 'system-ui, sans-serif', fontSize: '26px', color: '#efe4d2',
      }).setOrigin(0.5).setDepth(91);
      this.add.text(W / 2, H / 2 + 88, 'Returning to lobby…', {
        fontFamily: 'system-ui, sans-serif', fontSize: '20px', color: '#8b7a66',
      }).setOrigin(0.5).setDepth(91);
      for (const a of this.actors) {
        this.net.cue(a.pid, a.team === team ? 'You won!' : `${team.toUpperCase()} wins.`);
      }
      this.net.notifyGameEnd(team, why);
      this.time.delayedCall(5000, () => this.scene.start('Lobby', { net: this.net }));
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
      if (this.slots[team].every(Boolean)) return finish(team, 'All fifteen gems hoarded.');
    }

    if (this.wyrm.x <= TUNING.wyrmWin.blue) return finish('blue', 'Cow reached the blue finish line.');
    if (this.wyrm.x >= TUNING.wyrmWin.red) return finish('red', 'Cow reached the red finish line.');
  }
}
